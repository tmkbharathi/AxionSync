"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Socket } from "socket.io-client";
import { Mic, MicOff, Minus, Plus, CheckCircle, Copy, Lock, ShieldCheck } from "lucide-react";
import { siteConfig } from "@/config/site";
import { encryptText, decryptText } from "@/lib/crypto";

export const ClipboardPanel = memo(({ 
  sessionId, 
  socket, 
  connected, 
  initialText,
  activeTab,
  isFilePanelCollapsed,
  permissions
}: { 
  sessionId: string, 
  socket: Socket | null, 
  connected: boolean,
  initialText: string,
  activeTab: string,
  isFilePanelCollapsed: boolean,
  permissions?: { allowText?: boolean; allowFiles?: boolean; allowUploads?: boolean }
}) => {
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(14);
  const [copiedText, setCopiedText] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const textRef = useRef("");
  const isLocalChange = useRef(false);
  const recognitionRef = useRef<any>(null);

  // Sync with initialText from parent (only for first load or remote updates)
  useEffect(() => {
    decryptText(initialText, sessionId).then(decrypted => {
      if (decrypted !== textRef.current) {
        setText(decrypted);
        textRef.current = decrypted;
      }
    });
  }, [initialText, sessionId]);

  // WebSocket Listener for text updates
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = async ({ content }: { content: string }) => {
      const decrypted = await decryptText(content, sessionId);
      if (decrypted !== textRef.current) {
        isLocalChange.current = false;
        setText(decrypted);
        textRef.current = decrypted;
        localStorage.setItem(`${siteConfig.slug}:text:${sessionId}`, decrypted);
      }
    };
    socket.on("text_updated", handleUpdate);
    return () => { socket.off("text_updated", handleUpdate); };
  }, [socket, sessionId]);

  // Debounced auto-save & Socket broadcast with AES-256 E2EE encryption
  useEffect(() => {
    if (!isLocalChange.current || permissions?.allowUploads === false) return;
    
    const timer = setTimeout(async () => {
      if (socket && connected) {
        const encrypted = await encryptText(text, sessionId);
        socket.emit("update_text", { sessionId, content: encrypted });
        localStorage.setItem(`${siteConfig.slug}:text:${sessionId}`, text);
      }
      isLocalChange.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [text, socket, connected, sessionId, permissions]);

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
    if (permissions?.allowUploads === false) return;
    const newText = e.target.value;
    isLocalChange.current = true;
    setText(newText);
    textRef.current = newText;
  }, [permissions]);

  const toggleListening = useCallback(() => {
    if (permissions?.allowUploads === false) return;
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
  }, [isListening, permissions]);

  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  }, [text]);

  const isReadOnly = permissions?.allowUploads === false;
  const isTextHidden = permissions?.allowText === false;

  return (
    <div className={`h-full flex flex-col items-stretch p-4 md:p-6 transition-all duration-300 ease-in-out ${activeTab === 'text' ? 'block' : 'hidden md:flex'} ${isFilePanelCollapsed ? 'w-full' : 'w-full md:w-3/5 lg:w-2/3'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-200">Clipboard</h2>
          {isReadOnly && (
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Read-Only
            </span>
          )}
          {!isReadOnly && !isTextHidden && (
            <button 
              id="tour-mic"
              onClick={toggleListening}
              className={`p-1.5 rounded text-white transition-colors border ${isListening ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 animate-pulse' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
            >
              {isListening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            </button>
          )}
          {!isTextHidden && (
            <div className="flex items-center bg-slate-800 rounded border border-slate-700 p-0.5">
              <button onClick={() => setFontSize(p => Math.max(10, p - 2))} className="p-1 hover:bg-slate-700 rounded-sm transition-colors text-slate-400 hover:text-white"><Minus className="w-3.5 h-3.5" /></button>
              <div className="w-px h-3.5 bg-slate-700 mx-0.5" />
              <button onClick={() => setFontSize(p => Math.min(48, p + 2))} className="p-1 hover:bg-slate-700 rounded-sm transition-colors text-slate-400 hover:text-white"><Plus className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
        {!isTextHidden && (
          <button onClick={handleCopyText} className="p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center justify-center gap-2 border border-slate-700">
            {copiedText ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copiedText ? 'Copied!' : 'Copy All'}</span>
          </button>
        )}
      </div>

      {isTextHidden ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-900/30 border border-slate-800/60 rounded-xl">
          <Lock className="w-10 h-10 mb-3 text-amber-400/80 animate-pulse" />
          <h3 className="text-base font-bold text-slate-300">Text Clipboard Hidden</h3>
          <p className="text-xs text-slate-500 max-w-xs mt-1">
            The room administrator has restricted clipboard text access for this guest passcode.
          </p>
        </div>
      ) : (
        <div id="tour-clipboard" className="flex-1 relative mb-4 rounded-xl overflow-hidden border border-slate-800/60 bg-slate-900/30 backdrop-blur-sm group focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/50 transition-all shadow-inner">
          <textarea
            id="main-content"
            value={text}
            onChange={handleTextChange}
            readOnly={isReadOnly}
            placeholder={isReadOnly ? "Read-only mode (Editing disabled by admin)" : "Type or paste text here... It will sync securely with End-to-End Encryption."}
            style={{ scrollbarGutter: 'stable', fontSize: `${fontSize}px` }}
            className={`w-full h-full p-3 bg-transparent resize-none outline-none font-mono leading-relaxed ${isReadOnly ? 'text-slate-400 cursor-not-allowed' : 'text-slate-200 placeholder:text-slate-600'}`}
          />
        </div>
      )}
    </div>
  );
});

ClipboardPanel.displayName = "ClipboardPanel";
