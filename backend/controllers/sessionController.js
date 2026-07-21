const { GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

const { redis, ALL_SESSIONS_KEY } = require("../config/redis");
const { getStorageClientAndBucket } = require("../config/storage");

// Helper function to validate admin token (master or guest)
async function verifyAdminToken(sessionId, token) {
  if (!token) return false;
  const storedToken = await redis.get(`session:${sessionId}:token`);
  if (storedToken && storedToken === token) return true;

  const val = await redis.get(`session:${sessionId}:token:${token}`);
  if (val) return true;

  return false;
}

// Helper function to validate master admin token only
async function verifyMasterAdminToken(sessionId, token) {
  if (!token) return false;
  const storedToken = await redis.get(`session:${sessionId}:token`);
  if (storedToken && storedToken === token) return true;

  const val = await redis.get(`session:${sessionId}:token:${token}`);
  if (!val) return false;
  if (val === "master") return true;
  try {
    const parsed = JSON.parse(val);
    if (parsed.role === "master") return true;
  } catch (e) {}

  return false;
}

// Helper function to get token permissions
async function getTokenPermissions(sessionId, token) {
  const defaultPerms = { allowText: true, allowFiles: true, allowUploads: true };
  if (!token) return defaultPerms;
  const val = await redis.get(`session:${sessionId}:token:${token}`);
  if (!val) return defaultPerms;
  if (val === "master") return defaultPerms;
  try {
    const parsed = JSON.parse(val);
    if (parsed.role === "master") return defaultPerms;
    if (parsed.permissions) return parsed.permissions;
  } catch (e) {}
  return defaultPerms;
}

// Unlock Session Passcode
async function unlockSession(req, res) {
  const { sessionId } = req.params;
  const { password } = req.body;

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "This session does not require unlocking." });
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tmkbharathi";
  
  // 1. Check Master Admin Password
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(16).toString("hex");
    const tokenKey = `session:${sessionId}:token`;
    await redis.set(tokenKey, token, "EX", 86400);
    await redis.set(`session:${sessionId}:token:${token}`, JSON.stringify({ role: "master" }), "EX", 86400);

    return res.json({ 
      success: true, 
      token, 
      isMasterAdmin: true,
      permissions: { allowText: true, allowFiles: true, allowUploads: true }
    });
  }

  // 2. Check Temporary Expiring Guest Passcodes
  const guestKey = `session:${sessionId}:guest_passcode:${password}`;
  const guestDataRaw = await redis.get(guestKey);

  if (guestDataRaw) {
    let guestData = {};
    try { guestData = JSON.parse(guestDataRaw); } catch (e) {}

    const remainingTtl = await redis.ttl(guestKey);
    const tokenTtl = remainingTtl > 0 ? remainingTtl : 3600;
    const guestExpiresAt = guestData.expiresAt || (Date.now() + (tokenTtl * 1000));
    const guestPermissions = guestData.permissions || { allowText: true, allowFiles: true, allowUploads: true };

    if (guestData.maxUses && guestData.maxUses > 0) {
      guestData.uses = (guestData.uses || 0) + 1;
      if (guestData.uses >= guestData.maxUses) {
        await redis.del(guestKey);
        await redis.srem(`session:${sessionId}:guest_passcodes_set`, password);
      } else {
        await redis.set(guestKey, JSON.stringify(guestData), "EX", remainingTtl);
      }
    }

    const token = crypto.randomBytes(16).toString("hex");
    await redis.set(
      `session:${sessionId}:token:${token}`, 
      JSON.stringify({ 
        role: "guest", 
        passcode: password,
        expiresAt: guestExpiresAt,
        permissions: guestPermissions
      }), 
      "EX", 
      tokenTtl
    );

    const tokenSetKey = `session:${sessionId}:passcode_tokens:${password}`;
    await redis.sadd(tokenSetKey, token);
    await redis.expire(tokenSetKey, tokenTtl);

    return res.json({ 
      success: true, 
      token, 
      isMasterAdmin: false,
      expiresAt: guestExpiresAt,
      remainingSeconds: Math.max(0, Math.floor((guestExpiresAt - Date.now()) / 1000)),
      permissions: guestPermissions
    });
  }

  return res.status(401).json({ error: "Invalid passcode or expired link." });
}

