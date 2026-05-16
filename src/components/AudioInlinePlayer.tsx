import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

export function AudioInlinePlayer(props: {
  src: string;
  cardId: string;
  onReady: () => void;
  onError: () => void;
}) {
  const { src, cardId, onReady, onError } = props;
  const { t } = useI18n();
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
          aria-label={t("player.audioPlayPause")}
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
          aria-label={t("player.audioProgress", { id: cardId })}
        />
      </div>

      <div className="mt-2 text-[10px] text-zinc-200/70">
        {duration ? `${Math.floor(currentTime)}s / ${Math.floor(duration)}s` : t("player.loading")}
      </div>
    </div>
  );
}
