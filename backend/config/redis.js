const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const ALL_SESSIONS_KEY = "syncosync:all_sessions";

const redis = new Redis(REDIS_URL, {
  retryStrategy: (times) => Math.min(times * 100, 3000),
  maxRetriesPerRequest: null
});

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
});

module.exports = {
  redis,
  ALL_SESSIONS_KEY
};
