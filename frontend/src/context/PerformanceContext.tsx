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
  const [detectedLowSpec] = useState(() => {
    if (typeof window === "undefined") return false;
    const caps = getWebGLCapabilities();
    return !caps.supported || !caps.hardwareAccelerated;
  });

  const [isStaticBackground, setIsStaticBackgroundState] = useState(() => {
    if (typeof window === "undefined") return false;
    const savedStaticBg = localStorage.getItem("syncosync:static_background");
    if (savedStaticBg !== null) return savedStaticBg === "true";
    const caps = getWebGLCapabilities();
    return !caps.supported || !caps.hardwareAccelerated;
  });

  const [disableCustomCursor, setDisableCustomCursorState] = useState(() => {
    if (typeof window === "undefined") return true;
    const savedDisableCursor = localStorage.getItem("syncosync:disable_cursor");
    if (savedDisableCursor !== null) return savedDisableCursor === "true";
    return true;
  });

  useEffect(() => {
    // Diagnostic logging
    const caps = getWebGLCapabilities();
    console.log("[Performance Diagnostics]", {
      webglSupported: caps.supported,
      hardwareAccelerated: caps.hardwareAccelerated,
      renderer: caps.renderer,
      isLowSpecDefault: detectedLowSpec,
      savedStaticBg: localStorage.getItem("syncosync:static_background"),
      savedDisableCursor: localStorage.getItem("syncosync:disable_cursor")
    });
  }, [detectedLowSpec]);

  useEffect(() => {
    if (disableCustomCursor) {
      document.documentElement.classList.add("no-custom-cursor");
    } else {
      document.documentElement.classList.remove("no-custom-cursor");
    }
  }, [disableCustomCursor]);

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
      {children}
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