// Get Session Details
async function getSession(req, res) {
  const { sessionId } = req.params;
  try {
    const activeKey = `session:${sessionId}:active`;
    const textKey = `session:${sessionId}:text`;
    const filesKey = `session:${sessionId}:files`;
    const lastActiveKey = `session:${sessionId}:last_active`;

    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    // Security validation: Require token for the admin session
    if (isAdminSession) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(" ")[1];
      const isValid = await verifyAdminToken(sessionId, token);

      if (!isValid) {
        return res.status(401).json({ error: "Unauthorized access. Passcode required." });
      }
    }

    const [[, isActive], [, text], [, filesCount], [, isPurged]] = await redis.pipeline()
      .exists(activeKey)
      .get(textKey)
      .llen(filesKey)
      .get(`session:${sessionId}:purged_empty`)
      .exec();

    if (!isActive && text === null && filesCount === 0) {
      if (isAdminSession) {
        await redis.set(activeKey, "1", "EX", 86400 * 365); // 1 year expiry
      } else {
        if (isPurged) {
          return res.status(410).json({ error: "purged_due_to_inactivity" });
        }
        return res.status(404).json({ error: "Session not found or expired" });
      }
    }

    const filesRaw = await redis.lrange(filesKey, 0, -1);
    let storageContext = null;
    const files = filesCount > 0 
      ? await Promise.all(
        filesRaw.map(async (f) => {
          const file = JSON.parse(f);
          // Fast-path: Only generate presigned previewUrl if missing
          if (!file.previewUrl && file.mimeType && file.mimeType.startsWith("image/")) {
            try {
              if (!storageContext) {
                storageContext = getStorageClientAndBucket(sessionId);
              }
              const command = new GetObjectCommand({
                Bucket: storageContext.bucket,
                Key: file.s3Key,
              });
              file.previewUrl = await getSignedUrl(storageContext.client, command, { expiresIn: 86400 });
            } catch (err) {
              console.error("Preview URL generation failed", err);
            }
          }
          return file;
        })
      )
      : [];

    const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
    const metadataExpiry = isAdminSession ? 86400 * 365 : 86400 * 2; // 1 year or 48 hours

    await redis.pipeline()
      .set(lastActiveKey, Date.now().toString())
      .sadd(ALL_SESSIONS_KEY, sessionId)
      .set(activeKey, "1", "EX", activeExpiry)
      .expire(textKey, metadataExpiry)
      .expire(filesKey, metadataExpiry)
      .exec();

    let guestRemainingSeconds = null;
    let guestExpiresAt = null;
    let permissions = { allowText: true, allowFiles: true, allowUploads: true };

    if (isAdminSession) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(" ")[1];
      if (token) {
        const val = await redis.get(`session:${sessionId}:token:${token}`);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.role === "guest") {
              if (parsed.expiresAt) {
                guestExpiresAt = parsed.expiresAt;
                guestRemainingSeconds = Math.max(0, Math.floor((parsed.expiresAt - Date.now()) / 1000));
              }
              if (parsed.permissions) {
                permissions = parsed.permissions;
              }
            }
          } catch (e) {
            if (val === "guest") {
              const ttl = await redis.ttl(`session:${sessionId}:token:${token}`);
              if (ttl > 0) {
                guestRemainingSeconds = ttl;
                guestExpiresAt = Date.now() + (ttl * 1000);
              }
            }
          }
        }
      }
    }

    const filteredText = permissions.allowText ? (text || "") : "";
    const filteredFiles = permissions.allowFiles ? files : [];

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.json({ text: filteredText, files: filteredFiles, guestRemainingSeconds, guestExpiresAt, permissions });
  } catch (e) {
    console.error("Session load error:", e);
    res.status(500).json({ error: "Failed to load session" });
  }
}

