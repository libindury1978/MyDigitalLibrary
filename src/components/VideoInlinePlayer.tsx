import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

export function VideoInlinePlayer(props: {
  src: string;
  height: string;
  cardId: string;
  poster?: string;
  /** 详情等场景用 contain 显示完整画幅；列表默认 cover 铺满 */
  objectFit?: "cover" | "contain";
  onReady: () => void;
  onError: () => void;
  onThumbReady?: (cardId: string, dataUrl: string) => void;
}) {
  const { src, height, cardId, poster, objectFit = "cover", onReady, onError, onThumbReady } = props;
  const { t } = useI18n();
  const objectFitClass = objectFit === "contain" ? "object-contain" : "object-cover";
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
          className={`absolute inset-0 h-full w-full object-center ${objectFitClass}`}
          style={{ opacity: playing ? 0 : 1, transition: "opacity 180ms ease" }}
        />
      ) : null}
      <video
        ref={videoRef}
        src={src}
        className={`absolute inset-0 h-full w-full bg-black object-center ${objectFitClass} transition-opacity ${
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
            aria-label={t("player.toggleMute")}
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
            aria-label={t("player.volume", { percent: Math.round((muted ? 0 : volume) * 100) })}
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
            aria-label={t("player.playPause")}
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
                aria-label={t("player.progress", { id: cardId })}
              />
            </div>
            <div className="mt-1 text-[10px] text-zinc-200/80">
              {duration ? `${Math.floor(currentTime)}s / ${Math.floor(duration)}s` : t("player.loading")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
