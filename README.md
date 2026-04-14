# Aether — Real-time Synchronized Digital Workspace

A premium, high-performance real-time data and file synchronization platform. Built to function as a seamless bridge between your devices, **Aether** combines the power of WebSockets with a state-of-the-art UI to provide an instantaneous, secure, and ephemeral synchronization experience.

---

## ✨ Premium Features

- **⚡ Real-time Clipboard Sync**: Instant text synchronization across all connected devices using high-performance WebSockets.
- **📁 Secure File Sharing**: Seamless file uploads powered by Supabase S3-compatible storage with pre-signed URL security.
- **🎨 Interactive UI/UX**:
    - **Sync Pulse Visualizer**: Real-time 3D/GLSL animations that react to data flow.
    - **Glassmorphism Design**: A sleek, modern aesthetic with vibrant gradients and blur effects.
    - **Framer Motion Animations**: Fluid transitions and micro-interactions for a premium feel.
- **👥 Presence Avatars**: See who's currently in your sync room with live presence indicators.
- **🕵️ Privacy Mode**: Toggle stealth mode to mask sensitive content in the UI.
- **🖥️ Terminal-Style Activity Log**: Monitor your sync stream with a developer-grade activity feed.
- **📱 Progressive Web App (PWA)**: Installable on mobile and desktop for a native-like experience.
- **⏳ Ephemeral Architecture**: All data (text and files) automatically self-destructs after one hour via Redis TTL and automated cron jobs.

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
- **Storage**: Supabase Storage (S3-compatible) & Multer
- **Database/Cache**: Upstash Redis (for ephemeral text sync and session state)
- **Task Scheduling**: Node-cron (for automated S3 cleanup)

---

## 🚀 Getting Started

### 1. Repository Setup
```bash
git clone https://github.com/yourusername/aether.git
cd aether
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
S3_ENDPOINT=<your-supabase-s3-endpoint>
S3_REGION=<your-region>
S3_ACCESS_KEY_ID=<your-access-key>
S3_SECRET_ACCESS_KEY=<your-secret-key>
S3_BUCKET_NAME=clipbridge
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
- **Data Expiry**: Every Redis key is set with a 3600-second (1 hour) TTL.
- **Pre-signed URLs**: Files are never served publicly. The backend generates temporary pre-signed S3 URLs that expire after 1 hour.
- **CORS Protection**: The API and WebSocket server only allow requests from the designated `FRONTEND_URL`.

---

## 📄 License

This project is licensed under the **ISC License**. See the [LICENSE](LICENSE) file for more details.

---

## ✨ Special Thanks

A huge thank you to **Google Antigravity** for the advanced AI assistance in architecting and refining this platform.

---

> Built with ❤️ by the Aether Team. Optimized for the modern web.
