require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const multer = require("multer");
const Redis = require("ioredis");
const cron = require("node-cron");
const crypto = require("crypto");
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
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const redis = new Redis(REDIS_URL, {
  retryStrategy: (times) => Math.min(times * 100, 3000),
  maxRetriesPerRequest: null
});

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
});

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

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
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// --- API ROUTES ---

// Health check for Render
app.get("/health", (req, res) => res.send("OK"));

// Upload file to R2 through backend
app.post("/upload/:sessionId", upload.single("file"), async (req, res) => {
  const { sessionId } = req.params;
  const file = req.file;

  if (!file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const filesKey = `session:${sessionId}:files`;

    // 1. Limit total files per session (max 20)
    const currentFilesCount = await redis.llen(filesKey);
    if (currentFilesCount >= 20) {
      return res.status(400).json({ error: "Session file limit (20) reached. Please delete old files." });
    }

    // 2. Hash check for duplicate uploads in the same session
    const fileHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const existingFilesRaw = await redis.lrange(filesKey, 0, -1);
    const existingFiles = existingFilesRaw.map(f => JSON.parse(f));

    if (existingFiles.some(f => f.hash === fileHash)) {
      return res.status(409).json({ error: "File already uploaded in this session." });
    }

    const fileId = `${Date.now()}-${file.originalname}`;
    const s3Key = `${sessionId}/${fileId}`;

    // Upload to R2
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });
    await s3.send(uploadCommand);

    const fileMeta = {
      id: fileId,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: Date.now(),
      s3Key,
      hash: fileHash,
    };

    // Save metadata to Redis and reset expiry
    await redis.lpush(filesKey, JSON.stringify(fileMeta));
    await redis.expire(filesKey, 43200);

    // Reset text expiry so session stays alive
    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    await redis.expire(textKey, 43200);
    await redis.expire(activeKey, 43200);

    // Notify clients in session
    io.to(sessionId).emit("file_uploaded", fileMeta);

    res.json(fileMeta);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/download", async (req, res) => {
  try {
    const s3Key = req.query.s3Key;
    if (!s3Key) return res.status(400).json({ error: "Missing s3Key" });

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
    });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 43200 });
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
    await redis.set(activeKey, "1", "EX", 43200); // 12 hours heartbeat
    res.json({ success: true });
  } catch (e) {
    console.error(`Failed to initialize session ${sessionId}:`, e);
    res.status(500).json({ error: "Failed to initialize session" });
  }
});

app.get("/session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const activeKey = `session:${sessionId}:active`;
    const textKey = `session:${sessionId}:text`;
    const filesKey = `session:${sessionId}:files`;

    // A session is valid if it's explicitly active OR has data
    const isActive = await redis.exists(activeKey);
    const text = await redis.get(textKey);
    const filesCount = await redis.llen(filesKey);

    if (!isActive && text === null && filesCount === 0) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    const filesRaw = await redis.lrange(filesKey, 0, -1);
    const files = filesRaw.map(f => JSON.parse(f));

    // Refresh active status if it was about to expire but data still exists
    if (!isActive) {
      await redis.set(activeKey, "1", "EX", 43200);
    }

    res.json({ text: text || "", files });
  } catch (e) {
    console.error("Session load error:", e);
    res.status(500).json({ error: "Failed to load session" });
  }
});

// --- WEBSOCKETS ---

io.on("connection", (socket) => {
  socket.on("join_session", async ({ sessionId, deviceInfo }) => {
    socket.join(sessionId);
    socket.sessionId = sessionId; // Store for disconnect handling
    socket.deviceInfo = deviceInfo || { name: "Unknown Device", platform: "unknown", browser: "unknown" };

    // Refresh overall session expiry on join
    try {
      await redis.expire(`session:${sessionId}:active`, 43200);
      await redis.expire(`session:${sessionId}:text`, 43200);
      await redis.expire(`session:${sessionId}:files`, 43200);
    } catch (e) {
      console.warn("Could not refresh session expiry in Redis:", e.message);
    }

    // Broadcast updated device list to all in room
    const sockets = await io.in(sessionId).fetchSockets();
    const devices = sockets.map(s => ({
      id: s.id,
      info: s.deviceInfo
    }));
    
    io.to(sessionId).emit("room_devices", devices);
    io.to(sessionId).emit("room_size", devices.length);
  });

  socket.on("update_text", async ({ sessionId, content }) => {
    // Normalize line endings
    const normalized = content.replace(/\r\n/g, "\n");

    // Save to Redis and refresh heartbeat
    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    await redis.set(textKey, normalized, "EX", 43200);
    await redis.expire(activeKey, 43200);

    // Broadcast to other clients
    socket.to(sessionId).emit("text_updated", { content: normalized });
  });



  socket.on("delete_file", async ({ sessionId, file }) => {
    try {
      // Delete from S3/R2
      await s3.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: file.s3Key
      }));

      // Remove from Redis
      const filesKey = `session:${sessionId}:files`;
      const filesRaw = await redis.lrange(filesKey, 0, -1);
      const fileStr = filesRaw.find(f => JSON.parse(f).id === file.id);
      if (fileStr) {
        await redis.lrem(filesKey, 1, fileStr);
      }

      io.to(sessionId).emit("file_deleted", file.id);
    } catch (err) {
      console.error("Delete error:", err);
    }
  });

  socket.on("disconnect", async () => {
    if (socket.sessionId) {
      const sockets = await io.in(socket.sessionId).fetchSockets();
      const devices = sockets.map(s => ({
        id: s.id,
        info: s.deviceInfo
      }));
      io.to(socket.sessionId).emit("room_devices", devices);
      io.to(socket.sessionId).emit("room_size", devices.length);
    }
  });
});

// --- CRON JOBS FOR AUTO CLEANUP ---
// Ran every hour: deletes files older than 1 hr from R2
cron.schedule("0 * * * *", async () => {
  console.log("Running hourly R2 cleanup job...");
  try {
    const twelveHoursAgo = new Date(Date.now() - 43200 * 1000);
    let isTruncated = true;
    let continuationToken = undefined;

    while (isTruncated) {
      const listCommand = new ListObjectsV2Command({
        Bucket: S3_BUCKET_NAME,
        ContinuationToken: continuationToken,
      });
      const response = await s3.send(listCommand);
      const objects = response.Contents || [];

      const keysToDelete = objects
        .filter(obj => obj.LastModified && obj.LastModified < twelveHoursAgo)
        .map(obj => ({ Key: obj.Key }));

      for (const keyObj of keysToDelete) {
        await s3.send(new DeleteObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: keyObj.Key
        }));
        console.log(`Auto-cleaned stale object: ${keyObj.Key}`);
      }

      isTruncated = response.IsTruncated || false;
      continuationToken = response.NextContinuationToken;
    }
    console.log("Hourly R2 cleanup finished.");
  } catch (err) {
    console.error("Cleanup job error:", err);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
