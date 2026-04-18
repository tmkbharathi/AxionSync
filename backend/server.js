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
});

// Configure disk storage for performance (prevents RAM exhaustion)
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

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

      const [isActive, text, filesCount, isPurged] = await Promise.all([
        redis.exists(activeKey),
        redis.get(textKey),
        redis.llen(filesKey),
        redis.get(`session:${sessionId}:purged_empty`)
      ]);

      if (!isActive && text === null && filesCount === 0) {
        if (isPurged) {
          return res.status(410).json({ error: "purged_due_to_inactivity" });
        }
        return res.status(404).json({ error: "Session not found or expired" });
      }

      const filesRaw = await redis.lrange(filesKey, 0, -1);
      const files = await Promise.all(
        filesRaw.map(async (f) => {
          const file = JSON.parse(f);
          // Add signed preview URL for images
          if (file.mimeType && file.mimeType.startsWith("image/")) {
            try {
              const command = new GetObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: file.s3Key,
              });
              file.previewUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hr expiry
            } catch (err) {
              console.error("Preview URL generation failed", err);
            }
          }
          return file;
        })
      );

      // Refresh activity and session tracking
      await Promise.all([
        redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
        redis.sadd(ALL_SESSIONS_KEY, sessionId)
      ]);

      if (!isActive) {
        await redis.set(activeKey, "1", "EX", 86400);
      }

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

      for (const file of files) {
        try {
          await s3.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET_NAME,
            Key: file.s3Key
          }));
        } catch (err) {
          console.error(`Failed to delete file ${file.s3Key} from S3:`, err);
        }
      }

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

// Upload file to R2 through backend
// ...
app.post("/upload/:sessionId", upload.single("file"), async (req, res) => {
  const { sessionId } = req.params;
  const file = req.file;

  if (!file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const filesKey = `session:${sessionId}:files`;

    // 1. Limit total files per session (max 20)
    const currentFilesCount = await redis.llen(filesKey);
    if (currentFilesCount >= 20) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path); // Clean up temp file
      return res.status(400).json({ error: "Session file limit (20) reached. Please delete old files." });
    }

    // 2. Hash check for duplicate uploads (Calculate from disk)
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    
    const existingFilesRaw = await redis.lrange(filesKey, 0, -1);
    const existingFiles = existingFilesRaw.map(f => JSON.parse(f));

    if (existingFiles.some(f => f.hash === fileHash)) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path); // Clean up temp file
      return res.status(409).json({ error: "File already uploaded in this session." });
    }

    const fileId = `${Date.now()}-${file.originalname}`;
    const s3Key = `${sessionId}/${fileId}`;

    // 3. Upload to R2 from disk stream (Better performance)
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Body: fs.createReadStream(file.path),
      ContentType: file.mimetype,
      ContentLength: file.size,
    });
    await s3.send(uploadCommand);

    // 4. Cleanup local temp file immediately after upload
    fs.unlinkSync(file.path);

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
    await redis.expire(filesKey, 86400);

    // Reset text expiry so session stays alive
    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    await Promise.all([
      redis.expire(textKey, 86400),
      redis.expire(activeKey, 86400),
      redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
      redis.sadd(ALL_SESSIONS_KEY, sessionId)
    ]);

    // Notify clients in session
    io.to(sessionId).emit("file_uploaded", fileMeta);

    res.json(fileMeta);
  } catch (error) {
    console.error("Upload error:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path); // Ensure cleanup on error
    }
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
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 86400 });
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
    await Promise.all([
      redis.set(activeKey, "1", "EX", 86400), // 24 hours heartbeat
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
      await Promise.all([
        redis.expire(`session:${sessionId}:active`, 86400),
        redis.expire(`session:${sessionId}:text`, 86400),
        redis.expire(`session:${sessionId}:files`, 86400),
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

    // Save to Redis and refresh heartbeat
    const activeKey = `session:${sessionId}:active`;
    await Promise.all([
      redis.set(textKey, normalized, "EX", 86400),
      redis.expire(activeKey, 86400),
      redis.set(`session:${sessionId}:last_active`, Date.now().toString()),
      redis.sadd(ALL_SESSIONS_KEY, sessionId)
    ]);

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
// Ran every hour: deletes files older than 1 hr from R2
cron.schedule("0 * * * *", async () => {
  console.log("Running hourly R2 cleanup job...");
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 86400 * 1000);
    let isTruncated = true;
    let continuationToken = undefined;

    while (isTruncated) {
      const listCommand = new ListObjectsV2Command({
        Bucket: S3_BUCKET_NAME,
        ContinuationToken: continuationToken,
      });
      const response = await s3.send(listCommand);
      const objects = response.Contents || [];

      const keysToDelete = [];
      for (const obj of objects) {
        if (obj.LastModified && obj.LastModified < twentyFourHoursAgo) {
          try {
            // Extract sessionId from the key (format: sessionId/fileId)
            const sessionId = obj.Key.split("/")[0];
            
            // Check if session is still active in Redis
            // If the key exists, the session is considered "alive" and we keep the files
            const isActive = await redis.exists(`session:${sessionId}:active`);
            
            if (!isActive) {
              keysToDelete.push({ Key: obj.Key });
            }
          } catch (err) {
            console.error(`Error checking activity for ${obj.Key}:`, err);
          }
        }
      }

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

    // --- SESSION AUTO-CLEANUP (EMPTY ROOMS) ---
    console.log("Running hourly session inactivity cleanup...");
    const oneHourAgo = Date.now() - 3600 * 1000;
    const sessionIds = await redis.smembers(ALL_SESSIONS_KEY);

    for (const sessionId of sessionIds) {
      try {
        const activeKey = `session:${sessionId}:active`;
        const textKey = `session:${sessionId}:text`;
        const filesKey = `session:${sessionId}:files`;
        const lastActiveKey = `session:${sessionId}:last_active`;

        const [isActive, text, filesCount, lastActive] = await Promise.all([
          redis.exists(activeKey),
          redis.get(textKey),
          redis.llen(filesKey),
          redis.get(lastActiveKey)
        ]);

        // If session keys don't exist anymore, remove from tracking set
        if (!isActive && text === null && filesCount === 0) {
          await redis.srem(ALL_SESSIONS_KEY, sessionId);
          continue;
        }

        // Logic for empty session cleanup
        const isEmpty = (!text || text.trim() === "") && filesCount === 0;
        const lastActiveTs = lastActive ? parseInt(lastActive) : 0;

        if (isEmpty && lastActiveTs < oneHourAgo) {
          console.log(`[CLEANUP] Deleting empty session: ${sessionId}`);
          
          // Set "purged" marker for 24 hours
          await redis.set(`session:${sessionId}:purged_empty`, "1", "EX", 86400);
          
          // Delete all data
          await redis.del(activeKey, textKey, filesKey, lastActiveKey);
          await redis.srem(ALL_SESSIONS_KEY, sessionId);
          
          // Notify clients
          io.to(sessionId).emit("session_deleted");
        }
      } catch (err) {
        console.error(`Error during session cleanup for ${sessionId}:`, err);
      }
    }
    console.log("Session inactivity cleanup finished.");
  } catch (err) {
    console.error("Cleanup job error:", err);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
