# AxionSync — Real-time Synchronized Digital Workspace

A premium, high-performance real-time data and file synchronization platform. Built to function as a seamless bridge between your devices, **AxionSync** combines the power of WebSockets with a state-of-the-art UI to provide an instantaneous, secure, and ephemeral synchronization experience.

---

## ✨ Premium Features

- **⚡ Real-time Clipboard Sync**: Instant text synchronization across all connected devices using high-performance WebSockets.
- **📁 Hybrid S3/R2 Storage**: Seamless file uploads powered by a dual S3 backend (Supabase Storage for Standard sessions, Cloudflare R2 for Reserved sessions).
- **🎨 Interactive UI/UX**:
    - **Sync Pulse Visualizer**: Real-time 3D/GLSL animations that react to data flow.
    - **Glassmorphism Design**: A sleek, modern aesthetic with vibrant gradients and blur effects.
    - **Framer Motion Animations**: Fluid transitions and micro-interactions for a premium feel.
- **👥 Presence Avatars**: See who's currently in your sync room with live presence indicators.
- **🕵️ Privacy Mode**: Toggle stealth mode to mask sensitive content in the UI.
- **🖥️ Terminal-Style Activity Log**: Monitor your sync stream with a developer-grade activity feed.
- **📱 Progressive Web App (PWA)**: Installable on mobile and desktop for a native-like experience.
- **⏳ Ephemeral Architecture**: Standard session data automatically self-destructs after 24 hours of inactivity; Reserved Session data is kept for up to 1 year.

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS 4
- **Animations**: Framer Motion & Lucide React
- **Graphics**: Three.js & React Three Fiber (for the Sync Pulse)
- **Client**: Socket.io-client

### Backend
- **Server**: Express 5 (Node.js)
- **Real-time**: Socket.io
- **Storage**: Dynamic hybrid storage (Supabase S3-compatible for Standard, Cloudflare R2 for Reserved Sessions)
- **Database/Cache**: Upstash Redis (for ephemeral text sync and session state)
- **Task Scheduling**: Node-cron (for automated multi-backend S3/R2 storage cleanup)

---

## 🚀 Getting Started

### 1. Repository Setup
```bash
git clone https://github.com/yourusername/axionsync.git
cd axionsync
```

### 2. Backend Configuration
Navigate to the `backend` directory and install dependencies:
```bash
cd backend
npm install
```
Create a `.env` file in the `backend` folder:
```env
PORT=3001
REDIS_URL=<your-upstash-redis-url>

# Supabase Storage (For Standard Sessions)
S3_ENDPOINT=<your-supabase-s3-endpoint>
S3_REGION=<your-region>
S3_ACCESS_KEY_ID=<your-supabase-access-key>
S3_SECRET_ACCESS_KEY=<your-supabase-secret-key>
S3_BUCKET_NAME=clipbridge

# Cloudflare R2 Storage (For Reserved Session only)
R2_ENDPOINT=https://<your-cloudflare-account-id>.r2.cloudflarestorage.com
R2_REGION=auto
R2_ACCESS_KEY_ID=<your-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<your-r2-secret-access-key>
R2_BUCKET_NAME=<your-r2-bucket-name>

# Admin Configuration
ADMIN_SESSION_ID=<your-admin-session-id>
ADMIN_PASSWORD=<your-admin-password>

FRONTEND_URL=http://localhost:3000
```
Run the backend:
```bash
npm run dev
```

### 3. Frontend Configuration
Navigate to the `frontend` directory and install dependencies:
```bash
cd ../frontend
npm install
```
Create a `.env.local` file in the `frontend` folder:
```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```
Run the frontend:
```bash
npm run dev
```

---

## 🛡️ Security & Privacy

- **Session Isolation**: Each room is isolated using a unique UUID. Data is only broadcast to members of the specific room.
- **Data Expiry**: Every Standard Redis key is set with a 24-hour TTL (refreshed on activity). Reserved Sessions have a 1-year TTL.
- **Pre-signed URLs**: Files are never served publicly. The backend dynamically generates temporary pre-signed S3/R2 URLs that expire after 1 hour.
- **CORS Protection**: The API and WebSocket server only allow requests from the designated `FRONTEND_URL`.

---

## 📄 License

This project is licensed under the **ISC License**. See the [LICENSE](LICENSE) file for more details.

---

## ✨ Special Thanks

A huge thank you to **Google Antigravity** for the advanced AI assistance in architecting and refining this platform.

---

> Built with ❤️ by the AxionSync Team. Optimized for the modern web.
