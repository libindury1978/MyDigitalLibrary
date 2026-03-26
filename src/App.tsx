import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";

const categories = [
  { label: "视频", icon: "🎬" },
  { label: "音频", icon: "🎧" },
  { label: "图片", icon: "🖼️" },
  { label: "文章", icon: "📝" },
];
const cardHeights = [220, 280, 320, 360, 260, 300];

type MediaItem = {
  id: string;
  category: string;
  title: string;
  path: string;
  extension: string;
};

function mergeById(base: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const map = new Map<string, MediaItem>();
  for (const item of base) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

const demoCards = Array.from({ length: 24 }, (_, index) => {
  const category = categories[index % categories.length].label;
  return {
    id: `demo-${index + 1}`,
    category,
    title: `${category}作品 ${index + 1}`,
    path: "",
    extension: "",
  };
});

const STORAGE_KEY = "my-digital-library:v1";
// 缩略图生成前不提供任何 poster（只靠容器背景黑色）。

type ShareTemplate = {
  hashtags: string;
  link: string;
};

function VideoInlinePlayer(props: {
  src: string;
  height: string;
  cardId: string;
  poster?: string;
  onReady: () => void;
  onError: () => void;
  onThumbReady?: (cardId: string, dataUrl: string) => void;
}) {
  const { src, height, cardId, poster, onReady, onError, onThumbReady } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const lastNonZeroVolumeRef = useRef(0.8);
  const thumbDoneRef = useRef(false);
  const thumbTimesRef = useRef<number[]>([]);
  const thumbAttemptIndexRef = useRef(0);
  const bestThumbRef = useRef<{ dataUrl: string; score: number } | null>(null);
  const thumbTargetTimeRef = useRef<number>(0);

  const computeThumbTimes = (d: number) => {
    // Capture multiple candidates, then pick the best one.
    // This avoids cases where the first acceptable frame is still the blue stage.
    const safeEnd = Math.max(0.2, d - 0.05);
    if (!d || !Number.isFinite(d) || d <= 0) return [1.5, 2.5, 3.5];

    const start = safeEnd >= 2.2 ? 2.2 : Math.max(0.2, safeEnd * 0.65);
    const step = Math.min(0.9, safeEnd * 0.12);

    const arr: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = start + i * step;
      if (t > 0.05 && t < safeEnd) arr.push(t);
    }

    // Fallback: ensure we have some attempts.
    if (arr.length === 0) return [Math.min(0.8, safeEnd * 0.5), Math.min(1.2, safeEnd * 0.75)];
    return Array.from(new Set(arr)).sort((a, b) => a - b);
  };

  const analyzeFrameStats = (videoEl: HTMLVideoElement) => {
    // Sample a smaller area to keep it fast, but prefer the center region
    // to avoid letterboxing/black bars skewing results.
    const w = videoEl.videoWidth || 640;
    const h = videoEl.videoHeight || 360;
    // Keep this small: used for fast heuristics only.
    const sampleW = Math.min(96, w);
    const sampleH = Math.min(54, h);
    const canvas = document.createElement("canvas");
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return { meanLum: 0, stdLum: 0, rangeLum: 0, edgeDensity: 0, meanR: 0, meanG: 0, meanB: 0 };

    const sx = Math.max(0, Math.floor((w - sampleW) / 2));
    const sy = Math.max(0, Math.floor((h - sampleH) / 2));
    ctx.drawImage(videoEl, sx, sy, sampleW, sampleH, 0, 0, sampleW, sampleH);
    const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
    const data = imageData.data;

    const count = sampleW * sampleH;
    let sum = 0;
    let sumSq = 0;
    let minLum = Number.POSITIVE_INFINITY;
    let maxLum = Number.NEGATIVE_INFINITY;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    // Edge density: average absolute luminance difference between neighbors.
    // Blue/purple placeholder frames tend to be very smooth => low edge density.
    let edgeSum = 0;
    let edgeCount = 0;

    // Precompute luminance for neighbor sampling.
    const lumAt = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      // Relative luminance (approx)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumAt[i] = lum;
      sum += lum;
      sumSq += lum * lum;
      minLum = Math.min(minLum, lum);
      maxLum = Math.max(maxLum, lum);
    }

    const meanLum = sum / Math.max(1, count);
    const variance = Math.max(0, sumSq / Math.max(1, count) - meanLum * meanLum);
    const stdLum = Math.sqrt(variance);
    const rangeLum = maxLum - minLum;
    const meanR = sumR / Math.max(1, count);
    const meanG = sumG / Math.max(1, count);
    const meanB = sumB / Math.max(1, count);

    // Horizontal edges + vertical edges.
    for (let y = 0; y < sampleH - 1; y++) {
      for (let x = 0; x < sampleW - 1; x++) {
        const i = y * sampleW + x;
        const right = y * sampleW + (x + 1);
        const down = (y + 1) * sampleW + x;
        edgeSum += Math.abs(lumAt[i] - lumAt[right]);
        edgeSum += Math.abs(lumAt[i] - lumAt[down]);
        edgeCount += 2;
      }
    }

    const edgeDensity = edgeCount ? edgeSum / edgeCount : 0;

    return { meanLum, stdLum, rangeLum, edgeDensity, meanR, meanG, meanB };
  };

  const tryCaptureAtCurrentFrame = () => {
    if (!onThumbReady) return false;
    const videoEl = videoRef.current;
    if (!videoEl) return false;
    if (videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return false;
    try {
      const stats = analyzeFrameStats(videoEl);
      // Do NOT show any placeholder image.
      // If we accept a frame here, it becomes the poster immediately.
      // So we only reject obvious "not decoded" / "blue stage" frames,
      // and accept most real frames so users don't get stuck on black forever.
      const ACCEPT_LUMINANCE = 6; // 0-255: reject pure black/undecoded
      const BLUE_DOMINANCE_MARGIN = 18; // reject strong blue-dominant frames

      if (stats.meanLum < ACCEPT_LUMINANCE) return false;

      const blueDominant =
        stats.meanB > stats.meanR + BLUE_DOMINANCE_MARGIN && stats.meanB > stats.meanG + BLUE_DOMINANCE_MARGIN;
      if (blueDominant) return false;

      const score =
        stats.edgeDensity * 20 +
        stats.stdLum * 2.5 +
        stats.rangeLum * 0.25 +
        Math.min(stats.meanLum, 80) * 0.05;

      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);

      if (!bestThumbRef.current || score > bestThumbRef.current.score) {
        bestThumbRef.current = { dataUrl, score };
      }
      return true;
    } catch {
      return false;
    }
  };

  const tryNextThumbTime = () => {
    if (thumbDoneRef.current) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const times = thumbTimesRef.current;
    if (!times.length) return;

    const nextIndex = thumbAttemptIndexRef.current + 1;
    if (nextIndex >= times.length) {
      thumbDoneRef.current = true; // stop attempts
      if (onThumbReady && bestThumbRef.current?.dataUrl) {
        onThumbReady(cardId, bestThumbRef.current.dataUrl);
      }
      return;
    }

    thumbAttemptIndexRef.current = nextIndex;
    const nextT = times[nextIndex];
    thumbTargetTimeRef.current = nextT;
    try {
      videoEl.currentTime = nextT;
    } catch {
      // If seeking fails, just mark done to avoid loops.
      thumbDoneRef.current = true;
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTime = () => setCurrentTime(video.currentTime || 0);
    const handleLoadedMetadata = () => {
      const d = video.duration || 0;
      setDuration(Number.isFinite(d) ? d : 0);
      onReady();
      if (!onThumbReady) return;
      if (thumbDoneRef.current) return;
      const times = computeThumbTimes(d);
      thumbTimesRef.current = times;
      thumbAttemptIndexRef.current = 0;
      thumbDoneRef.current = false;
      bestThumbRef.current = null;
      // Skip the very beginning (often a black frame) so we can show
      // the first "real" poster as early as possible.
      const firstT = times[0];
      thumbTargetTimeRef.current = firstT;
      try {
        video.currentTime = firstT;
      } catch {
        // ignore seek errors
      }
    };
    const handleLoadedData = () => {
      if (!onThumbReady) return;
      if (thumbDoneRef.current) return;
      // Only capture after seeking to the target time.
      const target = thumbTargetTimeRef.current;
      const ct = video.currentTime || 0;
      if (Math.abs(ct - target) > 0.25) {
        tryNextThumbTime();
        return;
      }
      tryCaptureAtCurrentFrame();
      tryNextThumbTime();
    };
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleErr = () => onError();

    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("seeked", handleLoadedData);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("error", handleErr);

    return () => {
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("seeked", handleLoadedData);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("error", handleErr);
    };
  }, [cardId, onError, onReady, onThumbReady, src]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      // ignore
    }
  };

  const seekTo = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const safe = Math.max(0, Math.min(value, duration || 0));
    video.currentTime = safe;
    setCurrentTime(safe);
  };

  const toggleMute = () => {
    if (muted) {
      const v = lastNonZeroVolumeRef.current || 0.8;
      setVolume(v);
      setMuted(false);
      return;
    }
    lastNonZeroVolumeRef.current = volume || 0.8;
    setVolume(0);
    setMuted(true);
  };

  return (
    <div
      className="relative bg-black"
      style={{
        height,
      }}
    >
      {/* 只在我们生成出“真实缩略图 poster”后显示。未生成时视频会被隐藏为 0 不会出现蓝紫初始化帧。 */}
      {poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: playing ? 0 : 1, transition: "opacity 180ms ease" }}
        />
      ) : null}
      <video
        ref={videoRef}
        src={src}
        className={`absolute inset-0 h-full w-full bg-black object-cover transition-opacity ${
          playing ? "opacity-100" : "opacity-0"
        }`}
        preload="auto"
        playsInline
        poster={poster}
      />

      {/* 自定义控件：禁用原生 controls（Tauri WebView 下音量图标与进度条易异常） */}
      <div className="absolute inset-0">
        {/* 音量：右上角（图标 + 可拖动滑条） */}
        <div className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded-full bg-black/35 px-2 py-1">
          <button
            type="button"
            className="rounded-full bg-black/0 p-0 text-zinc-100 transition hover:bg-black/30"
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            aria-label="切换静音"
          >
            {muted ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M6.25 6.25H4.5C4.08579 6.25 3.75 6.58579 3.75 7V9C3.75 9.41421 4.08579 9.75 4.5 9.75H6.25L9 12.125V3.875L6.25 6.25Z"
                  fill="currentColor"
                  opacity="0.95"
                />
                <path d="M11 6L14 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M14 6L11 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M6.25 6.25H4.5C4.08579 6.25 3.75 6.58579 3.75 7V9C3.75 9.41421 4.08579 9.75 4.5 9.75H6.25L9 12.125V3.875L6.25 6.25Z"
                  fill="currentColor"
                  opacity="0.95"
                />
                <path
                  d="M10.75 6.25C11.6 7 11.6 9 10.75 9.75"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <path
                  d="M12.25 5C13.5 6.25 13.5 9.75 12.25 11"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              </svg>
            )}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              e.stopPropagation();
              const v = Number(e.target.value);
              if (v <= 0.0001) {
                lastNonZeroVolumeRef.current = lastNonZeroVolumeRef.current || 0.8;
                setVolume(0);
                setMuted(true);
              } else {
                lastNonZeroVolumeRef.current = v;
                setVolume(v);
                setMuted(false);
              }
            }}
            className="video-volume w-20"
            aria-label={`音量-${Math.round((muted ? 0 : volume) * 100)}%`}
          />
        </div>

        {/* 中间播放/暂停按钮（避免覆盖进度条导致无法拖动） */}
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void togglePlay();
            }}
            className="rounded-full bg-black/45 px-4 py-3 text-zinc-100 transition hover:bg-black/60 backdrop-blur"
            aria-label="播放/暂停"
          >
            {playing ? (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="4" width="3.5" height="14" rx="1.25" fill="currentColor" />
                <rect x="12.5" y="4" width="3.5" height="14" rx="1.25" fill="currentColor" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 6.2C8 5.4 9.0 4.98 9.62 5.42L17.05 10.22C17.62 10.61 17.62 11.39 17.05 11.78L9.62 16.58C9.0 17.02 8 16.6 8 15.8V6.2Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>

        {/* 底部进度条（宽度铺满视频卡片） */}
        <div className="absolute bottom-0 left-0 right-0 z-20 pb-2 px-2">
          <div className="rounded-xl bg-black/45 px-3 py-2">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="video-progress flex-1"
                aria-label={`进度-${cardId}`}
              />
            </div>
            <div className="mt-1 text-[10px] text-zinc-200/80">
              {duration ? `${Math.floor(currentTime)}s / ${Math.floor(duration)}s` : "加载中..."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AudioInlinePlayer(props: {
  src: string;
  cardId: string;
  onReady: () => void;
  onError: () => void;
}) {
  const { src, cardId, onReady, onError } = props;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoaded = () => {
      const d = audio.duration || 0;
      setDuration(Number.isFinite(d) ? d : 0);
      onReady();
    };
    const handleTime = () => setCurrentTime(audio.currentTime || 0);
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleErr = () => onError();

    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("timeupdate", handleTime);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleErr);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("timeupdate", handleTime);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleErr);
    };
  }, [onError, onReady, src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {
      // ignore
    }
  };

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const safe = Math.max(0, Math.min(value, duration || 0));
    audio.currentTime = safe;
    setCurrentTime(safe);
  };

  return (
    <div className="relative w-full rounded-lg border border-white/10 bg-black/20 px-3 py-3">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void togglePlay();
          }}
          className="rounded-full bg-white/10 px-3 py-2 text-zinc-100 transition hover:bg-white/15"
          aria-label="播放/暂停音频"
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="6" y="4" width="3.5" height="14" rx="1.25" fill="currentColor" />
              <rect x="12.5" y="4" width="3.5" height="14" rx="1.25" fill="currentColor" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M8 6.2C8 5.4 9.0 4.98 9.62 5.42L17.05 10.22C17.62 10.61 17.62 11.39 17.05 11.78L9.62 16.58C9.0 17.02 8 16.6 8 15.8V6.2Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          className="video-progress flex-1"
          aria-label={`音频进度-${cardId}`}
        />
      </div>

      <div className="mt-2 text-[10px] text-zinc-200/70">
        {duration ? `${Math.floor(currentTime)}s / ${Math.floor(duration)}s` : "加载中..."}
      </div>
    </div>
  );
}

