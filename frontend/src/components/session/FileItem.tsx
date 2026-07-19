"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Check, Download, Trash2, Globe } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { FileMeta } from "./types";
import { formatSize } from "@/utils/format";

export const FileItem = memo(({ 
  file, 
  handleDownload, 
  handleDelete,
  isSelected,
  onToggleSelect
}: { 
  file: FileMeta, 
  handleDownload: (f: FileMeta) => void, 
  handleDelete: (f: FileMeta) => void,
  isSelected: boolean,
  onToggleSelect: (id: string) => void
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-slate-800/40 border p-3 rounded-xl flex items-center justify-between group transition-colors ${isSelected ? 'border-blue-500/50 bg-blue-500/5' : 'border-slate-700/50 hover:bg-slate-800/80'}`}
    >
      <div className="flex items-center gap-3 overflow-hidden pr-3">
        <button 
          onClick={() => onToggleSelect(file.id)}
          className="shrink-0 p-1 -ml-1 flex items-center justify-center group/check"
          title={isSelected ? "Deselect" : "Select"}
        >
          <div className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-all duration-200 ${isSelected ? 'bg-blue-500 border-blue-500 scale-100 shadow-sm shadow-blue-500/20' : 'bg-slate-900/50 border-slate-600 group-hover/check:border-blue-400 scale-95 group-hover/check:scale-100'}`}>
            <Check className={`w-3 h-3 text-white transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
          </div>
        </button>
        {file.previewUrl ? (
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 shrink-0">
             <img src={file.previewUrl} alt={file.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
             <Globe className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate" title={file.name}>{file.name}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
            <span>{formatSize(file.size)}</span>
            <span>•</span>
            <span>{formatDistanceToNow(new Date(file.uploadedAt), { addSuffix: true })}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={() => handleDownload(file)}
          className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-md transition-colors"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </button>
        <button 
          onClick={() => handleDelete(file)}
          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
});

FileItem.displayName = "FileItem";
