const { GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

const { redis, ALL_SESSIONS_KEY } = require("../config/redis");
const { getStorageClientAndBucket } = require("../config/storage");

// Unlock Session Passcode
async function unlockSession(req, res) {
  const { sessionId } = req.params;
  const { password } = req.body;

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "This session does not require unlocking." });
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tmkbharathi";
  if (password === ADMIN_PASSWORD) {
    // Generate secure random token
    const token = crypto.randomBytes(16).toString("hex");
    const tokenKey = `session:${sessionId}:token`;
    
    // Store in Redis with 24 hours TTL
    await redis.set(tokenKey, token, "EX", 86400);

    return res.json({ success: true, token });
  } else {
    return res.status(401).json({ error: "Invalid passcode." });
  }
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
      const storedToken = await redis.get(`session:${sessionId}:token`);

      if (!token || token !== storedToken) {
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
    const files = filesCount > 0 
      ? await Promise.all(
        filesRaw.map(async (f) => {
          const file = JSON.parse(f);
          if (file.mimeType && file.mimeType.startsWith("image/")) {
            try {
              const { client, bucket } = getStorageClientAndBucket(sessionId);
              const command = new GetObjectCommand({
                Bucket: bucket,
                Key: file.s3Key,
              });
              file.previewUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
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

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.json({ text: text || "", files });
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
      const storedToken = await redis.get(`session:${sessionId}:token`);

      if (!token || token !== storedToken) {
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
    const storedToken = await redis.get(`session:${sessionId}:token`);

    if (!token || token !== storedToken) {
      return res.status(401).json({ error: "Unauthorized access. Passcode required." });
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
    const storedToken = await redis.get(`session:${sessionId}:token`);

    if (!token || token !== storedToken) {
      return res.status(401).json({ error: "Unauthorized access. Passcode required." });
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
      const storedToken = await redis.get(`session:${sessionId}:token`);

      if (!token || token !== storedToken) {
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

module.exports = {
  unlockSession,
  getSession,
  deleteSession,
  presignUpload,
  confirmUpload,
  downloadFile,
  initSession
};
