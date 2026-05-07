"use client";

import React, { useState } from 'react';
import { Trash2, Share, ChevronLeft, Check, CheckSquare, Square, Search, User } from 'lucide-react';

// Using unsplash random landscape/nature images to simulate a photo gallery
const MOCK_PHOTOS = Array.from({ length: 30 }).map((_, i) => ({
  id: i,
  url: `https://picsum.photos/seed/${i + 500}/400/400`
}));

export default function PhotosApp() {
  const [photos, setPhotos] = useState(MOCK_PHOTOS);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedIds(new Set());
  };

  const toggleSelectPhoto = (id: number) => {
    if (!isSelectionMode) return;
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === photos.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      setSelectedIds(new Set(photos.map(p => p.id)));
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    const confirmDelete = window.confirm(`Are you sure you want to delete ${selectedIds.size} item(s)?`);
    if (confirmDelete) {
      setPhotos(photos.filter(p => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
      setIsSelectionMode(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white sm:max-w-md sm:mx-auto sm:border-x sm:border-gray-800 relative select-none">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-black/85 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b border-gray-900 transition-all duration-300">
        {!isSelectionMode ? (
          <>
            <div className="flex items-center text-blue-500 font-medium text-[17px] cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity">
              <ChevronLeft className="w-[22px] h-[22px] -ml-2 mr-0.5" />
              <span>Albums</span>
            </div>
            
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-blue-500 font-medium text-[15px]">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 accent-blue-500 cursor-pointer" 
                  checked={selectedIds.size === photos.length && photos.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setIsSelectionMode(true);
                      setSelectedIds(new Set(photos.map(p => p.id)));
                    } else {
                      setSelectedIds(new Set());
                      setIsSelectionMode(false);
                    }
                  }}
                />
                Select All
              </label>

              <button 
                onClick={toggleSelectionMode}
                className="text-blue-500 font-medium text-[17px] bg-transparent border-none outline-none cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity"
              >
                Select
              </button>
            </div>
          </>
        ) : (
          <>
            <button 
              onClick={toggleSelectionMode}
              className="text-blue-500 font-medium text-[17px] bg-transparent border-none outline-none cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity"
            >
              Cancel
            </button>
            <div className="flex flex-col items-center">
              <span className="font-semibold text-base leading-tight text-white">Select Items</span>
              <span className="text-[11px] text-gray-400 font-medium tracking-wide">
                {selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'Select Items'}
              </span>
            </div>
            
            <label className="flex items-center gap-2 cursor-pointer text-blue-500 font-medium text-[15px]">
              <input 
                type="checkbox" 
                className="w-5 h-5 accent-blue-500 cursor-pointer" 
                checked={selectedIds.size === photos.length && photos.length > 0}
                onChange={selectAll}
              />
              All
            </label>
          </>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 pb-24">
        {!isSelectionMode && (
          <div className="px-4 pt-6 pb-2">
            <h1 className="text-[34px] font-bold tracking-tight text-white leading-none">All Photos</h1>
          </div>
        )}
        
        <div className="grid grid-cols-3 gap-0.5 mt-1">
          {photos.map(photo => {
            const isSelected = selectedIds.has(photo.id);
            return (
              <div 
                key={photo.id} 
                className="relative aspect-square bg-gray-900 group"
                onClick={() => toggleSelectPhoto(photo.id)}
              >
                <div className={`w-full h-full transition-all duration-300 ease-out ${
                  isSelectionMode && isSelected ? 'scale-90 rounded-sm overflow-hidden' : ''
                }`}>
                  <img
                    src={photo.url}
                    alt={`Photo ${photo.id}`}
                    className="w-full h-full object-cover transition-opacity duration-300"
                    loading="lazy"
                  />
                  {/* Overlay for selected state to make the blue checkmark pop out */}
                  {isSelectionMode && isSelected && (
                    <div className="absolute inset-0 bg-white/20 pointer-events-none transition-opacity duration-300" />
                  )}
                </div>
                
                {/* Selection Circle/Checkmark (iOS Style) */}
                {isSelectionMode && (
                  <div className="absolute bottom-1.5 right-1.5 z-20 pointer-events-none transition-transform duration-200">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${
                      isSelected 
                        ? 'bg-blue-500 border-blue-500 scale-100' 
                        : 'bg-black/20 border-white/80 scale-90'
                    } backdrop-blur-sm shadow-sm`}>
                      {isSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3.5} />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {photos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <p className="text-xl font-semibold mb-2">No Photos</p>
            <p className="text-sm">You can capture photos or save images.</p>
          </div>
        )}
      </div>

      {/* Bottom Navigation (Standard) */}
      {!isSelectionMode && (
        <div className="fixed bottom-0 left-0 right-0 sm:max-w-md sm:mx-auto bg-black/90 backdrop-blur-xl border-t border-gray-900 px-6 py-2 pb-6 flex justify-between items-center z-30 transition-all duration-300">
          <div className="flex flex-col items-center text-blue-500 cursor-pointer">
            <img src="/library-icon.svg" alt="" className="w-7 h-7 mb-0.5 opacity-0" />
            <div className="w-6 h-6 bg-blue-500 rounded-sm mb-1" style={{ maskImage: "url('data:image/svg+xml;utf8,<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/></svg>')", WebkitMaskImage: "url('data:image/svg+xml;utf8,<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/></svg>')", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }}></div>
            <span className="text-[10px] font-medium tracking-wide">Library</span>
          </div>
          <div className="flex flex-col items-center text-gray-500 cursor-pointer hover:text-gray-400 transition-colors">
             <Search className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium tracking-wide">Search</span>
          </div>
          <div className="flex flex-col items-center text-gray-500 cursor-pointer hover:text-gray-400 transition-colors">
            <User className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium tracking-wide">Albums</span>
          </div>
        </div>
      )}

      {/* Selection Bottom Toolbar (Appears in Selection Mode) */}
      {isSelectionMode && (
        <div className="fixed bottom-0 left-0 right-0 sm:max-w-md sm:mx-auto bg-gray-950/95 backdrop-blur-2xl border-t border-gray-900 px-5 py-3 pb-8 flex justify-between items-center z-40 animate-in slide-in-from-bottom-full duration-300">
          <button 
            className="text-blue-500 disabled:text-gray-600 disabled:opacity-50 transition-colors duration-200" 
            disabled={selectedIds.size === 0}
            aria-label="Share"
          >
            <Share className="w-[26px] h-[26px]" strokeWidth={1.5} />
          </button>
          
          <div className="text-xs text-gray-400 font-medium">
            {selectedIds.size > 0 ? 'Ready' : 'Select items'}
          </div>

          <button 
            className="text-blue-500 disabled:text-gray-600 disabled:opacity-50 transition-colors duration-200" 
            disabled={selectedIds.size === 0}
            onClick={deleteSelected}
            aria-label="Delete"
          >
            <Trash2 className="w-[26px] h-[26px]" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
