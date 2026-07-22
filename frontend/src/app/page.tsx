"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Copy, ArrowRight, Cloud, Shield, Zap, CheckCircle2, Heart, Lock, Unlock, ShieldCheck, Star, Crown, ChevronDown, Eye, EyeOff, X, Sparkles } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { useState, useRef, useMemo, useEffect, memo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import { siteConfig } from "@/config/site";
import { Background3D } from "@/components/Background3D";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import PerformanceSettings from "@/components/PerformanceSettings";
import { OnboardingTour, TourLauncher } from "@/components/OnboardingTour";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Admin Credentials
const ADMIN_SESSION_ID = process.env.NEXT_PUBLIC_ADMIN_SESSION_ID;

// 3D components removed (moved to shared components)

// Tour Steps Configuration
const LANDING_TOUR_STEPS = [
  {
    title: "Welcome to AxionSync! 👋",
    description: "AxionSync is a high-performance, real-time digital workspace that instantly shares clipboard text and files across devices. No accounts required.",
    position: "center" as const
  },
  {
    targetId: "tour-new-session",
    title: "Start a New Session ⚡",
    description: "Create a temporary, private workspace room. Devices in this room will sync with each other instantly.",
    position: "bottom" as const
  },
  {
    targetId: "tour-join-session",
    title: "Join an Existing Room 🔗",
    description: "Enter an 8-character room key from your other device here to instantly establish a connection.",
    position: "bottom" as const
  }
];

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isListening, setIsListening] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [joinKey, setJoinKey] = useState("");
  const [showThankYou, setShowThankYou] = useState(false);
  const [isDeletedByOther, setIsDeletedByOther] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);

  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState(false);
  const [adminErrorMessage, setAdminErrorMessage] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showE2eeDetails, setShowE2eeDetails] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isProHovered, setIsProHovered] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [isTourActive, setIsTourActive] = useState(false);
  const [showTourBanner, setShowTourBanner] = useState(false);

  useEffect(() => {
    // Show banner only if they haven't completed the tour before
    const isCompleted = localStorage.getItem("syncosync:tour:landing");
    if (!isCompleted) {
      // Small delay for nice entrance
      const timer = setTimeout(() => setShowTourBanner(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleCloseAdminModal = () => {
    setShowAdminModal(false);
    setAdminPassword("");
    setJoinKey("");
    setShowPassword(false);
    setAdminError(false);
    setAdminErrorMessage(null);
    setIsUnlocking(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showAdminModal) {
        handleCloseAdminModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAdminModal]);

  const thankYouModalRef = useFocusTrap(showThankYou);

  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "deleted" || status === "not_found") {
      setShowThankYou(true);
      setIsDeletedByOther(searchParams.get("origin") === "other");
      setIsNotFound(status === "not_found");

      // Clean up the URL
      window.history.replaceState({}, '', '/');

      // Auto-hide after some time
      const timer = setTimeout(() => setShowThankYou(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  const handleStart = async () => {
    setIsGenerating(true);
    const sessionId = uuidv4().slice(0, 8); // Generate ID once
    try {
      // Initialize the session on the backend to mark it as active
      await axios.post(`${API_URL}/session/${sessionId}/init`);
      router.push(`/${sessionId}`);
    } catch (err) {
      console.error("Failed to initialize session:", err);
      // Fallback: still redirect to the SAME sessionId. 
      // The session page will detect it's not initialized and offer a "Start This Room" button.
      router.push(`/${sessionId}`);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = joinKey.trim().toLowerCase();
    if (!key) return;

    setIsJoining(true);
    setJoinError(null);

    try {
      if (key === ADMIN_SESSION_ID) {
        setShowAdminModal(true);
        setIsJoining(false);
        return;
      }

      // Validate session exists on backend
      await axios.get(`${API_URL}/session/${key}`);
      router.push(`/${key}`);
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.error("Join failed:", err);
      }
      if (err.response?.status === 404) {
        setJoinError("Room not found");
      } else {
        setJoinError("Failed to connect");
      }
      setIsJoining(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-white overflow-hidden flex flex-col justify-center items-center select-none">

      {/* Top Navigation & Help Buttons */}
      {/* GitHub Link */}
      <div className="fixed top-3 right-3 sm:top-6 sm:right-6 z-50">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 0.6, x: 0 }}
          whileHover={{ opacity: 1, scale: 1.05 }}
        >
          <a
            href={siteConfig.links.github}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-all border border-slate-800 hover:border-slate-700 bg-slate-900/60 backdrop-blur-md px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-xl shadow-xl group"
            title="GitHub Repository"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 fill-current transition-transform group-hover:scale-110"
              aria-hidden="true"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span className="hidden sm:inline">Repository</span>
          </a>
        </motion.div>
      </div>

      {/* Take a Tour Trigger */}
      <div className="fixed top-3 left-3 sm:left-auto sm:right-6 sm:top-[70px] z-50">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 0.6, x: 0 }}
          whileHover={{ opacity: 1, scale: 1.05 }}
          transition={{ delay: 0.1 }}
        >
          <button
            onClick={() => setIsTourActive(true)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-blue-400 transition-all border border-slate-800 hover:border-blue-500/30 bg-slate-900/60 backdrop-blur-md px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-xl shadow-xl group cursor-pointer font-sans"
            title="Take a Tour"
          >
            <Sparkles className="w-4 h-4 text-slate-500 group-hover:text-blue-400 transition-colors" />
            <span className="hidden sm:inline">Take a Tour</span>
          </button>
        </motion.div>
      </div>

      {/* Modern Three.js Particle Container (Isolated for Performance) */}
      <Background3D />

      {/* Floating Performance Settings */}
      <PerformanceSettings />

      <div className="relative z-10 w-full max-w-5xl px-3 sm:px-6 py-4 sm:py-6 lg:px-8 flex flex-col items-center">

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center w-full max-w-md"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm mb-6 text-[11px] font-bold uppercase tracking-widest text-cyan-400">
            <Zap className="w-3 h-3 fill-cyan-400" />
            Real-Time Sync • <span className="text-cyan-300/80">Beta v{siteConfig.version}</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-normal mb-4 pb-2 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 relative inline-block">
            {siteConfig.name}
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Instantly sync your clipboard text and share files securely across all your devices.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{
            opacity: 1,
            y: 0,
            x: joinError ? [-5, 5, -5, 5, 0] : 0
          }}
          transition={{
            opacity: { duration: 0.8, delay: 0.2 },
            y: { duration: 0.8, delay: 0.2 },
            x: { duration: 0.4 }
          }}
          className="mt-8 w-full max-w-[460px] bg-slate-900/30 backdrop-blur-xl border border-slate-800/60 p-1.5 rounded-2xl shadow-2xl flex flex-col sm:flex-row items-center gap-3 group/input transition-all hover:border-blue-500/30 relative"
        >

          {/* Create Section */}
          <motion.button
            id="tour-new-session"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleStart}
            disabled={isGenerating}
            className="w-full sm:w-auto flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-base shadow-[0_0_30px_-10px_rgba(37,99,235,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
          >
            <Zap className="w-4 h-4 fill-white" />
            {isGenerating ? "Preparing..." : "New Session"}
          </motion.button>

          {/* Subtle Divider (visible on desktop) */}
          <div className="hidden sm:block w-px h-8 bg-slate-800" />

          {/* Join Section */}
          <div id="tour-join-session" className="w-full sm:w-auto flex-[1.5] relative">
            <form onSubmit={handleJoin} className="relative w-full">

              <input
                id="main-content"
                type="text"
                placeholder="Use Existing Key"
                maxLength={8}
                value={joinKey}
                autoComplete="off"
                spellCheck="false"
                onChange={(e) => {
                  setJoinKey(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                className={`w-full py-4 bg-transparent border-2 ${joinError ? "border-red-500/50" : "border-slate-700/50 focus:border-blue-500/50"
                  } rounded-2xl transition-all font-mono tracking-widest uppercase placeholder:font-sans placeholder:tracking-normal placeholder:lowercase placeholder:text-sm placeholder:text-center ${joinError ? "placeholder:text-red-400" : "placeholder:text-slate-600"
                  } text-center ${joinKey.length > 0 ? "pr-26" : "px-4"
                  }`}
              />
              <AnimatePresence>
                {joinKey.trim().length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    type="submit"
                    disabled={isJoining}
                    className="absolute right-2 top-2 bottom-2 px-6 bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700 rounded-xl font-bold text-xs transition-colors shadow-lg flex items-center gap-2 disabled:opacity-50"
                  >
                    {isJoining ? (
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        JOIN
                        <ArrowRight className="w-3 h-3" />
                      </>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>
            </form>
          </div>
        </motion.div>

        {/* Minimal Professional Error Message (Absolute to maintain layout stability) */}
        <div className="relative w-full flex justify-center h-0">
          <AnimatePresence>
            {joinError && (
              <motion.div
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: 1, y: 12 }}
                exit={{ opacity: 0, y: 0 }}
                className="absolute top-0 flex items-center gap-2 text-red-400 font-medium text-[10px] uppercase tracking-[0.2em] bg-slate-900/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-red-500/20 shadow-xl z-20 whitespace-nowrap"
              >
                <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                {joinError}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl"
        >
          <FeatureCard
            icon={<Copy className="w-6 h-6 text-cyan-400" />}
            title="Real-time Clipboard"
            desc="Copy on one device, paste on any other—instantly and in real-time."
            badge={<E2eeToggleBadge />}
          />
          <FeatureCard
            icon={<Cloud className="w-6 h-6 text-blue-400" />}
            title="Cloud File Storage"
            desc="Upload files up to 50MB and access them from any device."
            badge={<E2eeToggleBadge />}
          />
          <FeatureCard
            icon={<Shield className="w-6 h-6 text-indigo-400" />}
            title="Auto Cleanup"
            desc="Files and text auto-destruct after 24 hours of inactivity."
          />
        </motion.div>

      </div>

      {/* Peaceful Thank You Overlay */}
      <AnimatePresence>
        {showThankYou && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-lg"
            onClick={() => setShowThankYou(false)}
          >
            <motion.div
              ref={thankYouModalRef}
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="max-w-md w-full bg-slate-900/40 border border-blue-500/20 p-10 rounded-[2.5rem] text-center relative overflow-hidden group shadow-2xl shadow-blue-500/10"
              onClick={e => e.stopPropagation()}
            >
              {/* Decorative Glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-blue-500/20 rounded-full blur-[60px] pointer-events-none" />

              <motion.div
                initial={{ rotate: -10, scale: 0.8 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: "spring", damping: 12 }}
                className="w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-blue-500/20"
              >
                <CheckCircle2 className="w-10 h-10 text-white" />
              </motion.div>

              <h2 className="text-3xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                {isNotFound ? 'Room Not Found' :
                  isDeletedByOther ? 'Session Ended' : 'Room Peacefully Closed'}
              </h2>

              <p className="text-slate-300 text-lg mb-8 leading-relaxed italic font-medium pt-2 border-t border-slate-800">
                {isNotFound
                  ? '"The digital trail ends here. This space is no longer active."'
                  : '"May your files find their home and your mind find its peace."'
                }
              </p>

              <div className="flex flex-col gap-4">
                <p className="text-slate-500 text-sm">
                  {isNotFound
                    ? "The session you tried to join doesn't exist or has been permanently removed from our memory."
                    : isDeletedByOther
                      ? "A participant has closed this room and securely wiped all shared data."
                      : "The session has been completely wiped from our systems. Thank you for trusting AxionSync with your temporary workspace."}
                </p>

                <button
                  onClick={() => setShowThankYou(false)}
                  className="mt-4 px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all border border-slate-700 hover:border-blue-500/30"
                >
                  Return to Home
                </button>
              </div>

              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Password Modal */}
      <AnimatePresence>
        {showAdminModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-lg"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="max-w-sm w-full bg-slate-900/60 border border-slate-700 p-8 rounded-[2rem] text-center relative shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={handleCloseAdminModal}
                className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-slate-800/50 rounded-full transition-all"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>

              <motion.div
                animate={{
                  backgroundColor: isVerified ? "rgba(16, 185, 129, 0.15)" : "rgba(37, 99, 235, 0.15)",
                  borderColor: isVerified ? "rgba(16, 185, 129, 0.3)" : "rgba(37, 99, 235, 0.3)"
                }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-transparent transition-colors relative"
              >
                <AnimatePresence initial={false}>
                  <motion.div
                    key={isVerified ? 'unlocked' : 'locked'}
                    initial={{ scale: 0.8, opacity: 0, rotate: -15 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.8, opacity: 0, rotate: 15 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    {isVerified ? (
                      <Unlock className="w-8 h-8 text-emerald-400" />
                    ) : (
                      <Lock className="w-8 h-8 text-blue-400" />
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.div>

              <h2 className="text-xl font-bold mb-2">Reserved Session</h2>
              <p className="text-slate-400 text-xs mb-6 uppercase tracking-widest font-bold">Session ID: {ADMIN_SESSION_ID}</p>

              <form onSubmit={async (e) => {
                e.preventDefault();
                const pwd = adminPassword.trim();
                if (!pwd || isUnlocking) return;

                setIsUnlocking(true);
                try {
                  const res = await axios.post(`${API_URL}/session/${ADMIN_SESSION_ID}/unlock`, {
                    password: pwd
                  });
                  if (res.data.success && res.data.token) {
                    setIsVerified(true);
                    setAdminError(false);
                    setAdminErrorMessage(null);
                    sessionStorage.setItem(`syncosync:auth:${ADMIN_SESSION_ID}`, res.data.token);
                    sessionStorage.setItem(`syncosync:is_master_admin:${ADMIN_SESSION_ID}`, res.data.isMasterAdmin ? "true" : "false");
                    window.location.href = `/${ADMIN_SESSION_ID}`;
                  } else {
                    setAdminError(true);
                    setIsUnlocking(false);
                    setTimeout(() => setAdminError(false), 2000);
                  }
                } catch (err: any) {
                  setAdminError(true);
                  setIsUnlocking(false);
                  if (err.response?.status === 429) {
                    setAdminErrorMessage(err.response?.data?.error || "Too many passcode unlock attempts. Please try again after 15 minutes.");
                  } else {
                    setAdminErrorMessage("Invalid passcode or expired link.");
                    setTimeout(() => setAdminError(false), 2000);
                  }
                }
              }}>
                <div className="relative mb-4">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoFocus
                    placeholder="Enter Password"
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value);
                      setAdminError(false);
                      setAdminErrorMessage(null);
                      setIsVerified(false);
                    }}
                    className={`w-full py-3 px-12 bg-slate-800 border-2 ${adminError ? 'border-rose-500/50' : isVerified ? 'border-emerald-500/50' : 'border-slate-700 focus:border-blue-500/50'} rounded-xl text-center outline-none transition-all placeholder:text-slate-600`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {adminErrorMessage && (
                  <p className="text-xs text-rose-400 font-medium mb-3 text-center animate-pulse">
                    {adminErrorMessage}
                  </p>
                )}

                <div className="flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={isUnlocking}
                    className={`w-full py-3 ${isVerified ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'} text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-80`}
                  >
                    {isUnlocking ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : isVerified ? (
                      "Unlocked!"
                    ) : (
                      "Unlock Session"
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Onboarding Tour Components */}
      <OnboardingTour
        tourKey="landing"
        steps={LANDING_TOUR_STEPS}
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
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-sm"
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
                    localStorage.setItem("syncosync:tour:landing", "completed");
                    setShowTourBanner(false);
                  }}
                  className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 rounded-full transition-all cursor-none"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <h4 className="text-base font-bold text-white mb-1.5">Welcome! Let's take a tour 👋</h4>
                <p className="text-slate-300 text-xs leading-relaxed font-normal">
                  New to AxionSync? Let's take a 1-minute interactive tour to see how to sync your clipboard and files!
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
                    localStorage.setItem("syncosync:tour:landing", "completed");
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

// Wrap Home in Suspense because of useSearchParams
export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <Home />
    </Suspense>
  );
}

const E2eeToggleBadge = memo(function E2eeToggleBadge() {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setExpanded(!expanded);
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-emerald-500/5 select-none"
      title="Click to toggle E2EE encryption status"
    >
      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="overflow-hidden whitespace-nowrap ml-0.5"
          >
            AES-256 E2EE
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
});

const FeatureCard = memo(function FeatureCard({ icon, title, desc, badge }: { icon: React.ReactNode, title: string, desc: string, badge?: React.ReactNode }) {
  return (
    <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-6 hover:bg-slate-800/50 transition-colors relative">
      {badge && (
        <div className="absolute top-4 right-4 z-10">
          {badge}
        </div>
      )}
      <div className="bg-slate-800/80 w-12 h-12 rounded-lg flex items-center justify-center mb-4 border border-slate-700">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-2 text-slate-100">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
    </div>
  );
});
