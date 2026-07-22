const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { redis, ALL_SESSIONS_KEY } = require("../config/redis");
const { getStorageClientAndBucket } = require("../config/storage");

function registerSessionHandlers(io, socket) {
  socket.on("join_session", async ({ sessionId, token, deviceInfo, persistentDeviceId }) => {
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    // Security validation: Require token for joining the admin session WebSocket
    if (isAdminSession) {
      try {
        let isValid = false;
        if (token) {
          const storedToken = await redis.get(`session:${sessionId}:token`);
          if (storedToken && storedToken === token) {
            isValid = true;
          } else {
            isValid = await redis.exists(`session:${sessionId}:token:${token}`);
          }
        }
        if (!isValid) {
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
    socket.token = token;
    socket.persistentDeviceId = persistentDeviceId;
    socket.deviceInfo = deviceInfo || { name: "Unknown Device", platform: "unknown", browser: "unknown" };
    socket.permissions = { allowText: true, allowFiles: true, allowUploads: true };

    // Fetch and cache permissions for guest tokens
    if (isAdminSession && token) {
      try {
        const val = await redis.get(`session:${sessionId}:token:${token}`);
        if (val) {
          const parsed = JSON.parse(val);
          if (parsed.permissions) {
            socket.permissions = parsed.permissions;
          }
        }
      } catch (e) {}
    }

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
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    if (isAdminSession && socket.permissions) {
      if (socket.permissions.allowText === false || socket.permissions.allowUploads === false) {
        return socket.emit("permission_error", { message: "Text editing is disabled for this guest passcode." });
      }
    }

    const normalized = content.replace(/\r\n/g, "\n");

    const textKey = `session:${sessionId}:text`;
    const activeKey = `session:${sessionId}:active`;
    const lastActiveKey = `session:${sessionId}:last_active`;
    
    const activeExpiry = isAdminSession ? 86400 * 365 : 86400;      // 1 year or 24 hours
    const metadataExpiry = isAdminSession ? 86400 * 365 : 86400 * 2; // 1 year or 48 hours

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
    const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;

    if (isAdminSession && socket.permissions) {
      if (socket.permissions.allowFiles === false || socket.permissions.allowUploads === false) {
        return socket.emit("permission_error", { message: "File operations are disabled for this guest passcode." });
      }
    }

    try {
      const { client, bucket } = getStorageClientAndBucket(sessionId);
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: file.s3Key
      }));

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
}

module.exports = registerSessionHandlers;