// Delete Session
async function deleteSession(req, res, io) {
  const { sessionId } = req.params;
  console.log(`[API] DELETE request received for session: ${sessionId}`);
  try {
    const activeKey = `session:${sessionId}:active`;
    const textKey = `session:${sessionId}:text`;
    const filesKey = `session:${sessionId}:files`;

    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    // Security validation: Require token for the admin session deletion
    if (isAdminSession) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(" ")[1];
      const isValid = await verifyAdminToken(sessionId, token);

      if (!isValid) {
        return res.status(401).json({ error: "Unauthorized access. Passcode required." });
      }
    }

    const filesRaw = await redis.lrange(filesKey, 0, -1);
    const files = filesRaw.map(f => {
      try { return JSON.parse(f); } catch { return null; }
    }).filter(Boolean);

    const { client, bucket } = getStorageClientAndBucket(sessionId);
    await Promise.all(files.map(file => 
      client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: file.s3Key
      })).catch(err => console.error(`Failed to delete file ${file.s3Key} from S3:`, err))
    ));

    await redis.del(activeKey, textKey, filesKey, `session:${sessionId}:last_active`, `session:${sessionId}:purged_empty`, `session:${sessionId}:token`);
    await redis.srem(ALL_SESSIONS_KEY, sessionId);

    if (io) {
      io.to(sessionId).emit("session_deleted");
    }

    res.json({ success: true });
  } catch (e) {
    console.error(`Failed to delete session ${sessionId}:`, e);
    res.status(500).json({ error: "Failed to delete session" });
  }
}

