"use client";

import { useEffect, useState, useRef, use, memo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import { 
  Copy, CheckCircle, UploadCloud, Cloud, X, Download, Trash2, Link, 
  Settings, Loader2, Menu, Smartphone, QrCode, Mic, MicOff, Eye, EyeOff,
  Info, Monitor, Tablet, Globe, Share2,
  PanelLeftClose, PanelRightClose, PanelLeftOpen, PanelRightOpen,
  ChevronsRight, ChevronsLeft, AlertTriangle, Plus, Minus
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { siteConfig } from "@/config/site";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// Dynamic imports for heavy components
const Background3D = dynamic(() => import("@/components/Background3D").then(mod => mod.Background3D), { 
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-slate-950" /> 
});
const QRCodeSVG = dynamic(() => import("qrcode.react").then(mod => mod.QRCodeSVG), { ssr: false });

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface FileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
  s3Key: string;
  previewUrl?: string;
}

interface DeviceInfo {
  name: string;
  platform: string;
  browser: string;
}

interface ActiveDevice {
  id: string;
  info: DeviceInfo;
}

const getDeviceInfo = (): DeviceInfo => {
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

const formatSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Memoized File Item for performance
const FileItem = memo(({ 
  file, 
  handleDownload, 
  handleDelete 
}: { 
  file: FileMeta, 
  handleDownload: (f: FileMeta) => void, 
  handleDelete: (f: FileMeta) => void 
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl flex items-center justify-between group hover:bg-slate-800/80 transition-colors"
    >
      <div className="flex items-center gap-3 overflow-hidden pr-3">
        {file.previewUrl ? (
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shrink-0">
             <img src={file.previewUrl} alt={file.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
             <Globe className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate" title={file.name}>{file.name}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
            <span>{formatSize(file.size)}</span>
            <span>•</span>
            <span>{formatDistanceToNow(new Date(file.uploadedAt), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={() => handleDownload(file)}
          className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-md transition-colors"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </button>
        <button 
          onClick={() => handleDelete(file)}
          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
});

// Memoized Device Item for performance
const DeviceItem = memo(({ 
  device, 
  isCurrent 
}: { 
  device: ActiveDevice, 
  isCurrent: boolean 
}) => {
  return (
    <div className="flex items-center gap-4 p-3 bg-slate-800/40 rounded-xl border border-slate-700/50">
      <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-blue-400 border border-slate-700">
        {device.info.platform === 'mobile' ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold truncate">{isCurrent ? "This Device" : device.info.name}</p>
          {isCurrent && (
             <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded uppercase">You</span>
          )}
        </div>
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{device.info.browser} • {device.info.platform}</p>
      </div>
    </div>
  );
});

// Memoized Header for performance
const SessionHeader = memo(({ 
  connected, 
  roomSize, 
  sessionId, 
  setShowDevicesModal, 
  setShowQr, 
  handleCopyLink, 
  copiedLink,
  handleDeleteSession
}: { 
  connected: boolean, 
  roomSize: number, 
  sessionId: string, 
  setShowDevicesModal: (v: boolean) => void, 
  setShowQr: (v: boolean) => void, 
  handleCopyLink: () => void, 
  copiedLink: boolean,
  handleDeleteSession: () => void
}) => {
  return (
    <header className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-slate-800/60 bg-slate-900/40 backdrop-blur-md z-10">
      <div className="flex items-center gap-1.5 sm:gap-3">
        <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Smartphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg hidden sm:block">Devices</h1>
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1 sm:gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
            <div className="flex items-center gap-1.5">
              <span>{connected ? `${roomSize} Connected` : 'System Online'}</span>
              {connected && (
                <button 
                  onClick={() => setShowDevicesModal(true)}
                  className="p-0.5 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-blue-400"
                  title="View Device List"
                  aria-label="View Connected Device List"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
        <button 
          onClick={() => setShowQr(true)}
          className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-300 hover:text-white"
          title="Show QR Code"
          aria-label="Display Session QR Code"
        >
          <QrCode className="w-4 h-4" />
        </button>
        
        <div className="h-4 w-px bg-slate-700 hidden sm:block" />
        
        <div className="hidden sm:flex items-center gap-2 px-1 sm:px-2 text-[10px] sm:text-sm font-mono text-slate-300">
          {sessionId}
        </div>

        <div className="h-4 w-px bg-slate-700" />

        <button 
          onClick={handleCopyLink}
          className={`flex items-center gap-2 px-2 sm:px-4 py-2 transition-all rounded-md font-bold text-xs border ${copiedLink ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20 shadow-lg shadow-blue-500/5'}`}
        >
          {copiedLink ? <CheckCircle className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copiedLink ? "Copied!" : "Share"}</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />
        
        <button 
          onClick={handleDeleteSession}
          className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-md transition-colors flex items-center gap-2"
          title="Delete Session"
          aria-label="Wipe and Delete Entire Session"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline text-xs font-medium">Delete</span>
        </button>
      </div>
    </header>
  );
});

// Memoized Footer for performance
const SessionFooter = memo(() => {
  return (
    <footer className="text-[10px] md:text-xs text-slate-500 text-center py-2 bg-slate-950 z-10 border-t border-slate-900 flex justify-center items-center gap-4">
      <span>Data auto-destructs after 24 hours of inactivity.</span>
      <span className="text-slate-700">|</span>
      <span className="font-medium text-slate-600">Beta v{siteConfig.version}</span>
    </footer>
  );
});

// --- NEW COMPONENT: ClipboardPanel ---
const ClipboardPanel = memo(({ 
  sessionId, 
  socket, 
  connected, 
  initialText,
  activeTab,
  isFilePanelCollapsed
}: { 
  sessionId: string, 
  socket: Socket | null, 
  connected: boolean,
  initialText: string,
  activeTab: string,
  isFilePanelCollapsed: boolean
}) => {
  const [text, setText] = useState(initialText);
  const [fontSize, setFontSize] = useState(14);
  const [copiedText, setCopiedText] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const textRef = useRef(text);
  const isLocalChange = useRef(false);
  const recognitionRef = useRef<any>(null);

  // Sync with initialText from parent (only for first load or remote updates)
  useEffect(() => {
    if (initialText !== textRef.current) {
      setText(initialText);
      textRef.current = initialText;
    }
  }, [initialText]);

  // WebSocket Listener for text updates
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = ({ content }: { content: string }) => {
      if (content !== textRef.current) {
        isLocalChange.current = false;
        setText(content);
        textRef.current = content;
        localStorage.setItem(`${siteConfig.slug}:text:${sessionId}`, content);
      }
    };
    socket.on("text_updated", handleUpdate);
    return () => { socket.off("text_updated", handleUpdate); };
  }, [socket, sessionId]);

  // Debounced Sync Effect
  useEffect(() => {
    if (!isLocalChange.current) return;

    const timer = setTimeout(() => {
      if (socket && connected) {
        socket.emit("update_text", { sessionId, content: text });
        localStorage.setItem(`${siteConfig.slug}:text:${sessionId}`, text);
      }
      isLocalChange.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [text, socket, connected, sessionId]);

  // Setup Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined" && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechReg = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechReg();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      
      recognitionRef.current.onresult = (e: any) => {
        let finalTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
             finalTranscript += e.results[i][0].transcript + ' ';
          }
        }
        if (finalTranscript) {
          isLocalChange.current = true;
          setText((prev) => {
             const updated = prev + (prev.endsWith(' ') || prev.length===0 ? '' : ' ') + finalTranscript;
             textRef.current = updated;
             return updated;
          });
        }
      };
      
      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
    return () => { if (recognitionRef.current) recognitionRef.current.stop(); };
  }, []);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    isLocalChange.current = true;
    setText(newText);
    textRef.current = newText;
  }, []);

  const toggleListening = useCallback(() => {
    if(isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
    } else {
        if(!recognitionRef.current) {
            alert("Speech to text is not supported in this browser.");
            return;
        }
        recognitionRef.current.start();
        setIsListening(true);
    }
  }, [isListening]);

  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  }, [text]);

  return (
    <div className={`h-full flex flex-col items-stretch p-4 md:p-6 transition-all duration-300 ease-in-out ${activeTab === 'text' ? 'block' : 'hidden md:flex'} ${isFilePanelCollapsed ? 'w-full' : 'w-full md:w-3/5 lg:w-2/3'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-200">Clipboard</h2>
          <button 
            onClick={toggleListening}
            className={`p-1.5 rounded text-white transition-colors border ${isListening ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 animate-pulse' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
          >
            {isListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
          </button>
          <div className="flex items-center bg-slate-800 rounded border border-slate-700 p-0.5">
            <button onClick={() => setFontSize(p => Math.max(10, p - 2))} className="p-1 hover:bg-slate-700 rounded-sm transition-colors text-slate-400 hover:text-white"><Minus className="w-3.5 h-3.5" /></button>
            <div className="w-px h-3.5 bg-slate-700 mx-0.5" />
            <button onClick={() => setFontSize(p => Math.min(48, p + 2))} className="p-1 hover:bg-slate-700 rounded-sm transition-colors text-slate-400 hover:text-white"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <button onClick={handleCopyText} className="p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center justify-center gap-2 border border-slate-700">
          {copiedText ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copiedText ? 'Copied!' : 'Copy All'}</span>
        </button>
      </div>
      <div className="flex-1 relative mb-4 rounded-xl overflow-hidden border border-slate-800/60 bg-slate-900/30 backdrop-blur-sm group focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/50 transition-all shadow-inner">
        <textarea
          id="main-content"
          value={text}
          onChange={handleTextChange}
          placeholder="Type or paste text here... It will sync instantly."
          style={{ scrollbarGutter: 'stable', fontSize: `${fontSize}px` }}
          className="w-full h-full p-3 bg-transparent resize-none outline-none text-slate-200 placeholder:text-slate-600 font-mono leading-relaxed"
        />
      </div>
    </div>
  );
});

// --- NEW COMPONENT: FileManagerPanel ---
const FileManagerPanel = memo(({ 
  files, 
  uploading, 
  uploadProgress, 
  activeTab, 
  isFilePanelCollapsed,
  processFile,
  handleDownloadFile,
  handleDeleteFile,
  setIsFilePanelCollapsed
}: { 
  files: FileMeta[], 
  uploading: boolean, 
  uploadProgress: number,
  activeTab: string,
  isFilePanelCollapsed: boolean,
  processFile: (f: File) => void,
  handleDownloadFile: (f: FileMeta) => void,
  handleDeleteFile: (f: FileMeta) => void,
  setIsFilePanelCollapsed: (v: boolean) => void
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    processFile(e.target.files[0]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  return (
    <div className={`h-full bg-slate-900/20 flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${activeTab === 'files' ? 'block' : 'hidden md:flex'} ${isFilePanelCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-full md:w-2/5 lg:w-1/3 opacity-100'}`}>
      <div className="p-4 md:p-6 border-b border-slate-800/60">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-200">Files</h2>
          <span className="text-xs text-slate-400 px-2 py-1 bg-slate-800 rounded-full">{files.length} items</span>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
        <div onDrop={onDrop} onDragOver={e => { e.preventDefault(); setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)} className="relative">
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`w-full py-4 border-2 border-dashed ${isDragOver ? "border-blue-500 bg-blue-500/10 text-blue-400" : "border-slate-700/80 text-slate-400"} rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-slate-800/30 hover:border-blue-500/50 hover:text-blue-400 transition-all overflow-hidden relative group`}
          >
            {uploading ? (
              <div className="absolute inset-0 bg-slate-800/80 flex flex-col items-center justify-center backdrop-blur-sm z-10">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400 mb-2" />
                <div className="w-2/3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${uploadProgress}%` }} />
                </div>
                <span className="text-xs mt-2 font-medium text-slate-300">{uploadProgress}%</span>
              </div>
            ) : (
              <>
                <div className="p-3 bg-slate-800 rounded-full group-hover:scale-110 transition-transform"><UploadCloud className="w-5 h-5 text-slate-300" /></div>
                <span className="text-sm font-medium">Click or Drag to Upload (Max 50MB)</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
        {files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-60">
            <Cloud className="w-12 h-12 mb-3 grayscale" /><p className="text-sm">No files uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {files.map((f) => <FileItem key={f.id} file={f} handleDownload={handleDownloadFile} handleDelete={handleDeleteFile} />)}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
});

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
  const [isActivating, setIsActivating] = useState(false);

  const [activeDevices, setActiveDevices] = useState<ActiveDevice[]>([]);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isFilePanelCollapsed, setIsFilePanelCollapsed] = useState(false);

  const devicesModalRef = useFocusTrap(showDevicesModal);
  const qrModalRef = useFocusTrap(showQr);
  const deleteModalRef = useFocusTrap(showDeleteModal);
  const sessionErrorRef = useFocusTrap(!!sessionError);

  const hasAutoAttempted = useRef(false);

  const handleActivateSession = useCallback(async () => {
    setIsActivating(true);
    try {
      await axios.post(`${API_URL}/session/${sessionId}/init`);
      setSessionError(null);
    } catch (err) {
      console.error("Failed to activate session", err);
    } finally {
      setIsActivating(false);
    }
  }, [sessionId]);

  useEffect(() => {
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
        if (err.response?.status === 404 && !cachedText && !hasAutoAttempted.current) {
          hasAutoAttempted.current = true;
          handleActivateSession();
          return;
        }
        if (err.response?.status === 410) setSessionError("purged");
        else if (err.response?.status === 404) setSessionError(cachedText ? "expired" : "not_found");
        else setSessionError("not_found");
        setIsValidating(false);
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
  }, [sessionId, handleActivateSession, router]);

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

  const processFile = useCallback(async (file: File) => {
    if (file.size > 50 * 1024 * 1024) return alert("File exceeds 50MB limit");
    if (file.size > 20 * 1024 * 1024 && !window.confirm("Large file download (>20MB) may take time. Continue?")) return;

    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    setUploadProgress(0);

    try {
      await axios.post(`${API_URL}/upload/${sessionId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (p) => { if (p.total) setUploadProgress(Math.round((p.loaded * 100) / p.total)); }
      });
    } catch (err: any) {
      alert(err.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
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
      router.push("/?status=deleted&origin=self");
    } catch (err) {
      alert("Failed to delete session");
    }
  }, [sessionId, router]);

  const handleDeleteSession = useCallback(() => {
    setShowDeleteModal(true);
  }, []);







  if (isValidating) {
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

  if (sessionError) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4 overflow-hidden relative">
        {/* Ambient background glows */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none" />
        
        <motion.div 
          ref={sessionErrorRef}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-slate-900/40 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl relative z-10 text-center"
        >
          <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl border border-slate-700">
             {sessionError === 'expired' ? (
                <Loader2 className="w-10 h-10 text-rose-400 opacity-80" />
             ) : (
                <Cloud className="w-10 h-10 text-amber-400 opacity-80" />
             )}
          </div>
          
          <h1 className="text-2xl font-bold mb-3">
            {sessionError === 'expired' ? 'Session Expired' : 
             sessionError === 'purged' ? 'Room Purged' : 'Room Not Found'}
          </h1>
          
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            {sessionError === 'expired' 
              ? "This session has been automatically purged after 24 hours of inactivity to protect your privacy."
              : sessionError === 'purged'
              ? "The session is deleted already because of no entry."
              : `The session "${sessionId}" hasn't been initialized yet. Would you like to start a new workspace here?`}
          </p>

          <div className="flex flex-col gap-3">
            {sessionError === 'not_found' && (
              <button 
                onClick={handleActivateSession}
                disabled={isActivating}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
              >
                {isActivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {isActivating ? 'Initializing...' : 'Start This Room'}
              </button>
            )}
            <button 
              onClick={() => window.location.href = '/'}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-all border border-slate-700"
            >
              Back to Home
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden relative selection:bg-blue-500/30">
      
      
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
      </div>      {/* Main Content Area */}
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
                className={`absolute top-1/2 -translate-y-1/2 z-20 w-6 h-10 bg-slate-900 border border-slate-700 flex items-center justify-center rounded-sm hover:bg-slate-800 transition-all ${isFilePanelCollapsed ? '-left-3' : '-left-3'}`}
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
          processFile={processFile}
          handleDownloadFile={handleDownloadFile}
          handleDeleteFile={handleDeleteFile}
          setIsFilePanelCollapsed={setIsFilePanelCollapsed}
        />
      </main>

      <SessionFooter />

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
    </div>
  );
}
