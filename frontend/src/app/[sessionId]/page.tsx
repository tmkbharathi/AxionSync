"use client";

import { useEffect, useState, useRef, use, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import { 
  X, Monitor, LogOut, Trash2, Lock, Cloud, AlertTriangle, 
  Copy, CheckCircle, ChevronsLeft, ChevronsRight, Smartphone,
  Sparkles, ArrowRight
} from "lucide-react";

import { siteConfig } from "@/config/site";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { OnboardingTour } from "@/components/OnboardingTour";
import PerformanceSettings from "@/components/PerformanceSettings";

// Import modular components & types
import { FileMeta, ActiveDevice } from "@/components/session/types";
import { DeviceItem } from "@/components/session/DeviceItem";
import { SessionHeader } from "@/components/session/SessionHeader";
import { SessionFooter } from "@/components/session/SessionFooter";
import { ClipboardPanel } from "@/components/session/ClipboardPanel";
import { FileManagerPanel } from "@/components/session/FileManagerPanel";

// Dynamic imports for heavy components
const Background3D = dynamic(() => import("@/components/Background3D").then(mod => mod.Background3D), { 
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-slate-950" /> 
});
const QRCodeSVG = dynamic(() => import("qrcode.react").then(mod => mod.QRCodeSVG), { ssr: false });

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Calculate SHA-256 hash of a file using Web Crypto API
const calculateSHA256 = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
};

// Admin Credentials
const ADMIN_SESSION_ID = process.env.NEXT_PUBLIC_ADMIN_SESSION_ID;
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD;

const getDeviceInfo = () => {
  if (typeof window === "undefined") return { name: "Unknown", platform: "unknown", browser: "unknown" };
  
  const ua = navigator.userAgent;
  const vendor = navigator.vendor || "";
  
  let platform = "desktop";
  let browser = "Globe";
  let name = "PC";

  // Platform detection
  if (/iPad|iPhone|iPod/.test(ua)) platform = "mobile";
  else if (/Android/.test(ua)) platform = "mobile";
  else if (/Windows/.test(ua)) platform = "desktop";
  else if (/Macintosh/.test(ua)) platform = "desktop";
  
  // Specific device name
  if (/iPhone/.test(ua)) name = "iPhone";
  else if (/iPad/.test(ua)) name = "iPad";
  else if (/Android/.test(ua)) name = "Android Device";
  else if (/Macintosh/.test(ua)) name = "MacBook";
  else if (/Windows/.test(ua)) name = "Windows PC";
  else name = "Device";

  // Browser detection
  if (/Chrome/.test(ua) && /Google/.test(vendor)) browser = "Chrome";
  else if (/Safari/.test(ua) && /Apple/.test(vendor)) browser = "Safari";
  else if (/Firefox/.test(ua)) browser = "Firefox";
  else if (/Edg/.test(ua)) browser = "Edge";
  else browser = "Browser";

  return { name, platform, browser };
};

const getPersistentDeviceId = (): string => {
  if (typeof window === "undefined") return "unknown";
  const key = `${siteConfig.slug}:device_id`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(key, id);
  }
  return id;
};

// Tour Steps Configuration for Session Room
const SESSION_TOUR_STEPS = [
  {
    title: "Welcome to your Sync Room! 🚀",
    description: "This is a private, real-time workspace. Any device that joins this room can instantly sync clipboard text and files with you.",
    position: "center" as const
  },
  {
    targetId: "tour-qr",
    title: "Scan to Join 📱",
    description: "Click here to display a QR code. Scan it with your phone's camera to instantly join this exact room and start sharing.",
    position: "bottom" as const
  },
  {
    targetId: "tour-share",
    title: "Share Room Link 🔗",
    description: "Click this button to copy the room's direct link. Send it to anyone or open it on another device to sync.",
    position: "bottom" as const
  },
  {
    targetId: "tour-presence",
    title: "Active Devices Presence 💻",
    description: "This shows how many devices are currently active in this room. Click the info icon to see browser and device details.",
    position: "bottom" as const
  },
  {
    targetId: "tour-clipboard",
    title: "Instant Clipboard Sync ⚡",
    description: "Type or paste text here. Any changes are synced immediately across all connected screens in real-time.",
    position: "bottom" as const
  },
  {
    targetId: "tour-mic",
    title: "Speech-to-Text Voice Sync 🎙️",
    description: "Click the mic button to type hands-free! Voice input will automatically sync to all devices.",
    position: "bottom" as const
  },
  {
    targetId: "tour-files",
    title: "Real-time File Vault 📁",
    description: "Drag & drop or click to upload files (up to 50MB). Connected devices can view and download them instantly.",
    position: "left" as const
  },
  {
    targetId: "tour-delete",
    title: "Delete / Wipe Session 🗑️",
    description: "Wipe all text and files and permanently close the session for all participants instantly.",
    position: "bottom" as const
  }
];