// Get pre-signed URL for direct upload
async function presignUpload(req, res) {
  const { sessionId } = req.params;
  const { fileName, fileSize, mimeType } = req.body;

  if (!fileName || !fileSize || !mimeType) {
    return res.status(400).json({ error: "Missing required fields (fileName, fileSize, mimeType)" });
  }

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

  // Security validation: Require token for uploading in admin session
  if (isAdminSession) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    const isValid = await verifyAdminToken(sessionId, token);

    if (!isValid) {
      return res.status(401).json({ error: "Unauthorized access. Passcode required." });
    }

    const perms = await getTokenPermissions(sessionId, token);
    if (!perms.allowFiles || !perms.allowUploads) {
      return res.status(403).json({ error: "File uploads are disabled by room admin." });
    }
  }

  try {
    const filesKey = `session:${sessionId}:files`;

    const maxFileSize = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;
    if (fileSize > maxFileSize) {
      return res.status(400).json({ error: `File size exceeds the limit of ${isAdminSession ? "1GB" : "50MB"}.` });
    }

    const currentFilesCount = await redis.llen(filesKey);
    const maxFilesCount = isAdminSession ? 100 : 20;
    if (currentFilesCount >= maxFilesCount) {
      return res.status(400).json({ error: `Session file limit (${maxFilesCount}) reached. Please delete old files.` });
    }

    const existingFilesRaw = await redis.lrange(filesKey, 0, -1);
    const existingFiles = existingFilesRaw.map(f => {
      try { return JSON.parse(f); } catch { return null; }
    }).filter(Boolean);
    const totalExistingSize = existingFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const maxTotalStorage = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;

    if (totalExistingSize + fileSize > maxTotalStorage) {
      return res.status(400).json({ error: `Session total storage limit (${isAdminSession ? "1GB" : "50MB"}) reached. Please delete old files.` });
    }

    const fileId = `${Date.now()}-${fileName}`;
    const s3Key = `${sessionId}/${fileId}`;

    const { client, bucket } = getStorageClientAndBucket(sessionId);
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

    res.json({ uploadUrl, fileId, s3Key });
  } catch (error) {
    console.error("Presign upload error:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
}

// Confirm upload
async function confirmUpload(req, res, io) {
  const { sessionId } = req.params;
  const { fileId, name, size, mimeType, s3Key, hash } = req.body;

  if (!fileId || !name || !size || !mimeType || !s3Key || !hash) {
    return res.status(400).json({ error: "Missing required metadata for confirmation" });
  }

  if (!s3Key.startsWith(`${sessionId}/`)) {
    return res.status(400).json({ error: "Invalid S3 key path structure." });
  }

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

  // Security validation: Require token for uploading in admin session
  if (isAdminSession) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    const isValid = await verifyAdminToken(sessionId, token);

    if (!isValid) {
      return res.status(401).json({ error: "Unauthorized access. Passcode required." });
    }

    const perms = await getTokenPermissions(sessionId, token);
    if (!perms.allowFiles || !perms.allowUploads) {
      return res.status(403).json({ error: "File uploads are disabled by room admin." });
    }
  }

  try {
    const filesKey = `session:${sessionId}:files`;

    const { client, bucket } = getStorageClientAndBucket(sessionId);
    try {
      const headResponse = await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: s3Key
      }));

      if (headResponse.ContentLength !== Number(size)) {
        return res.status(400).json({ 
          error: `File size mismatch. S3 reports ${headResponse.ContentLength} bytes, but request claims ${size} bytes.` 
        });
      }
    } catch (err) {
      console.error(`S3 HeadObject check failed for ${s3Key}:`, err.message);
      return res.status(404).json({ error: "File not found in storage. Upload might have failed or aborted." });
    }

    const maxFileSize = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;
    if (size > maxFileSize) {
      return res.status(400).json({ error: "File size exceeds the limit." });
    }

    const currentFilesCount = await redis.llen(filesKey);
    const maxFilesCount = isAdminSession ? 100 : 20;
    if (currentFilesCount >= maxFilesCount) {
      return res.status(400).json({ error: "Session file limit reached." });
    }

    const existingFilesRaw = await redis.lrange(filesKey, 0, -1);
    const existingFiles = existingFilesRaw.map(f => {
      try { return JSON.parse(f); } catch { return null; }
    }).filter(Boolean);
    const totalExistingSize = existingFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const maxTotalStorage = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;

    if (totalExistingSize + size > maxTotalStorage) {
      return res.status(400).json({ error: "Session total storage limit reached." });
    }

    if (existingFiles.some(f => f.hash === hash)) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: s3Key
      })).catch(err => console.error("Failed to delete duplicate file from storage:", err));
      
      return res.status(409).json({ error: "File already uploaded in this session." });
    }

    const fileMeta = {
      id: fileId,
      name,
      size,
      mimeType,
      uploadedAt: Date.now(),
      s3Key,
      hash,
    };

    const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
    const metadataExpiry = isAdminSession ? 86400 * 365 : 86400 * 2; // 1 year or 48 hours

    await redis.lpush(filesKey, JSON.stringify(fileMeta));
    await redis.expire(filesKey, metadataExpiry);

    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    await Promise.all([
      redis.expire(textKey, metadataExpiry),
      redis.expire(activeKey, activeExpiry),
      redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
      redis.sadd(ALL_SESSIONS_KEY, sessionId)
    ]);

    if (fileMeta.mimeType && fileMeta.mimeType.startsWith("image/")) {
      try {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: fileMeta.s3Key,
        });
        fileMeta.previewUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
      } catch (err) {
        console.error("Preview URL generation failed on upload", err);
      }
    }

    if (io) {
      io.to(sessionId).emit("file_uploaded", fileMeta);
    }

    res.json(fileMeta);
  } catch (error) {
    console.error("Confirmation error:", error);
    res.status(500).json({ error: "Failed to confirm upload" });
  }
}

