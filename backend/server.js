require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const cron = require("node-cron");
const { GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Import modular configurations
const { redis, ALL_SESSIONS_KEY } = require("./config/redis");
const { 
  getStorageClientAndBucket, 
  R2_ENDPOINT, 
  R2_ACCESS_KEY_ID, 
  R2_SECRET_ACCESS_KEY 
} = require("./config/storage");
const { runHourlyCleanup } = require("./jobs/cleanup");

const app = express();
const server = http.createServer(app);

// Environment variables
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

app.use(cors({ 
  origin: FRONTEND_URL, 
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  credentials: true 
}));
app.use(express.json());

// Global Request Logger
app.use((req, res, next) => {
  console.log(`[DEBUG] ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
});

// --- API ROUTES ---

// Root route for connection test
app.get("/", (req, res) => {
  res.json({ status: "alive", message: "AxionSync API is running" });
});

// Health check for Render
app.get("/health", (req, res) => res.send("OK"));

// Unlock Session Passcode Endpoint
app.post("/session/:sessionId/unlock", async (req, res) => {
  const { sessionId } = req.params;
  const { password } = req.body;

  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (!isAdminSession) {
    return res.status(400).json({ error: "This session does not require unlocking." });
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tmkbharathi";
  if (password === ADMIN_PASSWORD) {
    // Generate secure random token
    const token = require("crypto").randomBytes(16).toString("hex");
    const tokenKey = `session:${sessionId}:token`;
    
    // Store in Redis with 24 hours TTL
    await redis.set(tokenKey, token, "EX", 86400);

    return res.json({ success: true, token });
  } else {
    return res.status(401).json({ error: "Invalid passcode." });
  }
});

// Session Routes
app.route("/session/:sessionId")
  .get(async (req, res) => {
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

      // Optimized: Use pipeline for initial check
      const [[, isActive], [, text], [, filesCount], [, isPurged]] = await redis.pipeline()
        .exists(activeKey)
        .get(textKey)
        .llen(filesKey)
        .get(`session:${sessionId}:purged_empty`)
        .exec();

      if (!isActive && text === null && filesCount === 0) {
        if (isAdminSession) {
          // Special Case: Always allow the admin session to appear "alive"
          await redis.set(activeKey, "1", "EX", 86400 * 365); // 1 year expiry
        } else {
          if (isPurged) {
            return res.status(410).json({ error: "purged_due_to_inactivity" });
          }
          return res.status(404).json({ error: "Session not found or expired" });
        }
      }

      const filesRaw = await redis.lrange(filesKey, 0, -1);
      
      // Memory Optimization: Only generate URLs if files exist
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

      // Expiries: active key is shorter; metadata stays longer so cron can clean it up
      const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
      const metadataExpiry = isAdminSession ? 86400 * 365 : 86400 * 2; // 1 year or 48 hours

      // Optimized: Use pipeline for refreshes
      await redis.pipeline()
        .set(lastActiveKey, Date.now().toString())
        .sadd(ALL_SESSIONS_KEY, sessionId)
        .set(activeKey, "1", "EX", activeExpiry)
        .expire(textKey, metadataExpiry)
        .expire(filesKey, metadataExpiry)
        .exec();

      // Prevent browser caching of dynamic session data
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.json({ text: text || "", files });
    } catch (e) {
      console.error("Session load error:", e);
      res.status(500).json({ error: "Failed to load session" });
    }
  })
  .delete(async (req, res) => {
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

      // 1. Get all files to delete from S3
      const filesRaw = await redis.lrange(filesKey, 0, -1);
      const files = filesRaw.map(f => {
        try { return JSON.parse(f); } catch { return null; }
      }).filter(Boolean);

      // Optimized: Delete from S3 in parallel
      const { client, bucket } = getStorageClientAndBucket(sessionId);
      await Promise.all(files.map(file => 
        client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: file.s3Key
        })).catch(err => console.error(`Failed to delete file ${file.s3Key} from S3:`, err))
      ));

      // 2. Delete all keys from Redis
      await redis.del(activeKey, textKey, filesKey, `session:${sessionId}:last_active`, `session:${sessionId}:purged_empty`, `session:${sessionId}:token`);
      await redis.srem(ALL_SESSIONS_KEY, sessionId);

      // 3. Notify all clients in the session
      io.to(sessionId).emit("session_deleted");

      res.json({ success: true });
    } catch (e) {
      console.error(`Failed to delete session ${sessionId}:`, e);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

// Get pre-signed URL for direct upload to S3/R2
app.post("/session/:sessionId/upload/presign", async (req, res) => {
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

    // 1. Enforce individual file size limit
    const maxFileSize = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;
    if (fileSize > maxFileSize) {
      return res.status(400).json({ error: `File size exceeds the limit of ${isAdminSession ? "1GB" : "50MB"}.` });
    }

    // 2. Limit total files per session (max 20 for standard, 100 for admin)
    const currentFilesCount = await redis.llen(filesKey);
    const maxFilesCount = isAdminSession ? 100 : 20;
    if (currentFilesCount >= maxFilesCount) {
      return res.status(400).json({ error: `Session file limit (${maxFilesCount}) reached. Please delete old files.` });
    }

    // 3. Limit total storage size per session (max 1GB for admin, 50MB for standard)
    const existingFilesRaw = await redis.lrange(filesKey, 0, -1);
    const existingFiles = existingFilesRaw.map(f => {
      try { return JSON.parse(f); } catch { return null; }
    }).filter(Boolean);
    const totalExistingSize = existingFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const maxTotalStorage = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;

    if (totalExistingSize + fileSize > maxTotalStorage) {
      return res.status(400).json({ error: `Session total storage limit (${isAdminSession ? "1GB" : "50MB"}) reached. Please delete old files.` });
    }

    // Generate pre-signed PUT URL
    const fileId = `${Date.now()}-${fileName}`;
    const s3Key = `${sessionId}/${fileId}`;

    const { client, bucket } = getStorageClientAndBucket(sessionId);
    
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 }); // Expires in 15 mins

    res.json({ uploadUrl, fileId, s3Key });
  } catch (error) {
    console.error("Presign upload error:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// Confirm S3 upload and write metadata to Redis
app.post("/session/:sessionId/upload/confirm", async (req, res) => {
  const { sessionId } = req.params;
  const { fileId, name, size, mimeType, s3Key, hash } = req.body;

  if (!fileId || !name || !size || !mimeType || !s3Key || !hash) {
    return res.status(400).json({ error: "Missing required metadata for confirmation" });
  }

  // Security Check 1: Prevent S3 Key Directory Traversal
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

    // Security Check 2: HeadObject check to verify object exists & size matches
    const { client, bucket } = getStorageClientAndBucket(sessionId);
    try {
      const headResponse = await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: s3Key
      }));

      // Validate that size matches the actual uploaded file size
      if (headResponse.ContentLength !== Number(size)) {
        return res.status(400).json({ 
          error: `File size mismatch. S3 reports ${headResponse.ContentLength} bytes, but request claims ${size} bytes.` 
        });
      }
    } catch (err) {
      console.error(`S3 HeadObject check failed for ${s3Key}:`, err.message);
      return res.status(404).json({ error: "File not found in storage. Upload might have failed or aborted." });
    }

    // 1. Enforce limits on confirmation
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

    // 2. Hash check for duplicate uploads
    if (existingFiles.some(f => f.hash === hash)) {
      // Clean up the object from S3/R2 since it is a duplicate
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

    // Save metadata to Redis and reset expiry
    await redis.lpush(filesKey, JSON.stringify(fileMeta));
    await redis.expire(filesKey, metadataExpiry);

    // Reset text expiry so session stays alive
    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    await Promise.all([
      redis.expire(textKey, metadataExpiry),
      redis.expire(activeKey, activeExpiry),
      redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
      redis.sadd(ALL_SESSIONS_KEY, sessionId)
    ]);

    // Add preview URL for immediate display
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

    // Notify clients in session
    io.to(sessionId).emit("file_uploaded", fileMeta);

    res.json(fileMeta);
  } catch (error) {
    console.error("Confirmation error:", error);
    res.status(500).json({ error: "Failed to confirm upload" });
  }
});

// Secure Download Route
app.get("/download", async (req, res) => {
  try {
    const s3Key = req.query.s3Key;
    if (!s3Key) return res.status(400).json({ error: "Missing s3Key" });

    // Security Check 1: Extract and validate sessionId structure
    const sessionId = s3Key.split("/")[0];
    if (!sessionId || s3Key.indexOf("/") === -1) {
      return res.status(400).json({ error: "Invalid S3 key structure." });
    }

    // Security Check 2: Verify if session is active
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
});

// Initialize a session
app.post("/session/:sessionId/init", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const activeKey = `session:${sessionId}:active`;
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
    
    const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
    
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
});

app.use((req, res) => {
  console.log(`[404] No route found for: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: "Not Found", 
    method: req.method, 
    path: req.url,
    suggestion: "Is there a trailing slash mismatch?"
  });
});

