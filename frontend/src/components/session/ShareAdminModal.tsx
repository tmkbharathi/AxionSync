"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, KeyRound, Clock, Copy, CheckCircle, RefreshCw, Trash2, 
  ShieldCheck, AlertCircle, PlusCircle, ExternalLink, Sparkles 
} from "lucide-react";
import axios from "axios";

export interface ActivePasscode {
  passcode: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  durationSeconds: number;
  remainingSeconds: number;
  maxUses: number | null;
  uses: number;
  permissions?: {
    allowText?: boolean;
    allowFiles?: boolean;
    allowUploads?: boolean;
  };
}

interface ShareAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  token: string | null;
  apiUrl: string;
  onPasscodesCountChange?: (count: number) => void;
}

const DURATION_OPTIONS = [
  { label: "15 Minutes", value: 900 },
  { label: "1 Hour", value: 3600 },
  { label: "6 Hours", value: 21600 },
  { label: "24 Hours", value: 86400 },
  { label: "7 Days", value: 604800 },
];

export function ShareAdminModal({
  isOpen,
  onClose,
  sessionId,
  token,
  apiUrl,
  onPasscodesCountChange,
}: ShareAdminModalProps) {
  const [step, setStep] = useState<"create" | "active">("create");
  const [durationSeconds, setDurationSeconds] = useState<number>(3600);
  const [passcode, setPasscode] = useState<string>("");
  const [maxUses, setMaxUses] = useState<"unlimited" | "single">("unlimited");
  const [label, setLabel] = useState<string>("");

  const [activePasscodes, setActivePasscodes] = useState<ActivePasscode[]>([]);
  const [newlyCreated, setNewlyCreated] = useState<ActivePasscode | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [copiedPasscode, setCopiedPasscode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const [allowText, setAllowText] = useState<boolean>(true);
  const [allowFiles, setAllowFiles] = useState<boolean>(true);
  const [allowUploads, setAllowUploads] = useState<boolean>(true);

  // Auto-generate random 6-digit PIN
  const handleAutoGenerate = () => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setPasscode(pin);
  };

  // Fetch active passcodes
  const fetchPasscodes = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const res = await axios.get(`${apiUrl}/session/${sessionId}/share/passcodes`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const passcodes = res.data.passcodes || [];
      setActivePasscodes(passcodes);
      onPasscodesCountChange?.(passcodes.length);
    } catch (err: any) {
      console.error("Failed to fetch share passcodes:", err);
      setError(err.response?.data?.error || "Failed to load active passcodes.");
    }
  }, [apiUrl, sessionId, token, onPasscodesCountChange]);

  useEffect(() => {
    if (isOpen) {
      fetchPasscodes();
    }
  }, [isOpen, fetchPasscodes]);

  // Live ticking countdown timer for active passcodes
  useEffect(() => {
    if (!isOpen || activePasscodes.length === 0) return;

    const interval = setInterval(() => {
      setActivePasscodes(prev =>
        prev
          .map(item => ({
            ...item,
            remainingSeconds: item.expiresAt ? Math.max(0, Math.floor((item.expiresAt - Date.now()) / 1000)) : Math.max(0, item.remainingSeconds - 1)
          }))
          .filter(item => item.remainingSeconds > 0)
      );

      if (newlyCreated) {
        setNewlyCreated(prev => {
          if (!prev) return null;
          const rem = prev.expiresAt ? Math.max(0, Math.floor((prev.expiresAt - Date.now()) / 1000)) : Math.max(0, prev.remainingSeconds - 1);
          return rem > 0 ? { ...prev, remainingSeconds: rem } : null;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, activePasscodes.length, newlyCreated]);

  useEffect(() => {
    onPasscodesCountChange?.(activePasscodes.length);
  }, [activePasscodes.length, onPasscodesCountChange]);

  // Submit handler for creating a new passcode
  const handleCreatePasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const res = await axios.post(
        `${apiUrl}/session/${sessionId}/share/create-passcode`,
        {
          durationSeconds,
          passcode: passcode.trim() || undefined,
          maxUses: maxUses === "single" ? 1 : null,
          label: label.trim() || undefined,
          permissions: {
            allowText,
            allowFiles,
            allowUploads
          }
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const created: ActivePasscode = res.data.passcode;
      setNewlyCreated(created);
      setActivePasscodes(prev => [created, ...prev.filter(p => p.passcode !== created.passcode)]);
      
      // Reset form
      setPasscode("");
      setLabel("");
      
      // Transition to Step 2 (Active view with live timer)
      setStep("active");
    } catch (err: any) {
      console.error("Failed to create passcode:", err);
      setError(err.response?.data?.error || "Failed to create share passcode.");
    } finally {
      setLoading(false);
    }
  };

  // Revoke passcode handler
  const handleRevokePasscode = async (code: string) => {
    if (!token) return;
    try {
      await axios.delete(`${apiUrl}/session/${sessionId}/share/passcodes/${code}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setActivePasscodes(prev => prev.filter(p => p.passcode !== code));
      if (newlyCreated?.passcode === code) {
        setNewlyCreated(null);
      }
    } catch (err: any) {
      console.error("Failed to revoke passcode:", err);
      setError("Failed to revoke passcode.");
    }
  };

  // Toggle live permission handler
  const handleTogglePermission = async (code: string, permKey: "allowText" | "allowFiles" | "allowUploads") => {
    if (!token) return;
    const currentItem = activePasscodes.find(p => p.passcode === code);
    if (!currentItem) return;

    const currentPerms = currentItem.permissions || { allowText: true, allowFiles: true, allowUploads: true };
    const updatedPerms = {
      ...currentPerms,
      [permKey]: !currentPerms[permKey]
    };

    setActivePasscodes(prev =>
      prev.map(p => p.passcode === code ? { ...p, permissions: updatedPerms } : p)
    );

    try {
      await axios.patch(
        `${apiUrl}/session/${sessionId}/share/passcodes/${code}/permissions`,
        { permissions: updatedPerms },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error("Failed to update permissions:", err);
      fetchPasscodes();
    }
  };

  const getShareUrl = (code: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/${sessionId}?passcode=${code}`;
  };

  const handleCopyText = (text: string, type: "code" | "link", codeKey: string) => {
    navigator.clipboard.writeText(text);
    if (type === "code") {
      setCopiedPasscode(codeKey);
      setTimeout(() => setCopiedPasscode(null), 2000);
    } else {
      setCopiedLink(codeKey);
      setTimeout(() => setCopiedLink(null), 2000);
    }
  };

  const formatCountdown = (totalSeconds: number) => {
    if (totalSeconds <= 0) return "Expired";
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${String(hours).padStart(2, "0")}h:${String(mins).padStart(2, "0")}m:${String(secs).padStart(2, "0")}s`;
    return `${String(mins).padStart(2, "0")}m:${String(secs).padStart(2, "0")}s`;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Share Expiring Access
                  <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Admin Only
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Generate temporary PINs & expiring URLs for guests
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 bg-slate-950/40">
            <button
              onClick={() => setStep("create")}
              className={`flex-1 py-3 px-4 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
                step === "create"
                  ? "border-blue-500 text-blue-400 bg-blue-500/5"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              Create Passcode
            </button>
            <button
              onClick={() => {
                setStep("active");
                fetchPasscodes();
              }}
              className={`flex-1 py-3 px-4 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
                step === "active"
                  ? "border-blue-500 text-blue-400 bg-blue-500/5"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Clock className="w-4 h-4" />
              Active Passcodes ({activePasscodes.length})
            </button>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Modal Content Body */}
          <div className="p-6 max-h-[70vh] overflow-y-auto">
            {step === "create" ? (
              /* Step 1: Create Form */
              <form onSubmit={handleCreatePasscode} className="space-y-4">
                {/* Duration Presets */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">
                    1. Select Expiration Duration
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {DURATION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDurationSeconds(opt.value)}
                        className={`py-2 px-2 rounded-xl text-xs font-medium border transition-all text-center ${
                          durationSeconds === opt.value
                            ? "bg-blue-500/20 border-blue-500 text-blue-300 font-bold shadow-lg shadow-blue-500/10"
                            : "bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600 hover:text-white"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Password / PIN Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      2. Passcode / PIN (Optional)
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoGenerate}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      Auto-Generate PIN
                    </button>
                  </div>
                  <input
                    type="text"
                    value={passcode}
                    onChange={e => setPasscode(e.target.value)}
                    placeholder="Enter custom code or leave empty for random 6-digit PIN"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-all"
                  />
                </div>

                {/* Optional Label */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    3. Label / Device Description (Optional)
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    placeholder="e.g., Guest Phone, Temporary Laptop"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-all"
                  />
                </div>

                {/* Usage Limits */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    4. Usage Access Limit
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setMaxUses("unlimited")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        maxUses === "unlimited"
                          ? "bg-blue-500/10 border-blue-500/50 text-blue-300"
                          : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div className="font-bold text-xs">Multi-Device Access</div>
                      <div className="text-[10px] text-slate-400">Valid until duration expires</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaxUses("single")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        maxUses === "single"
                          ? "bg-amber-500/10 border-amber-500/50 text-amber-300"
                          : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div className="font-bold text-xs">Single-Use Link</div>
                      <div className="text-[10px] text-slate-400">Auto-expires after 1 login</div>
                    </button>
                  </div>
                </div>

                {/* Granular Guest Permissions */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    5. Guest Access Permissions
                  </label>
                  <div className="space-y-2 bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
                    <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                      <span className="text-slate-300 font-medium">📋 Allow Text Clipboard View</span>
                      <input
                        type="checkbox"
                        checked={allowText}
                        onChange={e => setAllowText(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                      <span className="text-slate-300 font-medium">📁 Allow Files Library View</span>
                      <input
                        type="checkbox"
                        checked={allowFiles}
                        onChange={e => setAllowFiles(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                      <span className="text-slate-300 font-medium">✏️ Allow Guest Edits & File Uploads</span>
                      <input
                        type="checkbox"
                        checked={allowUploads}
                        onChange={e => setAllowUploads(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                      />
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      Generate Expiring Passcode ⚡
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Step 2: Active Passcodes View with Live Countdown */
              <div className="space-y-4">
                {/* Newly Created Highlight Banner */}
                {newlyCreated && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl bg-gradient-to-br from-blue-900/40 via-cyan-900/20 to-slate-900 border border-cyan-500/40 shadow-xl"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Newly Added Passcode
                      </span>
                      <span className="font-mono text-xs font-bold text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <Clock className="w-3.5 h-3.5 animate-pulse" />
                        {formatCountdown(newlyCreated.remainingSeconds)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 bg-slate-950/80 p-3 rounded-xl border border-slate-800 mb-3">
                      <div>
                        <div className="text-[10px] text-slate-400">PASSCODE / PIN</div>
                        <div className="text-xl font-mono font-bold text-white tracking-widest">
                          {newlyCreated.passcode}
                        </div>
                      </div>
                      <button
                        onClick={() => handleCopyText(newlyCreated.passcode, "code", newlyCreated.passcode)}
                        className="p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        {copiedPasscode === newlyCreated.passcode ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>Copy PIN</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Direct Share Link */}
                    <div className="flex items-center justify-between gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                      <div className="truncate text-xs font-mono text-slate-400 flex-1 pr-2">
                        {getShareUrl(newlyCreated.passcode)}
                      </div>
                      <button
                        onClick={() => handleCopyText(getShareUrl(newlyCreated.passcode), "link", `link-${newlyCreated.passcode}`)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-semibold text-xs flex items-center gap-1.5 shrink-0 transition-colors"
                      >
                        {copiedLink === `link-${newlyCreated.passcode}` ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied Link!</span>
                          </>
                        ) : (
                          <>
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Copy Direct Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* List of Active Passcodes */}
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    All Active Passcodes ({activePasscodes.length})
                  </h3>
                  <button
                    onClick={fetchPasscodes}
                    className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>

                {activePasscodes.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs">
                    No active share passcodes right now.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activePasscodes.map(item => (
                      <div
                        key={item.passcode}
                        className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-white tracking-wider">
                              {item.passcode}
                            </span>
                            <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                              {item.label}
                            </span>
                            {item.maxUses && (
                              <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                Single-use ({item.uses}/{item.maxUses})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires in: {formatCountdown(item.remainingSeconds)}
                          </div>
                          {/* Live Permission Toggles */}
                          <div className="flex items-center gap-1 mt-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleTogglePermission(item.passcode, "allowText"); }}
                              className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border transition-all ${
                                item.permissions?.allowText !== false
                                  ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                                  : "bg-slate-900 text-slate-500 border-slate-800 line-through"
                              }`}
                              title="Click to toggle Text Clipboard permission"
                            >
                              📋 Text
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleTogglePermission(item.passcode, "allowFiles"); }}
                              className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border transition-all ${
                                item.permissions?.allowFiles !== false
                                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                  : "bg-slate-900 text-slate-500 border-slate-800 line-through"
                              }`}
                              title="Click to toggle File Library permission"
                            >
                              📁 Files
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleTogglePermission(item.passcode, "allowUploads"); }}
                              className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border transition-all ${
                                item.permissions?.allowUploads !== false
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                  : "bg-slate-900 text-slate-500 border-slate-800 line-through"
                              }`}
                              title="Click to toggle Guest Edits/Uploads permission"
                            >
                              ✏️ Edits
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleCopyText(item.passcode, "code", item.passcode)}
                            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="Copy PIN"
                          >
                            {copiedPasscode === item.passcode ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleCopyText(getShareUrl(item.passcode), "link", `link-${item.passcode}`)}
                            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
                            title="Copy Direct Link"
                          >
                            {copiedLink === `link-${item.passcode}` ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <ExternalLink className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleRevokePasscode(item.passcode)}
                            className="p-2 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Revoke Passcode"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              Secure 256-bit Token Validation
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