// Download File
async function downloadFile(req, res) {
  try {
    const s3Key = req.query.s3Key;
    if (!s3Key) return res.status(400).json({ error: "Missing s3Key" });

    const sessionId = s3Key.split("/")[0];
    if (!sessionId || s3Key.indexOf("/") === -1) {
      return res.status(400).json({ error: "Invalid S3 key structure." });
    }

    const isActive = await redis.exists(`session:${sessionId}:active`);
    if (!isActive) {
      return res.status(403).json({ error: "Session has expired or is unauthorized." });
    }

    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    // Security validation: Require token for downloading in admin session
    if (isAdminSession) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(" ")[1];
      const isValid = await verifyAdminToken(sessionId, token);

      if (!isValid) {
        return res.status(401).json({ error: "Unauthorized access. Passcode required." });
      }
    }

    const { client, bucket } = getStorageClientAndBucket(sessionId);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });
    const signedUrl = await getSignedUrl(client, command, { expiresIn: 86400 });
    res.json({ url: signedUrl });
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Could not generate download link" });
  }
}

// Initialize Session
async function initSession(req, res) {
  const { sessionId } = req.params;
  try {
    const activeKey = `session:${sessionId}:active`;
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
    
    const activeExpiry = isAdminSession ? 86400 * 365 : 86400;
    
    await Promise.all([
      redis.set(activeKey, "1", "EX", activeExpiry),
      redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
      redis.sadd(ALL_SESSIONS_KEY, sessionId)
    ]);
    res.json({ success: true });
  } catch (e) {
    console.error(`Failed to initialize session ${sessionId}:`, e);
    res.status(500).json({ error: "Failed to initialize session" });
  }
}

// Create Share Expiring Passcode
async function createSharePasscode(req, res) {
  const { sessionId } = req.params;
  const { 
    durationSeconds = 3600, 
    passcode: customPasscode, 
    maxUses, 
    label,
    permissions = { allowText: true, allowFiles: true, allowUploads: true }
  } = req.body;

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "Expiring passcodes are only supported for reserved admin sessions." });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  const isValid = await verifyMasterAdminToken(sessionId, token);

  if (!isValid) {
    return res.status(401).json({ error: "Unauthorized. Master admin token required." });
  }

  let passcode = customPasscode ? String(customPasscode).trim() : "";
  if (!passcode) {
    passcode = Math.floor(100000 + Math.random() * 900000).toString();
  }

  const duration = Math.min(Math.max(parseInt(durationSeconds, 10) || 3600, 60), 7 * 86400);
  const guestKey = `session:${sessionId}:guest_passcode:${passcode}`;

  const payload = {
    passcode,
    label: label || `Passcode ${passcode}`,
    createdAt: Date.now(),
    expiresAt: Date.now() + (duration * 1000),
    durationSeconds: duration,
    maxUses: maxUses ? parseInt(maxUses, 10) : null,
    uses: 0,
    permissions: {
      allowText: permissions?.allowText !== false,
      allowFiles: permissions?.allowFiles !== false,
      allowUploads: permissions?.allowUploads !== false
    }
  };

  await redis.set(guestKey, JSON.stringify(payload), "EX", duration);

  const setKey = `session:${sessionId}:guest_passcodes_set`;
  await redis.sadd(setKey, passcode);
  await redis.expire(setKey, 86400 * 365);

  res.json({
    success: true,
    passcode: {
      ...payload,
      remainingSeconds: duration
    }
  });
}

// List Share Passcodes
async function listSharePasscodes(req, res) {
  const { sessionId } = req.params;
  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "Expiring passcodes are only supported for reserved admin sessions." });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  const isValid = await verifyMasterAdminToken(sessionId, token);

  if (!isValid) {
    return res.status(401).json({ error: "Unauthorized. Master admin token required." });
  }

  const setKey = `session:${sessionId}:guest_passcodes_set`;
  const passcodesList = await redis.smembers(setKey);

  const activePasscodes = [];
  const stalePasscodes = [];

  for (const code of passcodesList) {
    const guestKey = `session:${sessionId}:guest_passcode:${code}`;
    const rawData = await redis.get(guestKey);
    const ttl = await redis.ttl(guestKey);

    if (!rawData || ttl <= 0) {
      stalePasscodes.push(code);
    } else {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
          stalePasscodes.push(code);
        } else {
          activePasscodes.push({
            ...parsed,
            permissions: parsed.permissions || { allowText: true, allowFiles: true, allowUploads: true },
            remainingSeconds: ttl > 0 ? ttl : 0
          });
        }
      } catch (e) {
        stalePasscodes.push(code);
      }
    }
  }

  if (stalePasscodes.length > 0) {
    await redis.srem(setKey, ...stalePasscodes);
  }

  res.json({ passcodes: activePasscodes });
}

