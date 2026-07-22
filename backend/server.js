require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const cron = require("node-cron");

const rateLimit = require("express-rate-limit");

// Import modular configurations and jobs
const getSessionRouter = require("./routes/sessionRoutes");
const registerSessionHandlers = require("./sockets/sessionSocket");
const { runHourlyCleanup } = require("./jobs/cleanup");

const app = express();
const server = http.createServer(app);

// Trust proxy header if running behind reverse proxy (e.g. Render, Vercel, Nginx)
app.set("trust proxy", 1);

// Environment variables
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Rate Limiters
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: { error: "Too many passcode unlock attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const presignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  message: { error: "Upload presign rate limit exceeded. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: "Too many requests from this IP. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors({ 
  origin: FRONTEND_URL, 
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true 
}));
app.use(express.json());

// Apply rate limiting middleware
app.use("/session/:sessionId/unlock", unlockLimiter);
app.use("/session/:sessionId/upload/presign", presignLimiter);
app.use(generalLimiter);

// Global Request Logger
app.use((req, res, next) => {
  console.log(`[DEBUG] ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
});

// Root route for connection test
app.get("/", (req, res) => {
  res.json({ status: "alive", message: "AxionSync API is running" });
});

// Health check for Render
app.get("/health", (req, res) => res.send("OK"));

// Mount modular session and download routes
app.use("/", getSessionRouter(io));

// 404 Route Handler
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
  registerSessionHandlers(io, socket);
});

// --- CRON JOBS FOR AUTO CLEANUP ---
cron.schedule("0 * * * *", async () => {
  await runHourlyCleanup(io);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
