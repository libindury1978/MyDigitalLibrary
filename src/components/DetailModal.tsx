import { convertFileSrc } from "@tauri-apps/api/core";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { categoryLabel } from "../i18n/translate";
import { categoryEquals } from "../lib/mediaCategory";
import type { MediaItem, ShareTemplate } from "../types/media";
import { AudioInlinePlayer } from "./AudioInlinePlayer";
import { VideoInlinePlayer } from "./VideoInlinePlayer";

export type DetailModalProps = {
  card: MediaItem;
  overlayRef: RefObject<HTMLDivElement | null>;
  publishAssistRef: RefObject<HTMLDivElement | null>;
  fileMenuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  showShareMenu: boolean;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
  showFileMenu: boolean;
  setShowFileMenu: Dispatch<SetStateAction<boolean>>;
  videoThumbs: Record<string, string>;
  onVideoReady: (id: string) => void;
  onVideoError: (id: string) => void;
  onThumbReady: (id: string, dataUrl: string) => void;
  onShareFile: () => void;
  onCopyPublishText: () => void;
  onOpenXIntent: () => void;
  onOpenCurrentFile: () => void;
  onCopyCurrentPath: () => void;
  onRevealInFinder: () => void;
  onMoveFile: () => void;
  onRemoveFromView: () => void;
  notes: Record<string, string>;
  setNotes: Dispatch<SetStateAction<Record<string, string>>>;
  shareTemplate: ShareTemplate;
  setShareTemplate: Dispatch<SetStateAction<ShareTemplate>>;
  publishPreviewText: string;
};

