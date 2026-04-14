# Aether - Full Deployment Guide

Aether is a real-time text and file sync application built to operate completely on free-tier cloud resources. This document outlines the exact deployment steps, environment variable configurations, and scaling/security strategies.

## 1. Upstash Redis (Database) Setup
We use Upstash Redis to store the real-time clipboard text and file metadata with auto-expiration (TTL).
1. Go to [Upstash](https://console.upstash.com/).
2. Create a new Redis database (choose the region closest to your Render region).
3. Under the **Details** tab, scroll to the **Node** connection snippet and copy the `REDIS_URL`.
   - Format looks like: `rediss://default:password@xyz.upstash.io:6379`
   - Note: Upstash uses `rediss://` (with double `s`) for TLS connections.
4. Save this URL for the backend deployment.

## 2. Supabase Storage Setup
We use Supabase Storage (S3-compatible) for free-tier object storage without needing a credit card.

1. Go to [Supabase](https://supabase.com/) and sign up (GitHub login works).
2. Create a new project (e.g. `clipbridge`).
3. In the left sidebar, click **Storage** → **New bucket**.
   - Name it `clipbridge`
   - Toggle **Public bucket** to ON
4. Go to **Project Settings** (gear icon) → **Storage** → scroll to **S3 Credentials**.
5. Enable S3 access and note down:
   - **Endpoint** (e.g. `https://<project-ref>.storage.supabase.co/storage/v1/s3`)
   - **Region** (e.g. `ap-south-1`)
   - **Access Key ID**
   - **Secret Access Key**
6. Save these for backend deployment.

> **Free Tier**: Supabase offers 1 GB of storage on the free plan with no credit card required.

## 3. Render (Backend) Setup
We use Render to host the Node.js WebSocket + API server.
1. Go to [Render](https://dashboard.render.com/) and create a new **Web Service**.
2. Connect your GitHub repository.
3. Set the following Build and Run details:
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add the following **Environment Variables**:
   - `PORT`: `3001`
   - `REDIS_URL`: `<Upstash Redis URL (rediss://...)>`
   - `S3_ENDPOINT`: `<Supabase S3 Endpoint URL>`
   - `S3_REGION`: `<Supabase Region, e.g. ap-south-1>`
   - `S3_ACCESS_KEY_ID`: `<Supabase Access Key ID>`
   - `S3_SECRET_ACCESS_KEY`: `<Supabase Secret Access Key>`
   - `S3_BUCKET_NAME`: `clipbridge`
   - `FRONTEND_URL`: `<Placeholder for Vercel URL, e.g. https://your-app.vercel.app>`
5. Click **Deploy**. Note the Render deploy URL (e.g., `https://clipbridge-backend.onrender.com`).

> **Cold Start Handling:** Render's free tier spins down the server after 15 minutes of inactivity. The frontend has reconnect logic built into Socket.IO to handle this seamlessly, though the first request might take ~30 seconds after a cold start.

## 4. Vercel (Frontend) Setup
We use Vercel to host the Next.js frontend.
1. Go to [Vercel](https://vercel.com/) and click **Add New Project**.
2. Import your GitHub repository.
3. Configure the **Framework Preset** as `Next.js` (auto-detected).
4. Set the **Root Directory** to `frontend`.
5. Add the following **Environment Variables**:
   - `NEXT_PUBLIC_SOCKET_URL`: `<Your Render Backend URL>` (e.g. `https://clipbridge-backend.onrender.com`)
   - `NEXT_PUBLIC_API_URL`: `<Your Render Backend URL>`
6. Click **Deploy**.
7. Once deployed, copy the Vercel URL and update the `FRONTEND_URL` environment variable in your Render dashboard so CORS is fully configured.
8. Trigger a **Manual Redeploy** on Render after updating `FRONTEND_URL`.

---

## 5. Security Best Practices
- **Session Isolation**: Each session generates a UUID. Real-time data is only emitted to users inside that specific Socket.IO room.
- **Auto-Expiration (TTL)**: The server sets a 3600-second (1 hour) TTL on all Redis keys. Data self-destructs automatically.
- **Signed S3 URLs**: The frontend never receives raw public file URLs. The backend generates pre-signed GET URLs that expire in 1 hour via `@aws-sdk/s3-request-presigner`.
- **CORS Protection**: The Express REST API and Socket.IO server are configured to only allow origins matching `FRONTEND_URL`.
- **Payload Limits**: `multer` middleware limits uploads to 50MB before streaming to Supabase Storage.

## 6. Cleanup & Constraints Strategies
- **Redis Limits**: Upstash free tier has a daily command limit. By enforcing the `EX` flag on every Redis write, the DB stays lean and within limits automatically.
- **Supabase Storage**: 1GB free storage with no egress fees. An hourly cron job in `server.js` auto-deletes blobs older than 1 hour from Supabase Storage as a safety net in addition to Redis TTL.
- **Memory Consumption**: `multer.memoryStorage()` with a 50MB chunk limit prevents any single upload from exhausting the Render container's RAM.

## 7. Scalability Limits & Future Upgrades
- If you need files larger than 50MB, transition from `multer.memoryStorage()` to client-side presigned POST uploads directly to Supabase to save server memory.
- For scaling beyond a single Node instance, implement `@socket.io/redis-adapter` using the same Upstash Redis instance to replicate WebSocket messages across horizontal Render instances on a paid plan.
- Consider moving to Supabase Realtime or a dedicated message broker (e.g. PubSub) for extreme scale.
