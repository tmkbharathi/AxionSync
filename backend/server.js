require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const multer = require("multer");
const Redis = require("ioredis");
const cron = require("node-cron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const server = http.createServer(app);

// Environment variables
const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_REGION = process.env.S3_REGION || "auto";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || "clipbridge";

// Cloudflare R2 configuration (For Reserved Session only)
const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_REGION = process.env.R2_REGION || "auto";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const ALL_SESSIONS_KEY = "syncosync:all_sessions";

const redis = new Redis(REDIS_URL, {
  retryStrategy: (times) => Math.min(times * 100, 3000),
  maxRetriesPerRequest: null
});

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
});

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

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for many S3-compatible providers like Supabase
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const r2Client = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for Backblaze B2 and fully supported by Cloudflare R2
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const getStorageClientAndBucket = (sessionId) => {
  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (isAdminSession && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return { client: r2Client, bucket: R2_BUCKET_NAME };
  }
  return { client: s3, bucket: S3_BUCKET_NAME };
};

// Multer setup removed (uploads are handled direct-to-S3)

// --- API ROUTES ---

// Root route for connection test
app.get("/", (req, res) => {
  res.json({ status: "alive", message: "AxionSync API is running" });
});

// Health check for Render
app.get("/health", (req, res) => res.send("OK"));

