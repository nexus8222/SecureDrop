import React, { useState, useEffect } from 'react';
import {
  Image as ImageIcon,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Film,
  Music,
  Download,
} from 'lucide-react';
import { api } from '../api';
import { ShareItem } from '../types';

export const MediaGalleryTerminal: React.FC = () => {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Gallery Mode: 'images' | 'audio' | 'video'
  const [activeMediaTab, setActiveMediaTab] = useState<'images' | 'audio' | 'video'>('images');
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);

  useEffect(() => {
    api.listMyShares().then((res) => {
      setShares(res.shares || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Filter media files across shares
  const mediaItems: { shareToken: string; fileId: string; name: string; mime: string; size: number }[] = [];
  shares.forEach((s) => {
    s.files?.forEach((f) => {
      mediaItems.push({
        shareToken: s.token,
        fileId: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
      });
    });
  });

  const imageItems = mediaItems.filter((m) => m.mime.startsWith('image/'));
  const audioItems = mediaItems.filter((m) => m.mime.startsWith('audio/'));
  const videoItems = mediaItems.filter((m) => m.mime.startsWith('video/'));

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshowPlaying || imageItems.length === 0) return;
    const timer = setInterval(() => {
      setSlideshowIndex((prev) => (prev + 1) % imageItems.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [slideshowPlaying, imageItems.length]);

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg">Media & RFC 7233 Streaming Gallery</h2>
            <p className="text-xs text-surface-500">
              Low-latency byte-range media streaming, image slideshow, and continuous audio playlist.
            </p>
          </div>

          <div className="flex gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-lg text-xs font-medium">
            <button
              onClick={() => setActiveMediaTab('images')}
              className={`px-3 py-1 rounded flex items-center gap-1.5 ${
                activeMediaTab === 'images'
                  ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                  : 'text-surface-500 hover:text-surface-900'
              }`}
            >
              <ImageIcon size={13} /> Images ({imageItems.length})
            </button>
            <button
              onClick={() => setActiveMediaTab('audio')}
              className={`px-3 py-1 rounded flex items-center gap-1.5 ${
                activeMediaTab === 'audio'
                  ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                  : 'text-surface-500 hover:text-surface-900'
              }`}
            >
              <Music size={13} /> Audio ({audioItems.length})
            </button>
            <button
              onClick={() => setActiveMediaTab('video')}
              className={`px-3 py-1 rounded flex items-center gap-1.5 ${
                activeMediaTab === 'video'
                  ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                  : 'text-surface-500 hover:text-surface-900'
              }`}
            >
              <Film size={13} /> Videos ({videoItems.length})
            </button>
          </div>
        </div>

        {/* Tab 1: Image Slideshow */}
        {activeMediaTab === 'images' && (
          <div className="space-y-4">
            {imageItems.length === 0 ? (
              <div className="py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl text-center text-xs text-surface-500">
                No image files uploaded in your shares yet.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative aspect-video max-h-[460px] bg-black/90 rounded-2xl overflow-hidden flex items-center justify-center border border-surface-200 dark:border-surface-800">
                  <img
                    src={`/api/shares/${imageItems[slideshowIndex].shareToken}/files/${imageItems[slideshowIndex].fileId}/stream`}
                    alt={imageItems[slideshowIndex].name}
                    className="max-h-full max-w-full object-contain transition-opacity duration-300"
                  />

                  {/* Overlay Controls */}
                  <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-white text-xs">
                    <span className="font-mono truncate max-w-[200px]">
                      {imageItems[slideshowIndex].name} ({slideshowIndex + 1}/{imageItems.length})
                    </span>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          setSlideshowIndex(
                            (slideshowIndex - 1 + imageItems.length) % imageItems.length
                          )
                        }
                        className="p-1.5 rounded-full bg-white/20 hover:bg-white/30"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        onClick={() => setSlideshowPlaying(!slideshowPlaying)}
                        className="p-2 rounded-full bg-emerald-500 text-black font-bold hover:bg-emerald-400"
                      >
                        {slideshowPlaying ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button
                        onClick={() =>
                          setSlideshowIndex((slideshowIndex + 1) % imageItems.length)
                        }
                        className="p-1.5 rounded-full bg-white/20 hover:bg-white/30"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Thumbnails row */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {imageItems.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSlideshowIndex(idx)}
                      className={`relative w-20 h-14 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all ${
                        slideshowIndex === idx ? 'border-emerald-500 scale-105' : 'border-transparent opacity-60'
                      }`}
                    >
                      <img
                        src={`/api/shares/${img.shareToken}/files/${img.fileId}/stream`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Audio Playlist */}
        {activeMediaTab === 'audio' && (
          <div className="space-y-4">
            {audioItems.length === 0 ? (
              <div className="py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl text-center text-xs text-surface-500">
                No audio tracks uploaded in your shares yet.
              </div>
            ) : (
              <div className="space-y-2">
                {audioItems.map((track, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Music size={16} className="text-emerald-500" />
                      <span className="font-medium text-xs truncate">{track.name}</span>
                    </div>

                    <audio
                      controls
                      preload="metadata"
                      src={`/api/shares/${track.shareToken}/files/${track.fileId}/stream`}
                      className="h-8 max-w-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Video Player */}
        {activeMediaTab === 'video' && (
          <div className="space-y-4">
            {videoItems.length === 0 ? (
              <div className="py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl text-center text-xs text-surface-500">
                No video files uploaded in your shares yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {videoItems.map((vid, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 overflow-hidden space-y-2 p-3"
                  >
                    <video
                      controls
                      preload="metadata"
                      src={`/api/shares/${vid.shareToken}/files/${vid.fileId}/stream`}
                      className="w-full aspect-video bg-black rounded-lg"
                    />
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold truncate">{vid.name}</span>
                      <a
                        href={`/api/shares/${vid.shareToken}/files/${vid.fileId}/stream`}
                        download={vid.name}
                        className="text-emerald-600 dark:text-emerald-400 font-medium"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