// --- WEBSOCKETS ---

io.on("connection", (socket) => {
  socket.on("join_session", async ({ sessionId, token, deviceInfo, persistentDeviceId }) => {
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    // Security validation: Require token for joining the admin session WebSocket
    if (isAdminSession) {
      try {
        const storedToken = await redis.get(`session:${sessionId}:token`);
        if (!token || token !== storedToken) {
          socket.emit("unauthorized", { message: "Invalid session token. Passcode required." });
          socket.disconnect();
          return;
        }
      } catch (err) {
        console.error("Redis token check failed on join_session:", err);
        socket.disconnect();
        return;
      }
    }

    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.persistentDeviceId = persistentDeviceId;
    socket.deviceInfo = deviceInfo || { name: "Unknown Device", platform: "unknown", browser: "unknown" };

    // Refresh overall session expiry on join
    try {
      const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
      const metadataExpiry = isAdminSession ? 86400 * 365 : 86400 * 2; // 1 year or 48 hours

      await Promise.all([
        redis.expire(`session:${sessionId}:active`, activeExpiry),
        redis.expire(`session:${sessionId}:text`, metadataExpiry),
        redis.expire(`session:${sessionId}:files`, metadataExpiry),
        redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
        redis.sadd(ALL_SESSIONS_KEY, sessionId)
      ]);
    } catch (e) {
      console.warn("Could not refresh session expiry in Redis:", e.message);
    }

    // Broadcast updated device list to all in room
    const sockets = await io.in(sessionId).fetchSockets();
    const uniqueDevicesMap = new Map();
    
    sockets.forEach(s => {
      const devId = s.persistentDeviceId || s.id;
      if (!uniqueDevicesMap.has(devId)) {
        uniqueDevicesMap.set(devId, {
          id: s.id,
          info: s.deviceInfo
        });
      }
    });

    const devices = Array.from(uniqueDevicesMap.values());
    io.to(sessionId).emit("room_devices", devices);
    io.to(sessionId).emit("room_size", devices.length);
  });

  socket.on("update_text", async ({ sessionId, content }) => {
    const normalized = content.replace(/\r\n/g, "\n");

    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    const lastActiveKey = `session:${sessionId}:last_active`;

    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
    
    const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
    const metadataExpiry = isAdminSession ? 86400 * 365 : 86400 * 2; // 1 year or 48 hours

    // Optimized: Use pipeline for updates
    await redis.pipeline()
      .set(textKey, normalized, "EX", metadataExpiry)
      .expire(activeKey, activeExpiry)
      .set(lastActiveKey, Date.now().toString())
      .sadd(ALL_SESSIONS_KEY, sessionId)
      .exec();

    // Broadcast to other clients
    socket.to(sessionId).emit("text_updated", { content: normalized });
  });

  socket.on("delete_file", async ({ sessionId, file }) => {
    try {
      // Delete from S3/R2
      const { client, bucket } = getStorageClientAndBucket(sessionId);
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: file.s3Key
      }));

      // Remove from Redis
      const filesKey = `session:${sessionId}:files`;
      const filesRaw = await redis.lrange(filesKey, 0, -1);
      const fileStr = filesRaw.find(f => {
        try { return JSON.parse(f).id === file.id; } catch { return false; }
      });
      if (fileStr) {
        await redis.lrem(filesKey, 1, fileStr);
      }

      await redis.set(`session:${sessionId}:last_active`, Date.now().toString());
      io.to(sessionId).emit("file_deleted", file.id);
    } catch (err) {
      console.error("Delete error:", err);
    }
  });

  socket.on("disconnect", async () => {
    if (socket.sessionId) {
      const sockets = await io.in(socket.sessionId).fetchSockets();
      const uniqueDevicesMap = new Map();
      
      sockets.forEach(s => {
        const devId = s.persistentDeviceId || s.id;
        if (!uniqueDevicesMap.has(devId)) {
          uniqueDevicesMap.set(devId, {
            id: s.id,
            info: s.deviceInfo
          });
        }
      });

      const devices = Array.from(uniqueDevicesMap.values());
      io.to(socket.sessionId).emit("room_devices", devices);
      io.to(socket.sessionId).emit("room_size", devices.length);
    }
  });
});

// --- CRON JOBS FOR AUTO CLEANUP ---
cron.schedule("0 * * * *", async () => {
  await runHourlyCleanup(io);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
