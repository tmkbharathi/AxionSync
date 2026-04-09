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
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "clipbridge";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const redis = new Redis(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: null
});

redis.on("error", (error) => {
    // Keeping this silent to prevent console spam when running locally without Redis
});

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
});

// S3 Client for Cloudflare R2
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
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
      Bucket: R2_BUCKET_NAME,
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
    await redis.expire(filesKey, 3600);
    
    // Reset text expiry so session stays alive
    const textKey = `session:${sessionId}:text`;
    const textTtl = await redis.ttl(textKey);
    if(textTtl !== -2) await redis.expire(textKey, 3600);

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
      Bucket: R2_BUCKET_NAME,
      Key: s3Key,
    });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    res.json({ url: signedUrl });
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Could not generate download link" });
  }
});

app.get("/session/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
        const textKey = `session:${sessionId}:text`;
        const historyKey = `session:${sessionId}:history`;
        const filesKey = `session:${sessionId}:files`;
        
        const text = await redis.get(textKey) || "";
        const historyRaw = await redis.lrange(historyKey, 0, 4);
        const filesRaw = await redis.lrange(filesKey, 0, -1);
        const files = filesRaw.map(f => JSON.parse(f));
        res.json({ text, history: historyRaw, files });
    } catch (e) {
        res.status(500).json({error: "Failed to load session"});
    }
});

// --- WEBSOCKETS ---

io.on("connection", (socket) => {
  socket.on("join_session", async ({ sessionId }) => {
    socket.join(sessionId);
    
    // Auto-delete session after 1 hr of inactivity: we can use Redis EXPIRE
    await redis.expire(`session:${sessionId}:text`, 3600);
    await redis.expire(`session:${sessionId}:files`, 3600);
  });

  socket.on("update_text", async ({ sessionId, content }) => {
    // Save to Redis
    const textKey = `session:${sessionId}:text`;
    await redis.set(textKey, content, "EX", 3600);

    // Broadcast to other clients
    socket.to(sessionId).emit("text_updated", { content });
  });

  socket.on("save_history", async ({ sessionId, content }) => {
    const historyKey = `session:${sessionId}:history`;
    await redis.lpush(historyKey, content);
    await redis.ltrim(historyKey, 0, 4); // Keep only last 5
    await redis.expire(historyKey, 3600);
    
    // Broadcast history update
    const newHistory = await redis.lrange(historyKey, 0, 4);
    socket.to(sessionId).emit("text_updated", { content, newHistory });
  });

  socket.on("delete_file", async ({ sessionId, file }) => {
    try {
        // Delete from R2
        await s3.send(new DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
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
    } catch(err) {
        console.error("Delete error:", err);
    }
  });

  socket.on("disconnect", () => {
    // Handle disconnects
  });
});

// --- CRON JOBS FOR AUTO CLEANUP ---
// Ran every hour: deletes files older than 1 hr from R2
cron.schedule("0 * * * *", async () => {
    console.log("Running hourly R2 cleanup job...");
    try {
        const oneHourAgo = new Date(Date.now() - 3600 * 1000);
        let isTruncated = true;
        let continuationToken = undefined;

        while (isTruncated) {
            const listCommand = new ListObjectsV2Command({
                Bucket: R2_BUCKET_NAME,
                ContinuationToken: continuationToken,
            });
            const response = await s3.send(listCommand);
            const objects = response.Contents || [];

            const keysToDelete = objects
                .filter(obj => obj.LastModified && obj.LastModified < oneHourAgo)
                .map(obj => ({ Key: obj.Key }));

            for (const keyObj of keysToDelete) {
                await s3.send(new DeleteObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: keyObj.Key
                }));
                console.log(`Auto-cleaned stale R2 object: ${keyObj.Key}`);
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