export default function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileMeta[]>([]);
  
  const [activeTab, setActiveTab] = useState<"text" | "files">("text");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const [showQr, setShowQr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const [roomSize, setRoomSize] = useState(0);

  const [isValidating, setIsValidating] = useState(true);
  const [sessionError, setSessionError] = useState<"expired" | "not_found" | "purged" | null>(null);

  const [activeDevices, setActiveDevices] = useState<ActiveDevice[]>([]);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isFilePanelCollapsed, setIsFilePanelCollapsed] = useState(false);

  const devicesModalRef = useFocusTrap(showDevicesModal, () => setShowDevicesModal(false));
  const qrModalRef = useFocusTrap(showQr, () => setShowQr(false));
  const deleteModalRef = useFocusTrap(showDeleteModal, () => setShowDeleteModal(false));
  const sessionErrorRef = useFocusTrap(!!sessionError);

  const [hasMounted, setHasMounted] = useState(false);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPasswordValue, setAdminPasswordValue] = useState("");
  const [adminAuthError, setAdminAuthError] = useState(false);

  const [isTourActive, setIsTourActive] = useState(false);
  const [showTourBanner, setShowTourBanner] = useState(false);

  useEffect(() => {
    if (hasMounted && isAdminUnlocked && !isValidating && !sessionError) {
      const isCompleted = localStorage.getItem("syncosync:tour:session");
      if (!isCompleted) {
        const timer = setTimeout(() => setShowTourBanner(true), 2500);
        return () => clearTimeout(timer);
      }
    }
  }, [hasMounted, isAdminUnlocked, isValidating, sessionError]);

  useEffect(() => {
    setHasMounted(true);
    if (sessionId === ADMIN_SESSION_ID) {
      const isAuth = sessionStorage.getItem(`syncosync:auth:${ADMIN_SESSION_ID}`) === "true";
      setIsAdminUnlocked(isAuth);
    } else {
      setIsAdminUnlocked(true);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!isAdminUnlocked) return;

    const cachedText = localStorage.getItem(`${siteConfig.slug}:text:${sessionId}`);
    if (cachedText) setText(cachedText);

    axios.get(`${API_URL}/session/${sessionId}`)
      .then((res) => {
        setText(res.data.text || "");
        setFiles(res.data.files || []);
        if (res.data.text) localStorage.setItem(`${siteConfig.slug}:text:${sessionId}`, res.data.text);
        setIsValidating(false);
      })
      .catch(err => {
        if (err.response?.status === 410) {
          router.replace("/?status=not_found&origin=purged");
        } else if (err.response?.status === 404) {
          router.replace(`/?status=not_found&origin=missing&id=${sessionId}`);
        } else {
          setSessionError("not_found");
          setIsValidating(false);
        }
      });

    const newSocket = io(SOCKET_URL, { transports: ["websocket"] });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setConnected(true);
      newSocket.emit("join_session", { 
        sessionId, deviceInfo: getDeviceInfo(), persistentDeviceId: getPersistentDeviceId() 
      });
    });
    newSocket.on("disconnect", () => setConnected(false));
    newSocket.on("file_uploaded", (file: FileMeta) => {
      setFiles((prev) => [file, ...prev.filter(f => f.id !== file.id)]);
    });
    newSocket.on("room_size", (size: number) => setRoomSize(size));
    newSocket.on("room_devices", (devices: ActiveDevice[]) => setActiveDevices(devices));
    newSocket.on("file_deleted", (id: string) => setFiles((p) => p.filter((f) => f.id !== id)));
    newSocket.on("session_deleted", () => {
      localStorage.removeItem(`${siteConfig.slug}:text:${sessionId}`);
      router.push("/?status=deleted&origin=other");
    });

    return () => { newSocket.disconnect(); };
  }, [sessionId, router, isAdminUnlocked]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowQr(false);
        setShowDevicesModal(false);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, []);

  const processFiles = useCallback(async (filesToUpload: File[]) => {
    const validFiles = filesToUpload.filter(file => {
      const maxFileSize = sessionId === ADMIN_SESSION_ID ? 1024 * 1024 * 1024 : 50 * 1024 * 1024;
      if (file.size > maxFileSize) {
        alert(`File ${file.name} exceeds the ${sessionId === ADMIN_SESSION_ID ? '1GB' : '50MB'} limit`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const hasLargeFile = validFiles.some(f => f.size > 20 * 1024 * 1024);
    if (hasLargeFile && !window.confirm("Large file(s) (>20MB) may take time. Continue?")) return;

    setUploading(true);
    setUploadProgress(0);

    const totalSize = validFiles.reduce((acc, f) => acc + f.size, 0);
    const loadedSizes = new Array(validFiles.length).fill(0);

    const results = await Promise.allSettled(validFiles.map(async (file, index) => {
      const hash = await calculateSHA256(file);

      const presignRes = await axios.post(`${API_URL}/session/${sessionId}/upload/presign`, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream"
      });
      const { uploadUrl, fileId, s3Key } = presignRes.data;

      await axios.put(uploadUrl, file, {
        headers: { "Content-Type": file.type || "application/octet-stream" },
        onUploadProgress: (p) => { 
          if (p.loaded !== undefined) {
            loadedSizes[index] = p.loaded;
            const currentTotalLoaded = loadedSizes.reduce((a, b) => a + b, 0);
            setUploadProgress(Math.min(100, Math.round((currentTotalLoaded * 100) / totalSize)));
          }
        }
      });

      return axios.post(`${API_URL}/session/${sessionId}/upload/confirm`, {
        fileId,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        s3Key,
        hash
      });
    }));

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          console.error(`Upload failed for file "${validFiles[idx].name}":`, r.reason);
        }
      });
      alert(`${failed.length} file(s) failed to upload. Check browser console (F12) for detailed errors.`);
    }
    
    setUploading(false);
    setUploadProgress(0);
  }, [sessionId]);

  const handleDownloadFile = useCallback(async (file: FileMeta) => {
    try {
      const res = await axios.get(`${API_URL}/download?s3Key=${encodeURIComponent(file.s3Key)}`);
      window.open(res.data.url, "_blank");
    } catch (err) {
      alert("Could not generate download link");
    }
  }, []);

  const handleDeleteFile = useCallback((file: FileMeta) => {
    if (socket && connected) socket.emit("delete_file", { sessionId, file });
  }, [socket, connected, sessionId]);

  const confirmDeleteSession = useCallback(async () => {
    setShowDeleteModal(false);
    try {
      await axios.delete(`${API_URL}/session/${sessionId}`);
      localStorage.removeItem(`${siteConfig.slug}:text:${sessionId}`);
      router.push("/?status=deleted&origin=self");
    } catch (err) {
      alert("Failed to delete session");
    }
  }, [sessionId, router]);

  const handleDeleteSession = useCallback(() => {
    if (sessionId === ADMIN_SESSION_ID) {
      sessionStorage.removeItem(`syncosync:auth:${ADMIN_SESSION_ID}`);
      router.push("/");
    } else {
      setShowDeleteModal(true);
    }
  }, [sessionId, router]);

  if (!hasMounted) {
    return null;
  }

  if (isValidating && isAdminUnlocked) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="relative">
            <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-blue-400" />
            </div>
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">Securing Connection</h2>
            <p className="text-slate-400 text-sm">Verifying AxionSync instance...</p>
          </div>
        </motion.div>
      </div>
    );
  }

  // Admin Unlock Overlay
  if (!isAdminUnlocked) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="max-w-sm w-full bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-10 rounded-[2.5rem] shadow-2xl relative z-10 text-center"
        >
          <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-xl border border-slate-700">
             <Lock className="w-10 h-10 text-blue-400 opacity-80" />
          </div>
          
          <h1 className="text-2xl font-bold mb-2">Reserved Admin Space</h1>
          <p className="text-slate-500 text-xs mb-8 uppercase tracking-widest font-bold">Encrypted Session: {ADMIN_SESSION_ID}</p>
          
          <form onSubmit={(e) => {
            e.preventDefault();
            if (adminPasswordValue === ADMIN_PASSWORD) {
              sessionStorage.setItem(`syncosync:auth:${ADMIN_SESSION_ID}`, "true");
              setIsAdminUnlocked(true);
            } else {
              setAdminAuthError(true);
              setTimeout(() => setAdminAuthError(false), 2000);
            }
          }}>
            <input
              type="password"
              autoFocus
              placeholder="Enter Password"
              value={adminPasswordValue}
              onChange={(e) => setAdminPasswordValue(e.target.value)}
              className={`w-full py-4 px-4 bg-slate-900/50 border-2 ${adminAuthError ? 'border-rose-500/50' : 'border-slate-800 focus:border-blue-500/50'} rounded-2xl text-center outline-none transition-all placeholder:text-slate-700 mb-6 font-mono tracking-widest`}
            />
            
            <button
              type="submit"
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95"
            >
              Verify Identity
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="w-full mt-4 py-2 text-slate-500 hover:text-slate-300 text-sm font-medium transition-colors"
            >
              Leave Session
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4 overflow-hidden relative">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <motion.div 
          ref={sessionErrorRef}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl relative z-10 text-center"
        >
          <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl border border-slate-700">
            <Cloud className="w-10 h-10 text-amber-400 opacity-80" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Connection Error</h1>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            We couldn't verify the session. It may have expired or there's a temporary connection issue.
          </p>
          <button 
            onClick={() => window.location.href = '/'}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-all border border-slate-700"
          >
            Back to Home
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden relative selection:bg-blue-500/30">
      
      {/* Floating Performance Settings */}
      <PerformanceSettings />
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none translate-x-1/3 translate-y-1/3" />

      <SessionHeader 
        connected={connected}
        roomSize={roomSize}
        sessionId={sessionId}
        setShowDevicesModal={setShowDevicesModal}
        setShowQr={setShowQr}
        handleCopyLink={handleCopyLink}
        copiedLink={copiedLink}
        handleDeleteSession={handleDeleteSession}
        isPro={sessionId === ADMIN_SESSION_ID}
        onStartTour={() => setIsTourActive(true)}
      />

      {/* Mobile Tabs */}
      <div className="md:hidden flex p-2 bg-slate-900/40 border-b border-slate-800/60 z-10">
        <button 
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'text' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-400'}`}
        >
          Text
        </button>
        <button 
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'files' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-400'}`}
        >
          Files
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative z-10">
        <ClipboardPanel 
          sessionId={sessionId}
          socket={socket}
          connected={connected}
          initialText={text}
          activeTab={activeTab}
          isFilePanelCollapsed={isFilePanelCollapsed}
        />

        {/* Divider desktop with collapse toggle */}
        <div className="hidden md:flex flex-col items-center relative w-px bg-slate-800/60 h-full">
            <button
                onClick={() => setIsFilePanelCollapsed(!isFilePanelCollapsed)}
                className="absolute top-1/2 -translate-y-1/2 z-20 w-6 h-10 bg-slate-900 border border-slate-700 flex items-center justify-center rounded-sm hover:bg-slate-800 transition-all -left-3"
                title={isFilePanelCollapsed ? "Show Files" : "Collapse Files"}
            >
                {isFilePanelCollapsed ? <ChevronsLeft className="w-4 h-4 text-blue-400" /> : <ChevronsRight className="w-4 h-4 text-slate-500" />}
            </button>
        </div>

        <FileManagerPanel 
          files={files}
          uploading={uploading}
          uploadProgress={uploadProgress}
          activeTab={activeTab}
          isFilePanelCollapsed={isFilePanelCollapsed}
          processFiles={processFiles}
          handleDownloadFile={handleDownloadFile}
          handleDeleteFile={handleDeleteFile}
          setIsFilePanelCollapsed={setIsFilePanelCollapsed}
          isAdminSession={sessionId === ADMIN_SESSION_ID}
        />
      </main>

      <SessionFooter isPro={sessionId === ADMIN_SESSION_ID} />

      {/* Device Info Modal */}
      <AnimatePresence>
        {showDevicesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-lg flex items-center justify-center p-4"
            onClick={() => setShowDevicesModal(false)}
          >
            <motion.div
              ref={devicesModalRef}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl flex flex-col w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-blue-400" />
                  Connected Devices
                </h3>
                <button 
                  onClick={() => setShowDevicesModal(false)}
                  className="p-1 rounded-md text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {activeDevices.map((device) => (
                  <DeviceItem 
                    key={device.id} 
                    device={device} 
                    isCurrent={device.id === socket?.id} 
                  />
                ))}
              </div>
              
              <p className="mt-6 text-[10px] text-slate-500 text-center">
                Device info is refreshed automatically in real-time.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR Code Modal */}
      <AnimatePresence>
        {showQr && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-lg flex items-center justify-center p-4"
            onClick={() => setShowQr(false)}
          >
            <motion.div
              ref={qrModalRef}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full"
            >
              <button 
                onClick={() => setShowQr(false)}
                className="absolute top-4 right-4 p-1 rounded-md text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h3 className="text-xl font-bold mb-2">Join Session</h3>
              <p className="text-slate-400 text-sm text-center mb-6">Scan this QR code with your phone to instantly connect and sync.</p>
              
              <div className="bg-white p-4 rounded-xl">
                <QRCodeSVG value={window.location.href} size={200} />
              </div>
              
              <div className="mt-6 w-full relative group">
                <div className="pr-10 p-3 bg-slate-800/40 rounded-xl border border-slate-700/50 font-mono text-sm break-all text-slate-300 select-all">
                  {window.location.href}
                </div>
                <button 
                  onClick={handleCopyLink}
                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all ${copiedLink ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-blue-400 hover:bg-slate-800'}`}
                  title="Copy Link"
                >
                  {copiedLink ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteModal(false)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg"
            />
            <motion.div 
              ref={deleteModalRef}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center mb-6 border border-rose-500/20">
                  <AlertTriangle className="w-8 h-8 text-rose-500" />
                </div>
                
                <h3 className="text-2xl font-bold text-white mb-3">Delete Everything?</h3>
                <p className="text-slate-400 mb-8 leading-relaxed">
                  This will instantly wipe all shared text and files for <span className="text-rose-400 font-semibold">everyone</span> in this room. This action cannot be undone.
                </p>
                
                <div className="flex flex-col gap-3">
                  <button
                    onClick={confirmDeleteSession}
                    className="w-full py-4 px-6 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-rose-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-5 h-5" />
                    Delete Everything
                  </button>
                  
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    className="w-full py-4 px-6 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-2xl transition-all active:scale-[0.98]"
                  >
                    Keep Session
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Onboarding Tour Components */}
      <OnboardingTour
        tourKey="session"
        steps={SESSION_TOUR_STEPS}
        isActive={isTourActive}
        onClose={() => setIsTourActive(false)}
      />

      {/* Tour Banner slide-in invitation */}
      <AnimatePresence>
        {showTourBanner && !isTourActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-blue-950/70 backdrop-blur-[6px]"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-[360px] bg-slate-900/90 backdrop-blur-xl border border-blue-500/20 p-6 rounded-3xl shadow-2xl flex flex-col gap-4 text-left select-none text-white relative z-50"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quick Tutorial</span>
                </div>
                <button
                  onClick={() => {
                    localStorage.setItem("syncosync:tour:session", "completed");
                    setShowTourBanner(false);
                  }}
                  className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 rounded-full transition-all cursor-none"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <h4 className="text-base font-bold text-white mb-1.5">Welcome to your Sync Room! 🚀</h4>
                <p className="text-slate-300 text-xs leading-relaxed font-normal">
                  Let's take a 1-minute interactive tour to understand how to use this clipboard sync and file sharing workspace!
                </p>
              </div>

              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={() => {
                    setIsTourActive(true);
                    setShowTourBanner(false);
                  }}
                  className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-1.5 cursor-none"
                >
                  Start Tour
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem("syncosync:tour:session", "completed");
                    setShowTourBanner(false);
                  }}
                  className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-none"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
