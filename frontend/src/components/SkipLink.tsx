"use client";

import React from "react";
import { usePathname } from "next/navigation";

export default function SkipLink() {
  const pathname = usePathname();
  
  // Don't show skip link on the home page
  if (pathname === "/") return null;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = document.getElementById("main-content");
    if (target) {
      // Focus without scrolling the page
      target.focus({ preventScroll: true });
      
      // If it's an input or textarea, select all text for immediate replacement/editing
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.select();
      }
    }
  };

  return (
    <a 
      href="#main-content" 
      onClick={handleClick}
      className="skip-link sr-only focus:not-sr-only"
    >
      Skip to main content
    </a>
  );
}
