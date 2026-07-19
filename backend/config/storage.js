const { S3Client } = require("@aws-sdk/client-s3");

// S3 Standard configurations (Supabase, etc.)
const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_REGION = process.env.S3_REGION || "auto";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || "clipbridge";

// Cloudflare R2 / Backblaze configuration (Reserved Session)
const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_REGION = process.env.R2_REGION || "auto";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "";

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const r2Client = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const getStorageClientAndBucket = (sessionId) => {
  const isAdminSession = sessionId === process.env.ADMIN_SESSION_ID;
  if (isAdminSession && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return { client: r2Client, bucket: R2_BUCKET_NAME };
  }
  return { client: s3, bucket: S3_BUCKET_NAME };
};

module.exports = {
  s3,
  r2Client,
  S3_BUCKET_NAME,
  R2_BUCKET_NAME,
  getStorageClientAndBucket,
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY
};
