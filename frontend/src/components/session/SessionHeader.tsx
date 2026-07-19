"use client";

import { memo } from "react";
import { 
  Smartphone, Info, HelpCircle, QrCode, Share2, Trash2, LogOut, CheckCircle, Share
} from "lucide-react";
import { siteConfig } from "@/config/site";

export const SessionHeader = memo(({ 
  connected, 
  roomSize, 
  sessionId, 
  setShowDevicesModal, 
  setShowQr, 
  handleCopyLink, 
  copiedLink,
  handleDeleteSession,
  isPro,
  onStartTour
}: { 
  connected: boolean, 
  roomSize: number, 
  sessionId: string, 
  setShowDevicesModal: (v: boolean) => void, 
  setShowQr: (v: boolean) => void, 
  handleCopyLink: () => void, 
  copiedLink: boolean,
  handleDeleteSession: () => void,
  isPro: boolean,
  onStartTour: () => void
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
            <div id="tour-presence" className="flex items-center gap-1.5">
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
          onClick={onStartTour}
          className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-300 hover:text-white"
          title="Show Room Guide"
          aria-label="Start Onboarding Tour"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-slate-700" />

        <button 
          id="tour-qr"
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
          id="tour-share"
          onClick={handleCopyLink}
          className={`flex items-center gap-2 px-2 sm:px-4 py-2 transition-all rounded-md font-bold text-xs border ${copiedLink ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20 shadow-lg shadow-blue-500/5'}`}
        >
          {copiedLink ? <CheckCircle className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copiedLink ? "Copied!" : "Share"}</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />
        
        <button 
          id="tour-delete"
          onClick={handleDeleteSession}
          className={`p-2 rounded-md transition-colors flex items-center gap-2 ${isPro ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400' : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400'}`}
          title={isPro ? "Logout Session" : "Delete Session"}
          aria-label={isPro ? "Logout from this session" : "Wipe and Delete Entire Session"}
        >
          {isPro ? <LogOut className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
          <span className="hidden sm:inline text-xs font-medium">{isPro ? "Logout" : "Delete"}</span>
        </button>
      </div>
    </header>
  );
});

SessionHeader.displayName = "SessionHeader";