// Session Routes (Moved to top priority)
app.route("/session/:sessionId")
  .get(async (req, res) => {
    const { sessionId } = req.params;
    try {
      const activeKey = `session:${sessionId}:active`;
      const textKey = `session:${sessionId}:text`;
      const filesKey = `session:${sessionId}:files`;
      const lastActiveKey = `session:${sessionId}:last_active`;

      // Optimized: Use pipeline for initial check
      const [[, isActive], [, text], [, filesCount], [, isPurged]] = await redis.pipeline()
        .exists(activeKey)
        .get(textKey)
        .llen(filesKey)
        .get(`session:${sessionId}:purged_empty`)
        .exec();

      const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

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
      
      // Memory Optimization: Only generate URLs if client needs them or if files exist
      const files = filesCount > 0 
        ? await Promise.all(
          filesRaw.map(async (f) => {
            const file = JSON.parse(f);
            // Add signed preview URL for images - only for small images or first few for performance
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

      // Optimized: Use pipeline for refreshes
      await redis.pipeline()
        .set(lastActiveKey, Date.now().toString())
        .sadd(ALL_SESSIONS_KEY, sessionId)
        .set(activeKey, "1", "EX", isAdminSession ? 86400 * 365 : 86400)
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

      // 1. Get all files to delete from S3
      const filesRaw = await redis.lrange(filesKey, 0, -1);
      const files = filesRaw.map(f => JSON.parse(f));

      // Optimized: Delete from S3 in parallel
      const { client, bucket } = getStorageClientAndBucket(sessionId);
      await Promise.all(files.map(file => 
        client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: file.s3Key
        })).catch(err => console.error(`Failed to delete file ${file.s3Key} from S3:`, err))
      ));

      // 2. Delete all keys from Redis
      await redis.del(activeKey, textKey, filesKey, `session:${sessionId}:last_active`, `session:${sessionId}:purged_empty`);
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

  try {
    const filesKey = `session:${sessionId}:files`;
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

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
    const existingFiles = existingFilesRaw.map(f => JSON.parse(f));
    const totalExistingSize = existingFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const maxTotalStorage = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;

    if (totalExistingSize + fileSize > maxTotalStorage) {
      return res.status(400).json({ error: `Session total storage limit (${isAdminSession ? "1GB" : "50MB"}) reached. Please delete old files.` });
    }

    // Generate pre-signed PUT URL
    const fileId = `${Date.now()}-${fileName}`;
    const s3Key = `${sessionId}/${fileId}`;

    const { client, bucket } = getStorageClientAndBucket(sessionId);
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

// Confirm direct S3 upload and write metadata to Redis
app.post("/session/:sessionId/upload/confirm", async (req, res) => {
  const { sessionId } = req.params;
  const { fileId, name, size, mimeType, s3Key, hash } = req.body;

  if (!fileId || !name || !size || !mimeType || !s3Key || !hash) {
    return res.status(400).json({ error: "Missing required metadata for confirmation" });
  }

  try {
    const filesKey = `session:${sessionId}:files`;
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    // 1. Enforce limits on confirmation (defense in depth)
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
    const existingFiles = existingFilesRaw.map(f => JSON.parse(f));
    const totalExistingSize = existingFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const maxTotalStorage = isAdminSession ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;

    if (totalExistingSize + size > maxTotalStorage) {
      return res.status(400).json({ error: "Session total storage limit reached." });
    }

    // 2. Hash check for duplicate uploads
    if (existingFiles.some(f => f.hash === hash)) {
      // Clean up the object from S3/R2 since it is a duplicate
      const { client, bucket } = getStorageClientAndBucket(sessionId);
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

    const expiryTime = isAdminSession ? 86400 * 365 : 86400;

    // Save metadata to Redis and reset expiry
    await redis.lpush(filesKey, JSON.stringify(fileMeta));
    await redis.expire(filesKey, expiryTime);

    // Reset text expiry so session stays alive
    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    await Promise.all([
      redis.expire(textKey, expiryTime),
      redis.expire(activeKey, expiryTime),
      redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
      redis.sadd(ALL_SESSIONS_KEY, sessionId)
    ]);

    // Add preview URL for immediate display
    if (fileMeta.mimeType && fileMeta.mimeType.startsWith("image/")) {
      try {
        const { client, bucket } = getStorageClientAndBucket(sessionId);
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

app.get("/download", async (req, res) => {
  try {
    const s3Key = req.query.s3Key;
    if (!s3Key) return res.status(400).json({ error: "Missing s3Key" });

    const sessionId = s3Key.split("/")[0];
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
    await Promise.all([
      redis.set(activeKey, "1", "EX", isAdminSession ? 86400 * 365 : 86400), // 1 year for admin, 24 hours for others
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
  socket.on("join_session", async ({ sessionId, deviceInfo, persistentDeviceId }) => {
    socket.join(sessionId);
    socket.sessionId = sessionId; // Store for disconnect handling
    socket.persistentDeviceId = persistentDeviceId;
    socket.deviceInfo = deviceInfo || { name: "Unknown Device", platform: "unknown", browser: "unknown" };

    // Refresh overall session expiry on join
    try {
      const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
      const expiryTime = isAdminSession ? 86400 * 365 : 86400;
      await Promise.all([
        redis.expire(`session:${sessionId}:active`, expiryTime),
        redis.expire(`session:${sessionId}:text`, expiryTime),
        redis.expire(`session:${sessionId}:files`, expiryTime),
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
    // Normalize line endings
    const normalized = content.replace(/\r\n/g, "\n");

    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    const lastActiveKey = `session:${sessionId}:last_active`;

    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
    const expiryTime = isAdminSession ? 86400 * 365 : 86400;

    // Optimized: Use pipeline for updates
    await redis.pipeline()
      .set(textKey, normalized, "EX", expiryTime)
      .expire(activeKey, expiryTime)
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
      const fileStr = filesRaw.find(f => JSON.parse(f).id === file.id);
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

const cleanupBucket = async (client, bucket, isR2 = false) => {
  const twentyFourHoursAgo = new Date(Date.now() - 86400 * 1000);
  let isTruncated = true;
  let continuationToken = undefined;

  while (isTruncated) {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    });
    const response = await client.send(listCommand);
    const objects = response.Contents || [];

    const keysToDelete = [];
    for (const obj of objects) {
      if (obj.Key && obj.LastModified) {
        try {
          // Extract sessionId from the key (format: sessionId/fileId)
          const sessionId = obj.Key.split("/")[0];
          const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

          // Cutoff is 1 year (365 days) for admin, 24 hours for others
          const cutoff = isAdminSession
            ? new Date(Date.now() - 365 * 86400 * 1000)
            : twentyFourHoursAgo;

          if (obj.LastModified < cutoff) {
            if (isAdminSession) {
              // For admin session, delete files older than 1 year
              keysToDelete.push({ Key: obj.Key });
            } else {
              // Check if session is still active in Redis
              const isActive = await redis.exists(`session:${sessionId}:active`);
              if (!isActive) {
                keysToDelete.push({ Key: obj.Key });
              }
            }
          }
        } catch (err) {
          console.error(`Error checking activity for ${obj.Key}:`, err);
        }
      }
    }

    for (const keyObj of keysToDelete) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: keyObj.Key
      }));
      console.log(`Auto-cleaned stale object from ${isR2 ? "R2" : "Supabase"}: ${keyObj.Key}`);
    }

    isTruncated = response.IsTruncated || false;
    continuationToken = response.NextContinuationToken;
  }
};

// --- CRON JOBS FOR AUTO CLEANUP ---
// Ran every hour: deletes inactive/stale files from storage
cron.schedule("0 * * * *", async () => {
  console.log("Running hourly storage cleanup job...");
  try {
    // 1. Cleanup Supabase storage (S3)
    await cleanupBucket(s3, S3_BUCKET_NAME, false);

    // 2. Cleanup Cloudflare R2 storage (only if configured)
    if (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
      await cleanupBucket(r2Client, R2_BUCKET_NAME, true);
    }
    console.log("Hourly storage cleanup finished.");

    // --- SESSION AUTO-CLEANUP (EMPTY ROOMS) ---
    console.log("Running hourly session inactivity cleanup...");
    const oneHourAgo = Date.now() - 3600 * 1000;
    const sessionIds = await redis.smembers(ALL_SESSIONS_KEY);

    // Optimized: Use pipeline to fetch all required data at once
    const pipeline = redis.pipeline();
    sessionIds.forEach(id => {
      if (id !== process.env.ADMIN_SESSION_ID) {
        pipeline.exists(`session:${id}:active`);
        pipeline.get(`session:${id}:text`);
        pipeline.llen(`session:${id}:files`);
        pipeline.get(`session:${id}:last_active`);
      }
    });

    const results = await pipeline.exec();
    const cleanupPipeline = redis.pipeline();

    let resultIndex = 0;
    for (const sessionId of sessionIds) {
      if (sessionId === process.env.ADMIN_SESSION_ID) continue;

      const [err1, isActive] = results[resultIndex++];
      const [err2, text] = results[resultIndex++];
      const [err3, filesCount] = results[resultIndex++];
      const [err4, lastActive] = results[resultIndex++];

      if (err1 || err2 || err3 || err4) continue;

      // If session keys don't exist anymore, remove from tracking set
      if (!isActive && text === null && filesCount === 0) {
        cleanupPipeline.srem(ALL_SESSIONS_KEY, sessionId);
        continue;
      }

      // Logic for empty session cleanup
      const isEmpty = (!text || text.trim() === "") && filesCount === 0;
      const lastActiveTs = lastActive ? parseInt(lastActive) : 0;

      if (isEmpty && lastActiveTs < oneHourAgo) {
        console.log(`[CLEANUP] Deleting empty session: ${sessionId}`);
        
        // Set "purged" marker for 24 hours
        cleanupPipeline.set(`session:${sessionId}:purged_empty`, "1", "EX", 86400);
        
        // Delete all data
        cleanupPipeline.del(`session:${sessionId}:active`, `session:${sessionId}:text`, `session:${sessionId}:files`, `session:${sessionId}:last_active`);
        cleanupPipeline.srem(ALL_SESSIONS_KEY, sessionId);
        
        // Notify clients
        io.to(sessionId).emit("session_deleted");
      }
    }
    await cleanupPipeline.exec();
    console.log("Session inactivity cleanup finished.");
  } catch (err) {
    console.error("Cleanup job error:", err);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
