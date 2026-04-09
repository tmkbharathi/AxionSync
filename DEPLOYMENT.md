# ClipBridge Cloud - Full Deployment Guide

ClipBridge Cloud is a real-time text and file sync application built to operate completely on free-tier cloud resources. This document outlines the exact deployment steps, environment variable configurations, and scaling/security strategies.

## 1. Upstash Redis (Database) Setup
We use Upstash Redis to store the real-time clipboard text and file metadata with auto-expiration (TTL).
1. Go to [Upstash](https://console.upstash.com/).
2. Create a new Redis database (Global or region closest to your Render region).
3. Under the "Details" tab, scroll to the "Node" connection snippet and copy the `REDIS_URL`.
   - Format looks like: `redis://default:password@xyz.upstash.io:30541`
4. Save this URL for the backend deployment.

## 2. Cloudflare R2 (Storage) Setup
We use R2 for free-tier object storage without egress bandwidth costs.
1. Sign in to [Cloudflare Dashboard](https://dash.cloudflare.com/) and go to "R2".
2. Click **Create bucket** and name it `clipbridge` (or any unique name).
3. On the right panel, under **Manage R2 API Tokens**, click "Create API token".
4. Give it **Object Read & Write** permissions.
5. Once generated, save the following keys:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID** (You can find this on the R2 dash overview URL or main page).
6. Optionally, set up Lifecycle Rules on the bucket to auto-delete objects older than 1 day to enforce the auto-cleanup policy at the blob storage level.

## 3. Render (Backend) Setup
We use Render to host the Node.js WebSocket + API server.
1. Go to [Render](https://dashboard.render.com/) and create a new **Web Service**.
2. Connect your Git repository (containing the `backend` folder).
3. Set the following Build and Run details:
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add the following **Environment Variables**:
   - `PORT`: `3001`
   - `REDIS_URL`: `<Upstash Redis URL>`
   - `R2_ACCOUNT_ID`: `<Cloudflare Account ID>`
   - `R2_ACCESS_KEY_ID`: `<R2 Access Key>`
   - `R2_SECRET_ACCESS_KEY`: `<R2 Secret Key>`
   - `R2_BUCKET_NAME`: `<R2 Bucket Name>`
   - `FRONTEND_URL`: `<Placeholder for Vercel URL, e.g. https://your-app.vercel.app>`
5. Click **Deploy**. Note the Render deploy URL (e.g., `https://clipbridge-backend.onrender.com`).

> **Cold Start Handling:** Render's free tier spins down the server after 15 minutes of inactivity. The Next.js frontend has a `reconnect` logic built into Socket.IO to handle this seamlessly, though the first file upload might take a few seconds after a cold start.

## 4. Vercel (Frontend) Setup
We use Vercel to host the Next.js React frontend.
1. Go to [Vercel](https://vercel.com/) and click **Add New Project**.
2. Select your repository.
3. Configure the **Framework Preset** as `Next.js`.
4. Set the **Root Directory** to `frontend`.
5. Add the following **Environment Variables**:
   - `NEXT_PUBLIC_SOCKET_URL`: `<Your Render Backend URL>` (e.g., `https://clipbridge-backend.onrender.com`)
   - `NEXT_PUBLIC_API_URL`: `<Your Render Backend URL>`
6. Click **Deploy**.
7. Once deployed, copy the Vercel URL and update the `FRONTEND_URL` environment variable back in your Render dashboard so CORS is fully configured.

---

## 5. Security Best Practices
- **Session Isolation**: Each session generates a UUID. Real-time data is only emitted to users inside that specific Socket.IO room.
- **Auto-Expiration (TTL)**: The Node.js server sets a 3600-second (1 hour) expiration on the Upstash Redis text keys. Therefore, data self-destructs reliably.
- **Signed R2 URLs**: The frontend never receives raw public file URLs. Instead, the Node SDK generates pre-signed GET URLs that expire in 1 hour via `@aws-sdk/s3-request-presigner`.
- **CORS Protection**: The Express REST API and Socket.IO server are configured to only allow origins matching the frontend URL.
- **Payload Limits**: `multer` middleware explicitly limits uploads to 50MB before streaming to S3. 

## 6. Cleanup & Constraints Strategies
- **Redis Limits**: Upstash free tier restricts commands per day and total size. By automatically enforcing the `EX` flag on every write command, we keep the DB constantly clean.
- **R2 Storage**: Since R2 doesn't charge for egress, it makes handling downloads virtually free. The node-cron library is scaffolded in `server.js` to potentially handle complex synchronization, but deploying standard AWS S3 lifecycle rules on the Cloudflare Dashboard handles blob deletions without hitting the backend server's CPU limits.
- **Memory Consumption**: By holding chunk limits via multer memory storage, we prevent a single upload from taking the container down.

## 7. Scalability Limits & Future Upgrades
- If you exceed the 50MB file limit or want larger file handling, transition from `multer.memoryStorage()` to uploading directly from Next.js via presigned POST URLs to save server memory.
- For scaling beyond a single Node instance, implement `@socket.io/redis-adapter` using the same Upstash Redis instance to replicate WebSocket messages across horizontal scaling nodes if you move to a paid Render plan.
