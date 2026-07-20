"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Sparkles, HelpCircle } from "lucide-react";

export interface TourStep {
  targetId?: string; // ID of the HTML element to highlight
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
}

interface OnboardingTourProps {
  tourKey: string; // Unique key to save in localStorage (e.g. 'landing-tour')
  steps: TourStep[];
  isActive: boolean;
  onClose: () => void;
  onStepChange?: (stepIdx: number, step: TourStep) => void;
}

export function OnboardingTour({ tourKey, steps, isActive, onClose, onStepChange }: OnboardingTourProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardCoords, setCardCoords] = useState({ top: 0, left: 0 });

  const activeStep = steps[currentStepIdx];

  // Notify parent component of step changes (e.g. to switch mobile tabs or uncollapse panels)
  useEffect(() => {
    if (isActive && activeStep && !showCelebration) {
      onStepChange?.(currentStepIdx, activeStep);
    }
  }, [currentStepIdx, isActive, activeStep, showCelebration, onStepChange]);

  // Initialize window size
  useEffect(() => {
    if (typeof window !== "undefined") {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      const handleResize = () => {
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // Monitor target elements and calculate positions
  useEffect(() => {
    if (!isActive || steps.length === 0 || showCelebration) {
      setTargetRect(null);
      return;
    }

    const updatePosition = () => {
      if (!activeStep) return;

      if (activeStep.targetId) {
        const element = document.getElementById(activeStep.targetId);
        if (element) {
          const rect = element.getBoundingClientRect();

          // If element has no size (e.g. tab transition or display:none), don't set invalid targetRect yet
          if (rect.width === 0 || rect.height === 0) {
            setTargetRect(null);
            return;
          }

          // Scroll element into view if not fully visible
          const isVisible =
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth;

          if (!isVisible) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }

          // Fetch updated bounds
          const updatedRect = element.getBoundingClientRect();
          setTargetRect(updatedRect);
          return;
        }
      }
      setTargetRect(null);
    };

    // Run immediately and setup scroll/resize handlers + delayed retries (for tab animation/DOM mount)
    updatePosition();
    
    const timer1 = setTimeout(updatePosition, 50);
    const timer2 = setTimeout(updatePosition, 150);
    const timer3 = setTimeout(updatePosition, 300);

    window.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      window.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [currentStepIdx, isActive, activeStep, windowSize, showCelebration]);

  // Position the card near the highlighted element
  useEffect(() => {
    if (!isActive || (!activeStep && !showCelebration)) return;

    const margin = 16;
    const cardWidth = cardRef.current?.offsetWidth || 340;
    const cardHeight = cardRef.current?.offsetHeight || 220;

    let top = window.innerHeight / 2 - cardHeight / 2;
    let left = window.innerWidth / 2 - cardWidth / 2;

    if (targetRect && !showCelebration) {
      let position = activeStep.position || "bottom";

      // On mobile screens (<768px), fallback "left" or "right" to "bottom" or "top" for clear visibility
      if (window.innerWidth < 768 && (position === "left" || position === "right")) {
        const spaceBelow = window.innerHeight - targetRect.bottom;
        position = spaceBelow >= cardHeight + margin ? "bottom" : "top";
      }

      switch (position) {
        case "top":
          top = targetRect.top - cardHeight - margin;
          left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
          break;
        case "bottom":
          top = targetRect.bottom + margin;
          left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
          break;
        case "left":
          top = targetRect.top + targetRect.height / 2 - cardHeight / 2;
          left = targetRect.left - cardWidth - margin;
          break;
        case "right":
          top = targetRect.top + targetRect.height / 2 - cardHeight / 2;
          left = targetRect.right + margin;
          break;
        case "center":
        default:
          top = window.innerHeight / 2 - cardHeight / 2;
          left = window.innerWidth / 2 - cardWidth / 2;
          break;
      }

      // Add scroll offsets since getBoundingClientRect is relative to viewport
      top += window.scrollY;
      left += window.scrollX;
    } else {
      // Centered position + scroll offsets
      top += window.scrollY;
      left += window.scrollX;
    }

    // Viewport clamping (keep card fully on-screen)
    const padding = 16;
    const minLeft = window.scrollX + padding;
    const maxLeft = window.scrollX + window.innerWidth - cardWidth - padding;
    const minTop = window.scrollY + padding;
    const maxTop = window.scrollY + window.innerHeight - cardHeight - padding;

    left = Math.max(minLeft, Math.min(maxLeft, left));
    top = Math.max(minTop, Math.min(maxTop, top));

    setCardCoords({ top, left });
  }, [targetRect, activeStep, isActive, windowSize, showCelebration]);

  // Keyboard navigation controls
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (showCelebration) {
          handleComplete();
        } else {
          handleNext();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, showCelebration, currentStepIdx, steps.length]);

  if (!isActive) return null;

  const handleNext = () => {
    if (currentStepIdx < steps.length - 1) {
      setCurrentStepIdx(prev => prev + 1);
    } else {
      setShowCelebration(true);
    }
  };

  const handleBack = () => {
    if (showCelebration) {
      setShowCelebration(false);
    } else if (currentStepIdx > 0) {
      setCurrentStepIdx(prev => prev - 1);
    }
  };

  const handleClose = () => {
    onClose();
    setShowCelebration(false);
    setCurrentStepIdx(0);
  };

  const handleComplete = () => {
    localStorage.setItem(`syncosync:tour:${tourKey}`, "completed");
    onClose();
    setShowCelebration(false);
    setCurrentStepIdx(0);
  };

  // Render a single full-screen backdrop overlay with an SVG mask for a smooth animated spotlight cutout
  const renderOverlays = () => {
    const docHeight = typeof document !== "undefined" ? (document.documentElement.scrollHeight || window.innerHeight) : "100%";
    const maskId = `tour-spotlight-mask-${tourKey}`;

    const padding = 8;
    const rx = 12;

    const targetX = targetRect ? targetRect.left + window.scrollX - padding : 0;
    const targetY = targetRect ? targetRect.top + window.scrollY - padding : 0;
    const targetW = targetRect ? Math.max(0, targetRect.width + padding * 2) : 0;
    const targetH = targetRect ? Math.max(0, targetRect.height + padding * 2) : 0;

    return (
      <div className="absolute inset-0 pointer-events-none" style={{ height: docHeight }}>
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ height: docHeight }}>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height={docHeight}>
              {/* White rect covers full screen so backdrop blur displays smoothly everywhere */}
              <rect x="0" y="0" width="100%" height={docHeight} fill="white" />
              {/* Black rect smoothly cuts out the spotlight hole for the target element */}
              {targetRect && !showCelebration && (
                <motion.rect
                  initial={false}
                  animate={{
                    x: targetX,
                    y: targetY,
                    width: targetW,
                    height: targetH,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  rx={rx}
                  ry={rx}
                  fill="black"
                />
              )}
            </mask>
          </defs>
        </svg>

        {/* Single uniform full-screen backdrop overlay */}
        <div 
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm pointer-events-auto transition-all duration-300"
          style={{ 
            height: docHeight,
            mask: `url(#${maskId})`,
            WebkitMask: `url(#${maskId})`
          }}
        />
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-40 pointer-events-none select-none">
      {/* Dark background overlay with dynamic spotlight cutout */}
      {renderOverlays()}

      {/* Pulsing ring around target element */}
      {targetRect && !showCelebration && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{
            opacity: 1,
            scale: 1,
            top: targetRect.top + window.scrollY - 8,
            left: targetRect.left + window.scrollX - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute border-2 border-cyan-400/80 rounded-xl shadow-[0_0_15px_rgba(34,211,238,0.4)] pointer-events-none z-45"
        >
          <div className="absolute inset-0 border border-cyan-400/40 rounded-xl animate-ping opacity-40" />
        </motion.div>
      )}

      {/* Onboarding Dialog Card */}
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
          top: cardCoords.top,
          left: cardCoords.left,
        }}
        transition={{ type: "spring", stiffness: 350, damping: 32 }}
        className="absolute w-[340px] bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 p-6 rounded-3xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] shadow-blue-500/10 pointer-events-auto z-50 flex flex-col gap-4 text-left select-none text-white"
      >
        {showCelebration ? (
          <>
            {/* Celebration Glow Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                  <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Workspace Ready!</span>
              </div>
              <button
                onClick={handleClose}
                className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 rounded-full transition-all cursor-none"
                aria-label="Close tour"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Text Details */}
            <div>
              <h4 className="text-base font-bold text-white mb-1.5">You're All Set! 🎉</h4>
              <p className="text-slate-300 text-xs leading-relaxed font-normal">
                {tourKey === "landing"
                  ? "Generate a New Session or enter a Room Key to sync clipboard text and files instantly."
                  : "Type or upload files to start sharing. Scan the QR code or copy the link to connect another device!"}
              </p>
            </div>

            {/* Celebration button and back trigger */}
            <div className="mt-2 flex flex-col gap-3">
              <button
                onClick={handleComplete}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-1.5 cursor-none"
              >
                Let's Go!
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleBack}
                className="text-center text-[10px] text-slate-500 hover:text-slate-300 font-semibold transition-colors cursor-none py-1"
              >
                Go Back to Tour
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Glow Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30">
                  <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interactive Tour</span>
              </div>
              <button
                onClick={handleClose}
                className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 rounded-full transition-all cursor-none"
                aria-label="Close tour"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Text Details */}
            <div>
              <h4 className="text-base font-bold text-white mb-1.5">{activeStep.title}</h4>
              <p className="text-slate-300 text-xs leading-relaxed font-normal">{activeStep.description}</p>
            </div>

            {/* Progress and controls */}
            <div className="mt-2 flex flex-col gap-4">
              {/* Progress Bar */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold font-mono text-slate-500">
                  {currentStepIdx + 1}/{steps.length}
                </span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentStepIdx + 1) / steps.length) * 100}%` }}
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleClose}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-200 cursor-none px-2 py-1 rounded transition-colors"
                >
                  Skip Tour
                </button>

                <div className="flex items-center gap-2">
                  {currentStepIdx > 0 && (
                    <button
                      onClick={handleBack}
                      className="p-2 border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition-all flex items-center justify-center cursor-none"
                      aria-label="Back"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}
                  
                  <button
                    onClick={handleNext}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/30 flex items-center gap-1 cursor-none"
                  >
                    {currentStepIdx === steps.length - 1 ? "Finish" : "Next"}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

interface TourLauncherProps {
  onStartTour: () => void;
}

export function TourLauncher({ onStartTour }: TourLauncherProps) {
  return (
    <motion.button
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onStartTour}
      className="fixed bottom-6 right-6 z-30 p-3 rounded-full bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-blue-500/30 backdrop-blur-md shadow-2xl text-slate-400 hover:text-blue-400 transition-all flex items-center gap-2 cursor-none"
      title="Start Interactive Tutorial"
    >
      <HelpCircle className="w-5 h-5" />
      <span className="text-xs font-bold uppercase tracking-wider pr-1 hidden sm:inline">Guide</span>
    </motion.button>
  );
}
