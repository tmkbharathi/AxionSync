"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sliders, X, Cpu, Sparkles, Zap, AlertTriangle, Monitor } from "lucide-react";
import { usePerformance } from "@/context/PerformanceContext";
import { getWebGLCapabilities } from "@/utils/performance";

export default function PerformanceSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    isStaticBackground,
    disableCustomCursor,
    detectedLowSpec,
    setStaticBackground,
    setDisableCustomCursor,
  } = usePerformance();

  const [gpuName, setGpuName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const caps = getWebGLCapabilities();
    if (caps.renderer) {
      // Clean up renderer string for shorter display
      const match = caps.renderer.match(/ANGLE \((.*)\)/) || [null, caps.renderer];
      setGpuName(match[1] || caps.renderer);
    }
  }, []);

  // Close panel on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return null; // Hidden by user request for now

  return (
    <div className="fixed bottom-6 left-6 z-50">
      {/* Trigger Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center p-3 rounded-full bg-slate-900/60 backdrop-blur-md border border-slate-800/80 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30 shadow-xl transition-all"
        aria-label="Performance settings"
      >
        <Sliders className="w-5 h-5" />
      </motion.button>

      {/* Settings Popover Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.9, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 15 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute bottom-14 left-0 w-80 bg-slate-950/90 backdrop-blur-xl border border-slate-800/80 p-5 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">Performance</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Device Info & Status */}
            <div className="mb-5 p-3 rounded-xl bg-slate-900/40 border border-slate-800/40 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-slate-500 font-medium">Device Profile:</span>
                {detectedLowSpec ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold text-[10px]">
                    <AlertTriangle className="w-2.5 h-2.5" /> Low-Spec Mode
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold text-[10px]">
                    <Zap className="w-2.5 h-2.5 fill-emerald-500/10" /> Accelerated GPU
                  </span>
                )}
              </div>
              {gpuName && (
                <div className="text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap" title={gpuName}>
                  <span className="text-slate-500 font-medium">Renderer:</span> {gpuName}
                </div>
              )}
            </div>

            {/* Options list */}
            <div className="space-y-4">
              {/* Option 1: 3D Background */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 max-w-[70%]">
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    Animated 3D Stars
                  </span>
                  <span className="text-[10px] text-slate-500 leading-normal">
                    Interactive space background particle animation.
                  </span>
                </div>
                <button
                  onClick={() => setStaticBackground(!isStaticBackground)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    !isStaticBackground ? "bg-cyan-500" : "bg-slate-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      !isStaticBackground ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Option 2: Custom Cursor */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5 max-w-[70%]">
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-blue-400" />
                    Custom Mouse Cursor
                  </span>
                  <span className="text-[10px] text-slate-500 leading-normal">
                    Magnetized, high-precision custom pointer effect.
                  </span>
                </div>
                <button
                  onClick={() => setDisableCustomCursor(!disableCustomCursor)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    !disableCustomCursor ? "bg-cyan-500" : "bg-slate-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      !disableCustomCursor ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Note */}
            <p className="mt-4 pt-3 border-t border-slate-900 text-[9px] text-slate-600 text-center font-medium">
              We default these options based on your hardware capabilities to prevent lag.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
