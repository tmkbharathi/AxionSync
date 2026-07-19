"use client";

import { useRef, useEffect, useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Trash2, Loader2, UploadCloud, Cloud } from "lucide-react";
import { FileMeta } from "./types";
import { FileItem } from "./FileItem";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export const FileManagerPanel = memo(({ 
  files, 
  uploading, 
  uploadProgress, 
  activeTab, 
  isFilePanelCollapsed,
  processFiles,
  handleDownloadFile,
  handleDeleteFile,
  setIsFilePanelCollapsed,
  isAdminSession
}: { 
  files: FileMeta[], 
  uploading: boolean, 
  uploadProgress: number,
  activeTab: string,
  isFilePanelCollapsed: boolean,
  processFiles: (files: File[]) => void,
  handleDownloadFile: (f: FileMeta) => void,
  handleDeleteFile: (f: FileMeta) => void,
  setIsFilePanelCollapsed: (v: boolean) => void,
  isAdminSession: boolean
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  const deleteModalRef = useFocusTrap(showDeleteModal, () => setShowDeleteModal(false));

  // Cleanup selectedIds when files change (e.g. on delete)
  useEffect(() => {
    const validIds = new Set(files.map(f => f.id));
    let changed = false;
    const newSet = new Set<string>();
    selectedIds.forEach(id => {
      if (validIds.has(id)) newSet.add(id);
      else changed = true;
    });
    if (changed) setSelectedIds(newSet);
  }, [files, selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === files.length && files.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(files.map(f => f.id)));
  }, [files, selectedIds.size]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowDeleteModal(true);
  }, [selectedIds]);

  const confirmDeleteSelected = useCallback(async () => {
    const filesToDelete = files.filter(f => selectedIds.has(f.id));
    setShowDeleteModal(false);
    setSelectedIds(new Set()); // Clear selection immediately
    
    // Stagger deletion to allow smooth exit animations
    for (const f of filesToDelete) {
      handleDeleteFile(f);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }, [selectedIds, files, handleDeleteFile]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    processFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  }, [processFiles]);

  return (
    <div className={`h-full bg-slate-900/20 flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${activeTab === 'files' ? 'block' : 'hidden md:flex'} ${isFilePanelCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-full md:w-2/5 lg:w-1/3 opacity-100'}`}>
      <div className="p-4 md:p-6 border-b border-slate-800/60">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-200">Files</h2>
            {files.length > 0 && (
              <button 
                onClick={handleSelectAll}
                className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-200 text-sm transition-colors group/all"
              >
                <div className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-all duration-200 ${selectedIds.size === files.length && files.length > 0 ? 'bg-blue-500 border-blue-500 scale-100 shadow-sm shadow-blue-500/20' : 'bg-slate-900/50 border-slate-600 group-hover/all:border-blue-400 scale-95 group-hover/all:scale-100'}`}>
                  <Check className={`w-3 h-3 text-white transition-opacity duration-200 ${selectedIds.size === files.length && files.length > 0 ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                </div>
                <span className="font-medium">All</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button 
                onClick={handleDeleteSelected}
                className="flex items-center justify-center h-[24px] px-2 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-full transition-colors"
                title="Delete Selected"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <span className="text-xs text-slate-400 px-2.5 bg-slate-800 rounded-full flex items-center h-[24px]">{files.length} items</span>
          </div>
        </div>
        <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
        <div id="tour-files" onDrop={onDrop} onDragOver={e => { e.preventDefault(); setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)} className="relative">
          <div 
            onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
            className={`w-full h-28 border-2 border-dashed ${isDragOver ? "border-blue-500 bg-blue-500/10 text-blue-400" : "border-slate-700/80 text-slate-400"} rounded-xl flex flex-col items-center justify-center gap-2 transition-all overflow-hidden relative group ${uploading ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:bg-slate-800/30 hover:border-blue-500/50 hover:text-blue-400'}`}
            role="button"
            tabIndex={0}
          >
            {uploading ? (
              <div className="absolute inset-0 bg-slate-800/80 flex flex-col items-center justify-center backdrop-blur-sm z-10">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400 mb-2" />
                <div 
                  className="rounded-full" 
                  style={{ 
                    width: '70%', 
                    height: '8px', 
                    background: `linear-gradient(to right, #3b82f6 ${uploadProgress}%, #334155 ${uploadProgress}%)` 
                  }}
                />
                <span className="text-xs mt-2 font-medium text-slate-300">{uploadProgress}%</span>
              </div>
            ) : (
              <>
                <div className="p-3 bg-slate-800 rounded-full group-hover:scale-110 transition-transform"><UploadCloud className="w-5 h-5 text-slate-300" /></div>
                <span className="text-sm font-medium">Click or Drag to Upload (Max {isAdminSession ? "1GB" : "50MB"})</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
        {files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-60">
            <Cloud className="w-12 h-12 mb-3 grayscale" /><p className="text-sm">No files uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {files.map((f) => (
                <FileItem 
                  key={f.id} 
                  file={f} 
                  handleDownload={handleDownloadFile} 
                  handleDelete={handleDeleteFile} 
                  isSelected={selectedIds.has(f.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete Selected Files Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDeleteModal(false)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg"
            />
            <motion.div 
              ref={deleteModalRef}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center mb-6 border border-rose-500/20">
                  <Trash2 className="w-8 h-8 text-rose-500" />
                </div>
                
                <h3 className="text-2xl font-bold text-white mb-3">Delete Selected Files?</h3>
                <p className="text-slate-400 mb-8 leading-relaxed">
                  You are about to delete <span className="text-rose-400 font-semibold">{selectedIds.size} file{selectedIds.size === 1 ? '' : 's'}</span> for <span className="text-white font-semibold">everyone</span> in this room. This action cannot be undone.
                </p>
                
                <div className="flex flex-col gap-3">
                  <button
                    onClick={confirmDeleteSelected}
                    className="w-full py-4 px-6 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-rose-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-5 h-5" />
                    Delete {selectedIds.size} File{selectedIds.size === 1 ? '' : 's'}
                  </button>
                  
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    className="w-full py-4 px-6 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-2xl transition-all active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
});

FileManagerPanel.displayName = "FileManagerPanel";
