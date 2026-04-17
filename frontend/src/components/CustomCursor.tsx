"use client";

import React, { useEffect, useState } from "react";
import { motion, useSpring, useMotionValue } from "framer-motion";

export default function CustomCursor() {
  const [hasFinePointer, setHasFinePointer] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isHoveringInput, setIsHoveringInput] = useState(false);

  // Raw mouse coordinates
  const mouseX = useMotionValue(-100);
  const mouseY = useMotionValue(-100);

  // Smooth springs for the outer circle
  const circleX = useSpring(mouseX, { damping: 30, stiffness: 200 });
  const circleY = useSpring(mouseY, { damping: 30, stiffness: 200 });

  // Even smoother springs for the inner dot to make it "follow" gracefully
  const dotX = useSpring(mouseX, { damping: 40, stiffness: 150 });
  const dotY = useSpring(mouseY, { damping: 40, stiffness: 150 });
  useEffect(() => {
    // Detect if the device has a fine pointer (mouse/trackpad)
    const mq = window.matchMedia("(pointer: fine)");
    setHasFinePointer(mq.matches);

    const handler = (e: MediaQueryListEvent) => setHasFinePointer(e.matches);
    mq.addEventListener("change", handler);

    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!hasFinePointer) return;

    const moveMouse = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
      
      if (!isVisible) setIsVisible(true);

      // Real-time target detection: robust for dynamic pages and navigation
      const target = e.target as HTMLElement;
      if (target) {
        // 1. Check if we're over a text input or textarea
        const isInput = 
          target.tagName === "INPUT" || 
          target.tagName === "TEXTAREA" || 
          target.closest("input") || 
          target.closest("textarea");
        
        setIsHoveringInput(!!isInput);

        // 2. Check if we're over a clickable element (only if not an input)
        if (!isInput) {
          const isClickable = 
            target.tagName === "A" || 
            target.tagName === "BUTTON" || 
            target.getAttribute("role") === "button" || 
            target.closest("a") || 
            target.closest("button");
          
          setIsHovered(!!isClickable);
        } else {
          setIsHovered(false);
        }
      }
    };

    const handleMouseLeave = () => setIsVisible(false);
    const handleMouseEnter = () => setIsVisible(true);

    window.addEventListener("mousemove", moveMouse);
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mouseenter", handleMouseEnter);

    return () => {
      window.removeEventListener("mousemove", moveMouse);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mouseenter", handleMouseEnter);
    };
  }, [mouseX, mouseY, isVisible]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !hasFinePointer) return null;

  return (
    <>
      {/* Outer Circle: Follows with moderate smoothness */}
      <motion.div
        style={{
          x: circleX,
          y: circleY,
        }}
        animate={{
          scale: isHovered ? 1.5 : 1,
          opacity: (isVisible && !isHoveringInput) ? 1 : 0,
          borderColor: isHovered ? "rgba(59, 130, 246, 0.9)" : "rgba(59, 130, 246, 0.6)",
        }}
        className="fixed top-0 left-0 pointer-events-none z-[9999] w-8 h-8 rounded-full border-2 border-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.3)] mix-blend-screen -ml-4 -mt-4 transition-colors duration-300"
      />
      
      {/* Inner Dot: Follows with extra smoothness (lag) */}
      <motion.div
        style={{
          x: dotX,
          y: dotY,
        }}
        animate={{
          scale: isHovered ? 0.4 : 1,
          opacity: (isVisible && !isHoveringInput) ? 1 : 0,
          backgroundColor: isHovered ? "rgb(96, 165, 250)" : "rgb(59, 130, 246)",
        }}
        className="fixed top-0 left-0 pointer-events-none z-[9999] w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)] -ml-1 -mt-1 transition-colors duration-300"
      />
    </>
  );
}
