"use client";

import { useState, useEffect, memo } from "react";
import { 
  Smartphone, Info, HelpCircle, QrCode, Share2, Trash2, LogOut, CheckCircle, KeyRound, Clock
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
  onStartTour,
  setShowShareAdminModal,
  activePasscodesCount,
  isMasterAdmin,
  guestRemainingSeconds,
  guestExpiresAt,
  onPasscodeExpired
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
  onStartTour: () => void,
  setShowShareAdminModal?: (v: boolean) => void,
  activePasscodesCount?: number,
  isMasterAdmin?: boolean,
  guestRemainingSeconds?: number | null,
  guestExpiresAt?: number | null,
  onPasscodeExpired?: () => void
}) => {
  const [countdown, setCountdown] = useState<number | null>(() => {
    if (guestExpiresAt) return Math.max(0, Math.floor((guestExpiresAt - Date.now()) / 1000));
    return guestRemainingSeconds ?? null;
  });

  useEffect(() => {
    if (guestExpiresAt) {
      setCountdown(Math.max(0, Math.floor((guestExpiresAt - Date.now()) / 1000)));
    } else {
      setCountdown(guestRemainingSeconds ?? null);
    }
  }, [guestRemainingSeconds, guestExpiresAt]);

  useEffect(() => {
    if (guestExpiresAt) {
      const updateTimer = () => {
        const rem = Math.max(0, Math.floor((guestExpiresAt - Date.now()) / 1000));
        setCountdown(rem);
        if (rem <= 0) {
          onPasscodeExpired?.();
        }
      };
      updateTimer();
      const timer = setInterval(updateTimer, 1000);
      return () => clearInterval(timer);
    }

    if (countdown === null || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev && prev > 1) return prev - 1;
        onPasscodeExpired?.();
        return 0;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [guestExpiresAt, countdown, onPasscodeExpired]);

  const formatCountdown = (totalSeconds: number) => {
    if (totalSeconds <= 0) return "Expired";
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };
  return (
    <header className="flex items-center justify-between px-2.5 sm:px-6 py-2.5 sm:py-4 border-b border-slate-800/60 bg-slate-900/40 backdrop-blur-md z-10 shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
          <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg hidden sm:block">Devices</h1>
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1 sm:gap-2 whitespace-nowrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
            <div id="tour-presence" className="flex items-center gap-1">
              <span>
                {connected ? (
                  <>
                    <span className="font-bold text-slate-200">{roomSize}</span>
                    <span className="hidden min-[420px]:inline ml-1 text-slate-400">Connected</span>
                  </>
                ) : (
                  <span>Online</span>
                )}
              </span>
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

      <div className="flex items-center gap-1 sm:gap-3 bg-slate-800/50 rounded-lg p-0.5 sm:p-1 border border-slate-700/50 shrink-0">
        <button 
          onClick={onStartTour}
          className="p-1.5 sm:p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-300 hover:text-white"
          title="Show Room Guide"
          aria-label="Start Onboarding Tour"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-slate-700" />

        <button 
          id="tour-qr"
          onClick={() => setShowQr(true)}
          className="p-1.5 sm:p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-300 hover:text-white"
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

        {isPro && isMasterAdmin && setShowShareAdminModal && (
          <>
            <button
              onClick={() => setShowShareAdminModal(true)}
              className={`p-1.5 sm:p-2 rounded-md transition-all flex items-center justify-center border shadow-md ${
                activePasscodesCount && activePasscodesCount > 0
                  ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-emerald-500/10'
                  : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20 shadow-blue-500/5'
              }`}
              title={
                activePasscodesCount && activePasscodesCount > 0
                  ? `${activePasscodesCount} Active Share Passcode(s)`
                  : "Share Expiring Passcode"
              }
              aria-label="Manage Expiring Passcodes"
            >
              <KeyRound className="w-4 h-4" />
              {activePasscodesCount !== undefined && activePasscodesCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />
              )}
            </button>
            <div className="h-4 w-px bg-slate-700" />
          </>
        )}

        {!isMasterAdmin && countdown !== null && countdown > 0 && (
          <>
            <div 
              className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-md font-mono font-bold text-[11px] sm:text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-sm"
              title="Guest session remaining time"
            >
              <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-pulse" />
              <span>{formatCountdown(countdown)}</span>
            </div>
            <div className="h-4 w-px bg-slate-700" />
          </>
        )}

        <button 
          id="tour-share"
          onClick={handleCopyLink}
          className={`flex items-center gap-1.5 px-2 sm:px-4 py-1.5 sm:py-2 transition-all rounded-md font-bold text-xs border ${copiedLink ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20 shadow-lg shadow-blue-500/5'}`}
        >
          {copiedLink ? <CheckCircle className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copiedLink ? "Copied!" : "Share"}</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />
        
        <button 
          id="tour-delete"
          onClick={handleDeleteSession}
          className={`p-1.5 sm:p-2 rounded-md transition-colors flex items-center gap-2 ${isPro ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400' : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400'}`}
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