export function DetailModal(props: DetailModalProps) {
  const {
    card,
    overlayRef,
    publishAssistRef,
    fileMenuRef,
    onClose,
    showShareMenu,
    setShowShareMenu,
    showFileMenu,
    setShowFileMenu,
    videoThumbs,
    onVideoReady,
    onVideoError,
    onThumbReady,
    onShareFile,
    onCopyPublishText,
    onOpenXIntent,
    onOpenCurrentFile,
    onCopyCurrentPath,
    onRevealInFinder,
    onMoveFile,
    onRemoveFromView,
    notes,
    setNotes,
    shareTemplate,
    setShareTemplate,
    publishPreviewText,
  } = props;

  const { t } = useI18n();

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div className="flex min-h-full justify-center items-start pb-8 pt-4 sm:pb-12 sm:pt-8">
        <div
          className="glass-panel fade-in-up flex w-full max-h-[calc(100svh-2.5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-900/90 shadow-soft sm:max-h-[calc(100svh-3rem)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center border-b border-white/10 bg-zinc-950/95 px-3 py-2.5 sm:px-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-black/25 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:border-white/35 hover:bg-white/10"
              aria-label={t("detail.backAria")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M14 6L8 12l6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t("detail.back")}
            </button>
          </div>
          <div className="shrink-0 bg-black">
            {categoryEquals(card.category, "image") && card.path ? (
              <img
                src={convertFileSrc(card.path)}
                alt={card.title}
                className="mx-auto block max-h-[min(48svh,28rem)] w-full object-contain"
              />
            ) : categoryEquals(card.category, "video") && card.path ? (
              <div className="relative mx-auto aspect-video w-full max-h-[min(52svh,28rem)] shrink-0 overflow-hidden bg-black">
                <div className="absolute inset-0">
                  <VideoInlinePlayer
                    src={convertFileSrc(card.path)}
                    height="100%"
                    cardId={card.id}
                    poster={videoThumbs[card.id]}
                    objectFit="contain"
                    onReady={() => onVideoReady(card.id)}
                    onError={() => onVideoError(card.id)}
                    onThumbReady={(id, dataUrl) => onThumbReady(id, dataUrl)}
                  />
                </div>
              </div>
            ) : categoryEquals(card.category, "audio") && card.path ? (
              <div className="flex min-h-[7rem] max-h-[min(32svh,16rem)] w-full items-center justify-center bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900 px-4 py-4 sm:px-6">
                <AudioInlinePlayer
                  src={convertFileSrc(card.path)}
                  cardId={card.id}
                  onReady={() => onVideoReady(card.id)}
                  onError={() => onVideoError(card.id)}
                />
              </div>
            ) : (
              <div className="min-h-[7rem] max-h-[min(30svh,14rem)] w-full bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900" />
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-4 sm:p-5">
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold text-white">{card.title}</h3>
              <p className="mt-1 text-xs text-zinc-400">
                {categoryLabel(t, card.category)}
                {card.extension ? ` · .${card.extension}` : ` · ${t("card.placeholderData")}`}
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs text-zinc-400">{t("detail.filePath")}</p>
              <p className="max-h-40 overflow-y-auto rounded-lg bg-black/30 p-3 text-xs text-zinc-300 break-all">
                {card.path || t("detail.noDemoPath")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void onShareFile()}
                  disabled={!card.path}
                  className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("detail.share")}
                </button>

                <div className="relative" ref={publishAssistRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowShareMenu((prev) => !prev);
                      setShowFileMenu(false);
                    }}
                    disabled={!card.path}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("detail.publishAssist")}
                  </button>
                  {showShareMenu ? (
                    <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/15 bg-zinc-950/90 shadow-soft backdrop-blur">
                      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400/80">
                        {t("detail.copyAndPlatform")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void onCopyPublishText();
                          setShowShareMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                      >
                        {t("detail.copyPublishText")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onOpenXIntent();
                          setShowShareMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                      >
                        {t("detail.openX")}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="relative" ref={fileMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowFileMenu((prev) => !prev);
                      setShowShareMenu(false);
                    }}
                    disabled={!card.path}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("detail.more")}
                  </button>
                  {showFileMenu ? (
                    <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/15 bg-zinc-950/90 shadow-soft backdrop-blur">
                      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400/80">
                        {t("detail.fileActions")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void onOpenCurrentFile();
                          setShowFileMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                      >
                        {t("menu.openInSystem")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onCopyCurrentPath();
                          setShowFileMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                      >
                        {t("menu.copyPath")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onRevealInFinder();
                          setShowFileMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                      >
                        {t("menu.revealInFinder")}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onMoveFile}
                  disabled={!card.path}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("detail.moveTo")}
                </button>
                <button
                  type="button"
                  onClick={onRemoveFromView}
                  disabled={!card.path}
                  className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("detail.removeFromApp")}
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs text-zinc-400">{t("detail.notes")}</p>
              <textarea
                value={notes[card.id] ?? ""}
                onChange={(event) =>
                  setNotes((prev) => ({
                    ...prev,
                    [card.id]: event.target.value,
                  }))
                }
                placeholder={t("detail.notesPlaceholder")}
                className="min-h-28 max-h-[min(36svh,14rem)] w-full resize-y rounded-lg border border-white/15 bg-black/20 p-3 text-sm text-zinc-100 outline-none transition focus:border-white/35"
              />
            </div>

            <div>
              <p className="mb-1 text-xs text-zinc-400">{t("detail.publishTemplate")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  value={shareTemplate.hashtags}
                  onChange={(e) => setShareTemplate((prev) => ({ ...prev, hashtags: e.target.value }))}
                  placeholder={t("detail.hashtagsPlaceholder")}
                  className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-zinc-100 outline-none transition focus:border-white/35"
                />
                <input
                  value={shareTemplate.link}
                  onChange={(e) => setShareTemplate((prev) => ({ ...prev, link: e.target.value }))}
                  placeholder={t("detail.linkPlaceholder")}
                  className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-xs text-zinc-100 outline-none transition focus:border-white/35"
                />
              </div>
              <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-400/80">{t("detail.previewLabel")}</p>
                <p className="mt-2 max-h-[min(32svh,13rem)] overflow-y-auto whitespace-pre-wrap break-words text-xs text-zinc-200">
                  {publishPreviewText || t("detail.previewEmpty")}
                </p>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-zinc-400/90">
                <p>{t("detail.rule1")}</p>
                <p>{t("detail.rule2")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
