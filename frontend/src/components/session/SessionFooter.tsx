"use client";

import { memo } from "react";
import { siteConfig } from "@/config/site";

export const SessionFooter = memo(({ isPro }: { isPro?: boolean }) => {
  return (
    <footer className="text-[10px] md:text-xs text-slate-500 text-center py-2 bg-slate-950 z-10 border-t border-slate-900 flex justify-center items-center gap-4">
      <span>
        {isPro 
          ? "Data auto-destructs after 1 year of inactivity." 
          : "Data auto-destructs after 24 hours of inactivity."}
      </span>
      <span className="text-slate-700">|</span>
      <span className="font-medium text-slate-600">Beta v{siteConfig.version}</span>
    </footer>
  );
});

SessionFooter.displayName = "SessionFooter";