// Revoke Share Passcode
async function revokeSharePasscode(req, res, io) {
  const { sessionId, code } = req.params;
  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "Expiring passcodes are only supported for reserved admin sessions." });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  const isValid = await verifyMasterAdminToken(sessionId, token);

  if (!isValid) {
    return res.status(401).json({ error: "Unauthorized. Master admin token required." });
  }

  const guestKey = `session:${sessionId}:guest_passcode:${code}`;
  const setKey = `session:${sessionId}:guest_passcodes_set`;

  await redis.del(guestKey);
  await redis.srem(setKey, code);

  const tokenSetKey = `session:${sessionId}:passcode_tokens:${code}`;
  const associatedTokens = await redis.smembers(tokenSetKey);
  if (associatedTokens && associatedTokens.length > 0) {
    const pipeline = redis.pipeline();
    associatedTokens.forEach(t => {
      pipeline.del(`session:${sessionId}:token:${t}`);
    });
    pipeline.del(tokenSetKey);
    await pipeline.exec();
  }

  if (io) {
    io.to(sessionId).emit("passcode_revoked", { passcode: code });
  }

  res.json({ success: true, code });
}

// Update Share Passcode Permissions
async function updateSharePasscodePermissions(req, res, io) {
  const { sessionId, code } = req.params;
  const { permissions } = req.body;

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "Expiring passcodes are only supported for reserved admin sessions." });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  const isValid = await verifyMasterAdminToken(sessionId, token);

  if (!isValid) {
    return res.status(401).json({ error: "Unauthorized. Master admin token required." });
  }

  const guestKey = `session:${sessionId}:guest_passcode:${code}`;
  const rawData = await redis.get(guestKey);
  if (!rawData) {
    return res.status(404).json({ error: "Passcode not found or expired." });
  }

  let parsed = {};
  try { parsed = JSON.parse(rawData); } catch (e) {}

  const newPermissions = {
    allowText: permissions?.allowText !== false,
    allowFiles: permissions?.allowFiles !== false,
    allowUploads: permissions?.allowUploads !== false
  };

  parsed.permissions = newPermissions;

  const ttl = await redis.ttl(guestKey);
  if (ttl > 0) {
    await redis.set(guestKey, JSON.stringify(parsed), "EX", ttl);
  } else {
    await redis.set(guestKey, JSON.stringify(parsed));
  }

  // Update active guest tokens generated from this passcode
  const tokenSetKey = `session:${sessionId}:passcode_tokens:${code}`;
  const associatedTokens = await redis.smembers(tokenSetKey);
  if (associatedTokens && associatedTokens.length > 0) {
    for (const t of associatedTokens) {
      const tKey = `session:${sessionId}:token:${t}`;
      const tVal = await redis.get(tKey);
      if (tVal) {
        try {
          const tParsed = JSON.parse(tVal);
          tParsed.permissions = newPermissions;
          const tTtl = await redis.ttl(tKey);
          if (tTtl > 0) {
            await redis.set(tKey, JSON.stringify(tParsed), "EX", tTtl);
          } else {
            await redis.set(tKey, JSON.stringify(tParsed));
          }
        } catch (e) {}
      }
    }
  }

  // Broadcast real-time permission update via WebSockets
  if (io) {
    io.to(sessionId).emit("passcode_permissions_updated", { passcode: code, permissions: newPermissions });
  }

  res.json({ success: true, code, permissions: newPermissions });
}

module.exports = {
  unlockSession,
  getSession,
  deleteSession,
  presignUpload,
  confirmUpload,
  downloadFile,
  initSession,
  createSharePasscode,
  listSharePasscodes,
  revokeSharePasscode,
  updateSharePasscodePermissions
};
