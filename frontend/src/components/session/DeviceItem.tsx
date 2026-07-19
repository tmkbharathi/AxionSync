"use client";

import { memo } from "react";
import { Smartphone, Monitor } from "lucide-react";
import { ActiveDevice } from "./types";

export const DeviceItem = memo(({ 
  device, 
  isCurrent 
}: { 
  device: ActiveDevice, 
  isCurrent: boolean 
}) => {
  return (
    <div className="flex items-center gap-4 p-3 bg-slate-800/40 rounded-xl border border-slate-700/50">
      <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-blue-400 border border-slate-700">
        {device.info.platform === 'mobile' ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold truncate">{isCurrent ? "This Device" : device.info.name}</p>
          {isCurrent && (
             <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded uppercase">You</span>
          )}
        </div>
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{device.info.browser} • {device.info.platform}</p>
      </div>
    </div>
  );
});

DeviceItem.displayName = "DeviceItem";
