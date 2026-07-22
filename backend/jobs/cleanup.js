const { DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { redis, ALL_SESSIONS_KEY } = require("../config/redis");
const { 
  s3, 
  r2Client, 
  S3_BUCKET_NAME, 
  R2_BUCKET_NAME, 
  getStorageClientAndBucket,
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY
} = require("../config/storage");

const cleanupAdminSession = async (client, bucket, isR2 = false) => {
  const adminSessionId = process.env.ADMIN_SESSION_ID;
  if (!adminSessionId) return;

  console.log(`[CLEANUP] Scanning Admin Session folder in ${isR2 ? "R2" : "Supabase S3"}...`);
  const oneYearAgo = new Date(Date.now() - 365 * 86400 * 1000);
  let isTruncated = true;
  let continuationToken = undefined;

  while (isTruncated) {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${adminSessionId}/`,
      ContinuationToken: continuationToken,
    });
    
    const response = await client.send(listCommand);
    const objects = response.Contents || [];

    const keysToDelete = [];
    for (const obj of objects) {
      if (obj.Key && obj.LastModified && obj.LastModified < oneYearAgo) {
        keysToDelete.push({ Key: obj.Key });
      }
    }

    if (keysToDelete.length > 0) {
      // Batch delete up to 1000 items at a time
      for (let i = 0; i < keysToDelete.length; i += 1000) {
        const batch = keysToDelete.slice(i, i + 1000);
        try {
          await client.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch }
          }));
          console.log(`[CLEANUP] Auto-cleaned ${batch.length} stale admin object(s) from ${isR2 ? "R2" : "Supabase S3"}`);
        } catch (err) {
          console.error(`[CLEANUP] Batch delete failed in admin cleanup:`, err);
        }
      }

      // Remove deleted keys from Redis
      try {
        const filesKey = `session:${adminSessionId}:files`;
        const filesRaw = await redis.lrange(filesKey, 0, -1);
        const deletedSet = new Set(keysToDelete.map(k => k.Key));
        for (const f of filesRaw) {
          try {
            const parsed = JSON.parse(f);
            if (deletedSet.has(parsed.s3Key)) {
              await redis.lrem(filesKey, 1, f);
            }
          } catch {}
        }
      } catch (err) {
        console.error(`[CLEANUP] Failed to remove admin files from Redis:`, err);
      }
    }

    isTruncated = response.IsTruncated || false;
    continuationToken = response.NextContinuationToken;
  }
};

const runHourlyCleanup = async (io) => {
  console.log("Running hourly session & storage cleanup job...");
  try {
    // 1. Cleanup Admin Session stale files (older than 1 year)
    await cleanupAdminSession(s3, S3_BUCKET_NAME, false);
    if (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
      await cleanupAdminSession(r2Client, R2_BUCKET_NAME, true);
    }

    // 2. Cleanup Standard Sessions (Redis-driven)
    const sessionIds = await redis.smembers(ALL_SESSIONS_KEY);
    const adminSessionId = process.env.ADMIN_SESSION_ID;
    const oneHourAgo = Date.now() - 3600 * 1000;

    // Use pipeline to fetch status for all sessions at once
    const pipeline = redis.pipeline();
    sessionIds.forEach(id => {
      if (id !== adminSessionId) {
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
      if (sessionId === adminSessionId) continue;

      const [err1, isActive] = results[resultIndex++];
      const [err2, text] = results[resultIndex++];
      const [err3, filesCount] = results[resultIndex++];
      const [err4, lastActive] = results[resultIndex++];

      if (err1 || err2 || err3 || err4) continue;

      const filesKey = `session:${sessionId}:files`;

      // A. If the session is inactive (expired due to 24h inactivity)
      if (!isActive) {
        console.log(`[CLEANUP] Standard session expired: ${sessionId}. Purging files and metadata...`);
        
        // Retrieve files to delete from S3/R2
        const filesRaw = await redis.lrange(filesKey, 0, -1);
        const files = filesRaw.map(f => {
          try { return JSON.parse(f); } catch { return null; }
        }).filter(Boolean);

        if (files.length > 0) {
          const { client, bucket } = getStorageClientAndBucket(sessionId);
          const objectsToDelete = files.map(f => ({ Key: f.s3Key }));
          
          try {
            await client.send(new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objectsToDelete }
            }));
          } catch (err) {
            console.error(`[CLEANUP] Batch delete failed for session ${sessionId}:`, err);
          }
        }

        // Delete Redis keys
        cleanupPipeline.del(
          `session:${sessionId}:active`,
          `session:${sessionId}:text`,
          filesKey,
          `session:${sessionId}:last_active`,
          `session:${sessionId}:purged_empty`
        );
        cleanupPipeline.srem(ALL_SESSIONS_KEY, sessionId);

        // Notify clients if they are somehow connected
        if (io) {
          io.to(sessionId).emit("session_deleted");
        }
        continue;
      }

      // B. If session is active but empty and inactive for > 1 hour, clean it up early
      const isEmpty = (!text || text.trim() === "") && filesCount === 0;
      const lastActiveTs = lastActive ? parseInt(lastActive) : 0;

      if (isEmpty && lastActiveTs < oneHourAgo) {
        console.log(`[CLEANUP] Deleting empty session: ${sessionId}`);
        
        cleanupPipeline.set(`session:${sessionId}:purged_empty`, "1", "EX", 86400);
        cleanupPipeline.del(
          `session:${sessionId}:active`,
          `session:${sessionId}:text`,
          filesKey,
          `session:${sessionId}:last_active`
        );
        cleanupPipeline.srem(ALL_SESSIONS_KEY, sessionId);

        if (io) {
          io.to(sessionId).emit("session_deleted");
        }
      }
    }

    await cleanupPipeline.exec();
    console.log("Hourly storage and session cleanup finished.");
  } catch (err) {
    console.error("Cleanup job error:", err);
  }
};

module.exports = {
  runHourlyCleanup
};
