"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { getWebGLCapabilities } from "@/utils/performance";

interface PerformanceContextType {
  isStaticBackground: boolean;
  disableCustomCursor: boolean;
  detectedLowSpec: boolean;
  setStaticBackground: (val: boolean) => void;
  setDisableCustomCursor: (val: boolean) => void;
}

const PerformanceContext = createContext<PerformanceContextType | undefined>(undefined);

export function PerformanceProvider({ children }: { children: React.ReactNode }) {
  const [isStaticBackground, setIsStaticBackgroundState] = useState(false);
  const [disableCustomCursor, setDisableCustomCursorState] = useState(false);
  const [detectedLowSpec, setDetectedLowSpec] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Only run on client
    const caps = getWebGLCapabilities();
    const isLow = !caps.supported || !caps.hardwareAccelerated;
    setDetectedLowSpec(isLow);

    console.log("[Performance Diagnostics]", {
      webglSupported: caps.supported,
      hardwareAccelerated: caps.hardwareAccelerated,
      renderer: caps.renderer,
      isLowSpecDefault: isLow,
      savedStaticBg: localStorage.getItem("syncosync:static_background"),
      savedDisableCursor: localStorage.getItem("syncosync:disable_cursor")
    });

    // Read manual overrides from localStorage
    const savedStaticBg = localStorage.getItem("syncosync:static_background");
    const savedDisableCursor = localStorage.getItem("syncosync:disable_cursor");

    if (savedStaticBg !== null) {
      setIsStaticBackgroundState(savedStaticBg === "true");
    } else {
      // Default to static background if low-spec
      setIsStaticBackgroundState(isLow);
    }

    if (savedDisableCursor !== null) {
      setDisableCustomCursorState(savedDisableCursor === "true");
    } else {
      // Default to disabling custom cursor if low-spec
      setDisableCustomCursorState(isLow);
    }

    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    if (disableCustomCursor) {
      document.documentElement.classList.add("no-custom-cursor");
    } else {
      document.documentElement.classList.remove("no-custom-cursor");
    }
  }, [disableCustomCursor, isInitialized]);

  const setStaticBackground = (val: boolean) => {
    setIsStaticBackgroundState(val);
    localStorage.setItem("syncosync:static_background", val ? "true" : "false");
  };

  const setDisableCustomCursor = (val: boolean) => {
    setDisableCustomCursorState(val);
    localStorage.setItem("syncosync:disable_cursor", val ? "true" : "false");
  };

  return (
    <PerformanceContext.Provider
      value={{
        isStaticBackground,
        disableCustomCursor,
        detectedLowSpec,
        setStaticBackground,
        setDisableCustomCursor,
      }}
    >
      {/* Prevent flash of standard styling before checking storage */}
      {isInitialized ? children : <div className="fixed inset-0 bg-slate-950" />}
    </PerformanceContext.Provider>
  );
}

export function usePerformance() {
  const context = useContext(PerformanceContext);
  if (context === undefined) {
    throw new Error("usePerformance must be used within a PerformanceProvider");
  }
  return context;
}