function App() {
  const [activeCategory, setActiveCategory] = useState(categories[0].label);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [libraryPath, setLibraryPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedCard, setSelectedCard] = useState<MediaItem | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<Record<string, boolean>>({});
  const [mediaError, setMediaError] = useState<Record<string, boolean>>({});
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showRemovedPanel, setShowRemovedPanel] = useState(false);
  const [visibleCount, setVisibleCount] = useState(8);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [mediaReady, setMediaReady] = useState<Record<string, boolean>>({});
  const [inViewMediaIds, setInViewMediaIds] = useState<Set<string>>(new Set());
  const mediaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [pinnedRootPaths, setPinnedRootPaths] = useState<string[]>([]);
  const [addedFilePaths, setAddedFilePaths] = useState<string[]>([]);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareTemplate, setShareTemplate] = useState<ShareTemplate>({ hashtags: "", link: "" });
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    card: MediaItem | null;
  }>({ open: false, x: 0, y: 0, card: null });

  const sourceCards =
    items.length > 0
      ? items
      : hydrated && pinnedRootPaths.length === 0 && addedFilePaths.length === 0
        ? demoCards
        : [];

  const filteredCards = useMemo(
    () =>
      sourceCards.filter(
        (card) =>
          !hiddenIds.has(card.id) &&
          card.category === activeCategory &&
          card.title.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [activeCategory, hiddenIds, search, sourceCards],
  );

  const removedCards = useMemo(
    () => sourceCards.filter((card) => hiddenIds.has(card.id)),
    [hiddenIds, sourceCards],
  );
  const isMediaCategory = activeCategory === "视频" || activeCategory === "音频";
  const isCurrentPinned = libraryPath ? pinnedRootPaths.includes(libraryPath) : false;
  const displayedCards = useMemo(
    () => filteredCards.slice(0, visibleCount),
    [filteredCards, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(8);
  }, [activeCategory, search, libraryPath, items.length]);

  const runSearch = () => setSearch(searchDraft);

  useEffect(() => {
    if (filteredCards.length <= 8) return;
    const timer = window.setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + 8, filteredCards.length));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [filteredCards, visibleCount]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => (entry.target as HTMLElement).dataset.mediaId)
          .filter((id): id is string => Boolean(id));
        if (entering.length === 0) return;
        setInViewMediaIds((prev) => {
          const next = new Set(prev);
          for (const id of entering) next.add(id);
          return next;
        });
      },
      {
        root: null,
        rootMargin: "240px 0px",
        threshold: 0.01,
      },
    );

    Object.values(mediaRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [displayedCards, activeCategory, visibleCount]);

  // NOTE: video thumbnails are generated inside VideoInlinePlayer (more reliable in Tauri WebView).

  // Hydrate persisted library state (pinned folders, added files, removed list)
  useEffect(() => {
    const hydrate = async () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setHydrated(true);
          return;
        }

        const parsed = JSON.parse(raw) as {
          pinnedRootPaths?: string[];
          addedFilePaths?: string[];
          hiddenIds?: string[];
          notes?: Record<string, string>;
          shareTemplate?: Partial<ShareTemplate>;
        };

        const pinned = Array.isArray(parsed.pinnedRootPaths) ? parsed.pinnedRootPaths : [];
        const added = Array.isArray(parsed.addedFilePaths) ? parsed.addedFilePaths : [];
        const hidden = Array.isArray(parsed.hiddenIds) ? parsed.hiddenIds : [];
        const savedNotes =
          parsed.notes && typeof parsed.notes === "object" && !Array.isArray(parsed.notes)
            ? parsed.notes
            : {};
        const savedTemplate = parsed.shareTemplate ?? {};

        setPinnedRootPaths(pinned);
        setAddedFilePaths(added);
        setHiddenIds(new Set(hidden));
        setNotes(savedNotes);
        setShareTemplate({
          hashtags: typeof savedTemplate.hashtags === "string" ? savedTemplate.hashtags : "",
          link: typeof savedTemplate.link === "string" ? savedTemplate.link : "",
        });

        setLoading(true);
        setError("");

        let merged: MediaItem[] = [];
        for (const root of pinned) {
          try {
            const data = await invoke<MediaItem[]>("scan_library", { rootPath: root });
            merged = mergeById(merged, data);
          } catch {
            // ignore invalid/missing directories on startup
          }
        }

        if (added.length > 0) {
          try {
            const data = await invoke<MediaItem[]>("add_files", { paths: added });
            merged = mergeById(merged, data);
          } catch {
            // ignore invalid/missing files on startup
          }
        }

        setItems(merged);
        setLibraryPath(pinned[0] ?? "");
      } catch {
        // If localStorage is unavailable or corrupted, just fall back to empty demo state.
        setPinnedRootPaths([]);
        setAddedFilePaths([]);
        setHiddenIds(new Set());
        setItems([]);
      } finally {
        setLoading(false);
        setHydrated(true);
      }
    };

    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist library state
  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload = {
        pinnedRootPaths,
        addedFilePaths,
        hiddenIds: Array.from(hiddenIds),
        notes,
        shareTemplate,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [addedFilePaths, hiddenIds, hydrated, notes, pinnedRootPaths, shareTemplate]);

  const pickFolder = async () => {
    setError("");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择你的作品根目录",
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setLoading(true);
    setLibraryPath(selected);
    try {
      const data = await invoke<MediaItem[]>("scan_library", { rootPath: selected });
      if (!data || data.length === 0) {
        setItems((prev) => prev);
        setError("该目录下没有识别到可展示的文件（可试试：mp4/mov/mp3/jpg/png/pdf 等）");
        return;
      }

      setItems((prev) => {
        const merged = mergeById(prev, data);

        // If current category yields nothing, auto switch to the largest category
        // so the user immediately sees results.
        const hasCurrent = merged.some((it) => it.category === activeCategory);
        if (!hasCurrent) {
          const counts = new Map<string, number>();
          for (const it of merged) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
          let best: string | null = null;
          let bestCount = -1;
          for (const [cat, cnt] of counts.entries()) {
            if (cnt > bestCount) {
              best = cat;
              bestCount = cnt;
            }
          }
          if (best) setActiveCategory(best);
        }

        return merged;
      });
    } catch {
      setError("扫描失败，请换一个目录重试");
    } finally {
      setLoading(false);
    }
  };

  const addFiles = async () => {
    setError("");
    const selected = await open({
      directory: false,
      multiple: true,
      title: "选择要添加的作品文件",
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setLoading(true);
    try {
      const added = await invoke<MediaItem[]>("add_files", { paths });
      if (added.length === 0) {
        setError("没有识别到可支持的文件类型");
      } else {
        setItems((prev) => mergeById(prev, added));
        setAddedFilePaths((prev) => {
          const set = new Set(prev);
          for (const p of paths) set.add(p);
          return Array.from(set);
        });
        setHiddenIds((prev) => {
          const next = new Set(prev);
          for (const item of added) next.delete(item.id);
          return next;
        });
      }
    } catch {
      setError("添加文件失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const clearLibrary = async () => {
    setSelectedCard(null);
    setError("");
    setLibraryPath("");
    setLoading(true);
    try {
      let merged: MediaItem[] = [];
      for (const root of pinnedRootPaths) {
        const data = await invoke<MediaItem[]>("scan_library", { rootPath: root });
        merged = mergeById(merged, data);
      }
      if (addedFilePaths.length > 0) {
        const data = await invoke<MediaItem[]>("add_files", { paths: addedFilePaths });
        merged = mergeById(merged, data);
      }
      setItems(merged);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const togglePinCurrentFolder = () => {
    if (!libraryPath) return;
    setPinnedRootPaths((prev) => {
      const pinned = prev.includes(libraryPath);
      if (pinned) return prev.filter((p) => p !== libraryPath);
      return [...prev, libraryPath];
    });
  };

  const closeModal = () => setSelectedCard(null);
  const closeModalAndMenus = () => {
    setShowShareMenu(false);
    setSelectedCard(null);
  };
  const openCurrentFile = async () => {
    if (!selectedCard?.path) {
      return;
    }
    try {
      await openPath(selectedCard.path);
    } catch (openErr) {
      try {
        await revealItemInDir(selectedCard.path);
      } catch {
        setError(
          `打开文件失败，请检查文件是否仍存在。错误：${
            openErr instanceof Error ? openErr.message : "未知错误"
          }`,
        );
      }
    }
  };

  const moveCurrentFile = async () => {
    if (!selectedCard?.path) return;
    const fromPath = selectedCard.path;
    const fromId = selectedCard.id;
    setError("");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择目标文件夹",
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const moved = await invoke<MediaItem>("move_media_file", {
        fromPath,
        toDir: selected,
      });
      setItems((prev) =>
        prev.map((item) => (item.id === selectedCard.id ? moved : item)).filter(Boolean),
      );
      setSelectedCard(moved);
      setNotes((prev) => {
        const existing = prev[fromId];
        if (typeof existing !== "string" || existing.trim() === "") return prev;
        const next = { ...prev };
        delete next[fromId];
        next[moved.id] = existing;
        return next;
      });
      setAddedFilePaths((prev) => {
        const next = new Set(prev);
        next.delete(fromPath);
        next.add(moved.path);
        return Array.from(next);
      });
    } catch {
      setError("移动文件失败，请检查目标目录权限");
    }
  };

  const removeCurrentFromView = () => {
    if (!selectedCard?.path) return;
    const ok = window.confirm(`仅在应用中隐藏该文件？\n${selectedCard.title}`);
    if (!ok) return;
    setHiddenIds((prev) => new Set(prev).add(selectedCard.id));
    closeModalAndMenus();
  };

  const copyCurrentPath = async () => {
    if (!selectedCard?.path) return;
    try {
      await navigator.clipboard.writeText(selectedCard.path);
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = selectedCard.path;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      } catch {
        setError("复制路径失败");
      }
    }
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = path;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      } catch {
        setError("复制路径失败");
      }
    }
  };

  const shareFile = async (path: string) => {
    try {
      await invoke("share_file", { path });
    } catch (e) {
      setError(`分享失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const buildPublishText = (card: MediaItem) => {
    const base =
      (notes[card.id] ?? "").trim() ||
      (card.title ?? "").trim() ||
      (card.path ? card.path.split("/").pop() ?? "" : "");
    const pieces: string[] = [];
    if (base) pieces.push(base);
    const hashtags = (shareTemplate.hashtags ?? "").trim();
    if (hashtags) pieces.push(hashtags);
    const link = (shareTemplate.link ?? "").trim();
    if (link) pieces.push(link);
    return pieces.join("\n");
  };

  const copyPublishText = async () => {
    if (!selectedCard) return;
    const text = buildPublishText(selectedCard);
    if (!text.trim()) {
      setError("没有可复制的发布文案（先填写备注或模板）");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      } catch {
        setError("复制发布文案失败");
      }
    }
  };

  const openXIntent = async () => {
    if (!selectedCard) return;
    const text = buildPublishText(selectedCard);
    if (text.trim()) {
      // best effort: ensure user can paste even if URL gets truncated
      await copyPublishText();
    }
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    try {
      await openUrl(url);
    } catch {
      setError("打开 X 发布页失败");
    }
  };

  const shareCurrentFile = async () => {
    if (!selectedCard?.path) return;
    try {
      await invoke("share_file", { path: selectedCard.path });
    } catch (e) {
      setError(`分享失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const openContextMenu = (event: React.MouseEvent, card: MediaItem) => {
    if (!card.path) return;
    event.preventDefault();
    event.stopPropagation();
    const x = event.clientX;
    const y = event.clientY;
    setContextMenu({ open: true, x, y, card });
  };

  const closeContextMenu = () => setContextMenu({ open: false, x: 0, y: 0, card: null });

  const restoreOne = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const restoreAll = () => {
    setHiddenIds(new Set());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="sticky top-0 h-screen w-64 shrink-0 border-r border-white/10 bg-black/30 p-6 backdrop-blur-xl">
          <h1 className="mb-8 text-xl font-semibold tracking-wide text-white">My Digital Library</h1>
          <nav className="space-y-2">
            {categories.map((category) => (
              <button
                key={category.label}
                type="button"
                onClick={() => setActiveCategory(category.label)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${
                  activeCategory === category.label
                    ? "bg-white text-zinc-900 shadow-soft"
                    : "text-zinc-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="text-base">{category.icon}</span>
                <span>{category.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-8 md:p-10">
          <div className="mb-7">
            <div className="flex items-center gap-2">
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
                placeholder="搜索作品..."
                className="w-56 rounded-lg border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-zinc-100 outline-none transition focus:border-white/35"
              />
              <button
                type="button"
                onClick={runSearch}
                className="rounded-lg border border-white/20 bg-black/10 px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-white/10"
              >
                搜索
              </button>
            </div>
          </div>
          <header className="mb-8">
            <h2 className="text-3xl font-semibold text-white">精选作品</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={pickFolder}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
              >
                {loading ? "扫描中..." : "选择作品文件夹"}
              </button>
              <button
                type="button"
                onClick={addFiles}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/10"
              >
                添加作品文件
              </button>
              <button
                type="button"
                onClick={() => setShowRemovedPanel((prev) => !prev)}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/10"
              >
                已移除列表（{removedCards.length}）
              </button>
              {libraryPath ? (
                <>
                  <button
                    type="button"
                    onClick={togglePinCurrentFolder}
                    className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/10"
                  >
                    {isCurrentPinned ? "取消保留此目录" : "保留此目录"}
                  </button>
                  <button
                    type="button"
                    onClick={clearLibrary}
                    className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10"
                  >
                    清除当前目录
                  </button>
                </>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              {libraryPath
                ? `当前目录：${libraryPath}`
                : "尚未选择本地目录，当前展示的是演示占位内容"}
            </p>
            {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
          </header>

          {showRemovedPanel ? (
            <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-100">已移除列表</h3>
                <button
                  type="button"
                  onClick={restoreAll}
                  disabled={removedCards.length === 0}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  全部恢复
                </button>
              </div>
              {removedCards.length === 0 ? (
                <p className="text-xs text-zinc-400">当前没有被移除的作品</p>
              ) : (
                <div className="max-h-40 space-y-2 overflow-auto pr-1">
                  {removedCards.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div>
                        <p className="truncate text-xs text-zinc-100">{card.title}</p>
                        <p className="text-[11px] text-zinc-400">{card.category}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreOne(card.id)}
                        className="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-zinc-200 transition hover:bg-white/10"
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section
            className={
              isMediaCategory
                ? "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                : "columns-1 gap-5 sm:columns-2 xl:columns-3 2xl:columns-4"
            }
          >
            {displayedCards.map((card, index) => (
              <article
                key={card.id}
                onContextMenu={(e) => openContextMenu(e, card)}
                className={`apple-card fade-in-up rounded-2xl border border-white/10 bg-zinc-900/60 shadow-soft ${
                  isMediaCategory ? "" : "mb-5 break-inside-avoid"
                }`}
              >
                <div className="overflow-hidden rounded-t-2xl">
                  {card.category === "图片" && card.path ? (
                    <img
                      src={convertFileSrc(card.path)}
                      alt={card.title}
                      style={{ height: `${cardHeights[index % cardHeights.length]}px` }}
                      className="w-full object-cover"
                      loading="lazy"
                      onError={() =>
                        setPreviewError((prev) => ({
                          ...prev,
                          [card.id]: true,
                        }))
                      }
                    />
                  ) : null}
                  {card.category === "图片" && card.path && previewError[card.id] ? (
                    <div
                      style={{ height: `${cardHeights[index % cardHeights.length]}px` }}
                      className="flex w-full items-center justify-center bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900 text-xs text-zinc-400"
                    >
                      缩略图加载失败
                    </div>
                  ) : null}
                  {card.category === "视频" && card.path ? (
                    <div
                      data-media-id={card.id}
                      ref={(el) => {
                        mediaRefs.current[card.id] = el;
                      }}
                    >
                      {!inViewMediaIds.has(card.id) ? (
                        <div
                          style={{
                            height: isMediaCategory ? "220px" : `${cardHeights[index % cardHeights.length]}px`,
                          }}
                          className="flex w-full items-center justify-center bg-black text-xs text-zinc-500"
                        >
                          滚动到可视区域后加载视频
                        </div>
                      ) : (
                        <div className="relative">
                          {mediaError[card.id] ? (
                            <div className="absolute left-3 top-3 z-10 rounded-lg bg-black/40 px-2 py-1 text-[11px] text-zinc-200">
                              视频加载失败
                            </div>
                          ) : null}
                          <VideoInlinePlayer
                            src={convertFileSrc(card.path)}
                            height={
                              isMediaCategory
                                ? "220px"
                                : `${cardHeights[index % cardHeights.length]}px`
                            }
                            cardId={card.id}
                            poster={videoThumbs[card.id]}
                            onReady={() =>
                              setMediaReady((prev) => ({
                                ...prev,
                                [card.id]: true,
                              }))
                            }
                            onError={() => {
                              setMediaError((prev) => ({ ...prev, [card.id]: true }));
                            }}
                            onThumbReady={(id, dataUrl) => {
                              setVideoThumbs((prev) => (prev[id] ? prev : { ...prev, [id]: dataUrl }));
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ) : null}
                  {card.category === "音频" && card.path ? (
                    <div
                      data-media-id={card.id}
                      ref={(el) => {
                        mediaRefs.current[card.id] = el;
                      }}
                      className="flex h-[140px] w-full items-center justify-center bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900 px-4"
                    >
                      {!inViewMediaIds.has(card.id) ? (
                        <div className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-500">
                          滚动到可视区域后加载音频
                        </div>
                      ) : (
                        <div className="relative w-full">
                          {!mediaReady[card.id] ? (
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-400 pointer-events-none">
                              正在加载音频...
                            </div>
                          ) : null}
                          <div className={mediaReady[card.id] ? "opacity-100" : "opacity-0"}>
                            <AudioInlinePlayer
                              src={convertFileSrc(card.path)}
                              cardId={card.id}
                              onReady={() =>
                                setMediaReady((prev) => ({
                                  ...prev,
                                  [card.id]: true,
                                }))
                              }
                              onError={() => setMediaError((prev) => ({ ...prev, [card.id]: true }))}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {(card.category !== "图片" &&
                    card.category !== "视频" &&
                    card.category !== "音频") ||
                  !card.path ? (
                    <div
                      style={{ height: `${cardHeights[index % cardHeights.length]}px` }}
                      className="w-full bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900"
                    />
                  ) : null}
                </div>
                <div className="p-4">
                  <h3 className="truncate text-sm font-medium text-zinc-100">{card.title}</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {card.category}
                    {card.extension ? ` · .${card.extension}` : " · 占位数据"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedCard(card)}
                    className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10"
                  >
                    查看详情
                  </button>
                </div>
              </article>
            ))}
          </section>

          {filteredCards.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-white/10 bg-zinc-900/50 p-6 text-sm text-zinc-400">
              当前分类暂无文件，请切换分类或重新选择目录。
            </div>
          ) : null}
          {filteredCards.length > displayedCards.length ? (
            <div className="mt-6 text-center text-xs text-zinc-500">正在继续加载更多作品...</div>
          ) : null}
        </main>
      </div>

      {selectedCard ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={closeModalAndMenus}
        >
          <div
            className="glass-panel fade-in-up w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-zinc-900/90 shadow-soft"
            onClick={(event) => event.stopPropagation()}
          >
            {selectedCard.category === "图片" && selectedCard.path ? (
              <img
                src={convertFileSrc(selectedCard.path)}
                alt={selectedCard.title}
                className="max-h-[360px] w-full object-cover"
              />
            ) : selectedCard.category === "视频" && selectedCard.path ? (
              <div className="relative">
                <VideoInlinePlayer
                  src={convertFileSrc(selectedCard.path)}
                  height="360px"
                  cardId={selectedCard.id}
                  poster={videoThumbs[selectedCard.id]}
                  onReady={() => {
                    setMediaReady((prev) => ({ ...prev, [selectedCard.id]: true }));
                  }}
                  onError={() => {
                    setMediaError((prev) => ({ ...prev, [selectedCard.id]: true }));
                  }}
                  onThumbReady={(id, dataUrl) => {
                    setVideoThumbs((prev) => (prev[id] ? prev : { ...prev, [id]: dataUrl }));
                  }}
                />
              </div>
            ) : selectedCard.category === "音频" && selectedCard.path ? (
              <div className="flex h-32 w-full items-center justify-center bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900 px-6">
                <AudioInlinePlayer
                  src={convertFileSrc(selectedCard.path)}
                  cardId={selectedCard.id}
                  onReady={() => setMediaReady((prev) => ({ ...prev, [selectedCard.id]: true }))}
                  onError={() => setMediaError((prev) => ({ ...prev, [selectedCard.id]: true }))}
                />
              </div>
            ) : (
              <div className="h-56 w-full bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900" />
            )}
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{selectedCard.title}</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {selectedCard.category}
                    {selectedCard.extension ? ` · .${selectedCard.extension}` : " · 占位数据"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10"
                >
                  关闭
                </button>
              </div>

              <div>
                <p className="mb-1 text-xs text-zinc-400">文件路径</p>
                <p className="rounded-lg bg-black/30 p-3 text-xs text-zinc-300 break-all">
                  {selectedCard.path || "演示占位卡片没有真实路径"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowShareMenu((prev) => !prev)}
                      disabled={!selectedCard.path}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      分享
                    </button>
                    {showShareMenu ? (
                      <div className="absolute left-0 top-[110%] z-50 w-44 overflow-hidden rounded-xl border border-white/15 bg-zinc-950/90 shadow-soft backdrop-blur">
                        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400/80">
                          发布到平台
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void copyPublishText();
                            setShowShareMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                        >
                          复制发布文案
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void shareCurrentFile();
                            setShowShareMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                        >
                          发送文件到手机…
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void openXIntent();
                            setShowShareMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                        >
                          打开 X 发布页
                        </button>
                        <div className="my-1 h-px bg-white/10" />
                        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400/80">
                          文件操作
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void shareCurrentFile();
                            setShowShareMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                        >
                          系统分享面板…
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void copyCurrentPath();
                            setShowShareMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                        >
                          复制文件路径
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void revealItemInDir(selectedCard.path);
                            setShowShareMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                        >
                          在 Finder 显示
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={openCurrentFile}
                    disabled={!selectedCard.path}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    在系统中打开文件
                  </button>
                  <button
                    type="button"
                    onClick={moveCurrentFile}
                    disabled={!selectedCard.path}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    移动到...
                  </button>
                  <button
                    type="button"
                    onClick={removeCurrentFromView}
                    disabled={!selectedCard.path}
                    className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    仅从应用中移除
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs text-zinc-400">备注</p>
                <textarea
                  value={notes[selectedCard.id] ?? ""}
                  onChange={(event) =>
                    setNotes((prev) => ({ ...prev, [selectedCard.id]: event.target.value }))
                  }
                  placeholder="在这里记录你的想法（会自动随文件保存）"
                  className="h-28 w-full resize-none rounded-lg border border-white/15 bg-black/20 p-3 text-sm text-zinc-100 outline-none transition focus:border-white/35"
                />
              </div>

              <div>
                <p className="mb-1 text-xs text-zinc-400">发布模板（全局）</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={shareTemplate.hashtags}
                    onChange={(e) => setShareTemplate((prev) => ({ ...prev, hashtags: e.target.value }))}
                    placeholder="话题/标签（如 #旅行 #摄影）"
                    className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-zinc-100 outline-none transition focus:border-white/35"
                  />
                  <input
                    value={shareTemplate.link}
                    onChange={(e) => setShareTemplate((prev) => ({ ...prev, link: e.target.value }))}
                    placeholder="链接（可选）"
                    className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-zinc-100 outline-none transition focus:border-white/35"
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-400/90">
                  “复制发布文案 / 打开 X 发布页”会使用：备注（优先）→ 文件名 → 话题/标签 → 链接。
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu.open && contextMenu.card ? (
        <div
          className="fixed inset-0 z-[60]"
          onClick={() => closeContextMenu()}
          onContextMenu={(e) => {
            e.preventDefault();
            closeContextMenu();
          }}
        >
          <div
            className="absolute w-52 overflow-hidden rounded-xl border border-white/15 bg-zinc-950/90 shadow-soft backdrop-blur"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y, window.innerHeight - 240),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                setSelectedCard(contextMenu.card);
                closeContextMenu();
              }}
            >
              查看详情
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void openPath(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              在系统中打开文件
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void revealItemInDir(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              在 Finder 显示
            </button>
            <div className="my-1 h-px bg-white/10" />
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void copyPath(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              复制文件路径
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void shareFile(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              系统分享面板…
            </button>
            <div className="my-1 h-px bg-white/10" />
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-rose-200 hover:bg-rose-500/15"
              onClick={() => {
                setHiddenIds((prev) => new Set(prev).add(contextMenu.card!.id));
                closeContextMenu();
              }}
            >
              仅从应用中移除
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
