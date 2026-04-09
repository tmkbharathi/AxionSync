"use client";

import { useEffect, useState, useRef, use } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { QRCodeSVG } from "qrcode.react";
import { 
  Copy, CheckCircle, UploadCloud, Cloud, X, Download, Trash2, Link, 
  Settings, Loader2, Menu, Smartphone, QrCode, Mic, MicOff
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface FileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
  s3Key: string;
}

export default function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  
  const [activeTab, setActiveTab] = useState<"text" | "files">("text");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  
  const [showQr, setShowQr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Check localStorage cache first for fast offline load
    const cachedText = localStorage.getItem(`clipbridge:text:${sessionId}`);
    if (cachedText) {
      setText(cachedText);
      textRef.current = cachedText;
    }

    // Fetch initial state
    axios.get(`${API_URL}/session/${sessionId}`).then((res) => {
      setText(res.data.text || "");
      if (res.data.history) setHistory(res.data.history.slice(0, 5));
      textRef.current = res.data.text || "";
      setFiles(res.data.files || []);
      if (res.data.text) localStorage.setItem(`clipbridge:text:${sessionId}`, res.data.text);
    }).catch(err => console.error("Failed to load session state", err));

    // Connect WebSocket
    const newSocket = io(SOCKET_URL, { transports: ["websocket"] });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setConnected(true);
      newSocket.emit("join_session", { sessionId });
    });

    newSocket.on("disconnect", () => setConnected(false));

    newSocket.on("text_updated", ({ content, newHistory }: { content: string, newHistory?: string[] }) => {
      setText(content);
      textRef.current = content;
      if (newHistory) setHistory(newHistory.slice(0, 5));
      localStorage.setItem(`clipbridge:text:${sessionId}`, content);
    });

    newSocket.on("file_uploaded", (file: FileMeta) => {
      setFiles((prev) => [file, ...prev.filter(f => f.id !== file.id)]);
    });

    newSocket.on("file_deleted", (fileId: string) => {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    });

    // Setup recognition
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
          setText((prev) => {
             const updated = prev + (prev.endsWith(' ') || prev.length===0 ? '' : ' ') + finalTranscript;
             textRef.current = updated;
             localStorage.setItem(`clipbridge:text:${sessionId}`, updated);
             if (newSocket && newSocket.connected) {
               newSocket.emit("update_text", { sessionId, content: updated });
             }
             return updated;
          });
        }
      };
      
      recognitionRef.current.onerror = (e: any) => {
          console.error("Speech Rec error", e);
          setIsListening(false);
      }
      
      recognitionRef.current.onend = () => {
          setIsListening(false);
      }
    }

    return () => {
      newSocket.disconnect();
      if(recognitionRef.current) recognitionRef.current.stop();
    };
  }, [sessionId]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    textRef.current = newText;
    localStorage.setItem(`clipbridge:text:${sessionId}`, newText);
    
    // Broadcast via socket
    if (socket && connected) {
      socket.emit("update_text", { sessionId, content: newText });
    }
  };

  const handleSaveToHistory = () => {
    if (!text.trim()) return;
    if (socket && connected) {
      socket.emit("save_history", { sessionId, content: text });
      // preemptive update
      setHistory(prev => [text, ...prev.filter(h => h !== text)].slice(0, 5));
    }
  };

  const handleRestoreHistory = (h: string) => {
    setText(h);
    textRef.current = h;
    localStorage.setItem(`clipbridge:text:${sessionId}`, h);
    if (socket && connected) {
      socket.emit("update_text", { sessionId, content: h });
    }
  };

  const toggleListening = () => {
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
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const processFile = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      alert("Error: File size exceeds 50MB limit");
      return;
    }
    
    if (file.size > 20 * 1024 * 1024) {
      const confirm = window.confirm("Warning: Uploading large files (>20MB) may take some time. Do you want to continue?");
      if (!confirm) return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setUploadProgress(0);

    try {
      await axios.post(`${API_URL}/upload/${sessionId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(pct);
          }
        }
      });
    } catch (err: any) {
      console.error("Upload failed", err);
      if (err.response && err.response.data && err.response.data.error) {
        alert(err.response.data.error);
      } else {
        alert("Upload failed");
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    processFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDownloadFile = async (file: FileMeta) => {
    try {
      const res = await axios.get(`${API_URL}/download?s3Key=${encodeURIComponent(file.s3Key)}`);
      window.open(res.data.url, "_blank");
    } catch (err) {
      console.error("Download fail", err);
      alert("Could not generate download link");
    }
  };

  const handleDeleteFile = (file: FileMeta) => {
    if (socket && connected) {
      socket.emit("delete_file", { sessionId, file });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden relative selection:bg-sky-500/30">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none translate-x-1/3 translate-y-1/3" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60 bg-slate-900/40 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg hidden sm:block">ClipBridge</h1>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
              {connected ? 'Connected' : 'Connecting...'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
          <button 
            onClick={() => setShowQr(true)}
            className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-300 hover:text-white"
            title="Show QR Code"
          >
            <QrCode className="w-4 h-4" />
          </button>
          
          <div className="h-4 w-px bg-slate-700" />
          
          <div className="flex items-center gap-2 px-2 text-sm font-mono text-slate-300">
            {sessionId}
          </div>
          
          <button 
            onClick={handleCopyLink}
            className="p-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-md transition-colors flex items-center gap-2"
          >
            {copiedLink ? <CheckCircle className="w-4 h-4" /> : <Link className="w-4 h-4" />}
            <span className="hidden sm:inline text-xs font-medium">{copiedLink ? 'Copied' : 'Share'}</span>
          </button>
        </div>
      </header>

      {/* Mobile Tabs */}
      <div className="md:hidden flex p-2 bg-slate-900/40 border-b border-slate-800/60 z-10">
        <button 
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'text' ? 'bg-slate-800 text-sky-400 shadow-sm' : 'text-slate-400'}`}
        >
          Text
        </button>
        <button 
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'files' ? 'bg-slate-800 text-sky-400 shadow-sm' : 'text-slate-400'}`}
        >
          Files
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative z-10">
        
        {/* TEXT PANEL */}
        <div className={`w-full md:w-3/5 lg:w-2/3 h-full flex flex-col items-stretch p-4 md:p-6 transition-transform ${activeTab === 'text' ? 'block' : 'hidden md:flex'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-200">Clipboard</h2>
              <button 
                onClick={handleSaveToHistory}
                className="px-2 py-1 text-[10px] font-bold rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors border border-sky-500/30"
              >
                SAVE STATE
              </button>
              <button 
                onClick={toggleListening}
                className={`p-1.5 rounded text-white transition-colors border ${isListening ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 animate-pulse' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
                title={isListening ? "Stop listening" : "Start Voice Typing"}
              >
                {isListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button 
              onClick={handleCopyText}
              className="px-3 py-1.5 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-2 border border-slate-700"
            >
              {copiedText ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedText ? 'Copied!' : 'Copy All'}
            </button>
          </div>
          
          <div className="flex-1 relative mb-4 rounded-xl overflow-hidden border border-slate-800/60 bg-slate-900/30 backdrop-blur-sm group focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all shadow-inner">
            <textarea
              value={text}
              onChange={handleTextChange}
              placeholder="Type or paste text here... It will sync instantly."
              className="w-full h-full p-6 bg-transparent resize-none outline-none text-slate-200 placeholder:text-slate-600 font-mono text-sm leading-relaxed"
            />
          </div>

          {/* History Panel */}
          {history.length > 0 && (
            <div className="h-24 md:h-32 shrink-0 border border-slate-800/60 bg-slate-900/40 rounded-xl p-3 flex flex-col">
              <h3 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">History (Last 5)</h3>
              <div className="flex-1 overflow-x-auto flex gap-2 custom-scrollbar pb-1">
                {history.map((h, i) => (
                  <button 
                    key={i} 
                    onClick={() => handleRestoreHistory(h)}
                    className="shrink-0 w-32 md:w-40 text-left bg-slate-800 hover:bg-slate-700 p-2 rounded-lg text-xs text-slate-300 font-mono overflow-hidden transition-colors border border-slate-700"
                    title={h}
                  >
                    <div className="line-clamp-3 leading-snug">{h}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Divider desktop */}
        <div className="hidden md:block w-px bg-slate-800/60" />

        {/* FILE MANAGER PANEL */}
        <div className={`w-full md:w-2/5 lg:w-1/3 h-full bg-slate-900/20 flex flex-col overflow-hidden ${activeTab === 'files' ? 'block' : 'hidden md:flex'}`}>
          
          <div className="p-4 md:p-6 border-b border-slate-800/60">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-200">Files</h2>
              <span className="text-xs text-slate-400 px-2 py-1 bg-slate-800 rounded-full">{files.length} items</span>
            </div>
            
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
            />
            
            <div 
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className="relative"
            >
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`w-full py-4 border-2 border-dashed ${isDragOver ? "border-sky-500 bg-sky-500/10 text-sky-400" : "border-slate-700/80 text-slate-400"} rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-slate-800/30 hover:border-sky-500/50 hover:text-sky-400 transition-all overflow-hidden relative group`}
              >
                {uploading ? (
                   <div className="absolute inset-0 bg-slate-800/80 flex flex-col items-center justify-center backdrop-blur-sm z-10">
                     <Loader2 className="w-6 h-6 animate-spin text-sky-400 mb-2" />
                     <div className="w-2/3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                       <div className="h-full bg-sky-500 rounded-full" style={{ width: `${uploadProgress}%` }} />
                     </div>
                     <span className="text-xs mt-2 font-medium text-slate-300">{uploadProgress}%</span>
                   </div>
                ) : (
                  <>
                    <div className="p-3 bg-slate-800 rounded-full group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-5 h-5 text-slate-300" />
                    </div>
                    <span className="text-sm font-medium">Click or Drag to Upload (Max 50MB)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
            {files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-60">
                <Cloud className="w-12 h-12 mb-3 grayscale" />
                <p className="text-sm">No files uploaded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {files.map((f) => (
                    <motion.div
                      key={f.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl flex items-center justify-between group hover:bg-slate-800/80 transition-colors"
                    >
                      <div className="overflow-hidden pr-3">
                        <p className="text-sm font-medium text-slate-200 truncate" title={f.name}>{f.name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                          <span>{formatSize(f.size)}</span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(f.uploadedAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleDownloadFile(f)}
                          className="p-2 text-slate-400 hover:text-sky-400 hover:bg-sky-400/10 rounded-md transition-colors"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteFile(f)}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="text-xs text-slate-500 text-center py-2 bg-slate-950 z-10 border-t border-slate-900">
        Data auto-destructs after 1 hour of inactivity.
      </footer>

      {/* QR Code Modal */}
      <AnimatePresence>
        {showQr && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowQr(false)}
          >
            <motion.div
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
              
              <div className="mt-6 w-full text-center p-3 bg-slate-800/50 rounded-lg border border-slate-700/50 font-mono text-sm break-all">
                {window.location.href}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
