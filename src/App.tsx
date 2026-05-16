import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import "./App.css";

import { AudioInlinePlayer } from "./components/AudioInlinePlayer";
import { DetailModal } from "./components/DetailModal";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { VideoInlinePlayer } from "./components/VideoInlinePlayer";
import { buildDemoCards, cardHeights, categoryTabs, DEFAULT_CATEGORY } from "./constants/library";
import { useI18n } from "./i18n/I18nProvider";
import { categoryLabel } from "./i18n/translate";
import { usePersistedLibrary } from "./hooks/usePersistedLibrary";
import { mergeById } from "./lib/mergeItems";
import { categoryEquals, isMediaCategory, normalizeCategory } from "./lib/mediaCategory";
import { compareMediaItems, SORT_OPTION_IDS } from "./lib/sortMedia";
import type { MediaCategory, MediaItem } from "./types/media";

function App() {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<MediaCategory>(DEFAULT_CATEGORY);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [libraryPath, setLibraryPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const {
    hydrated,
    pinnedRootPaths,
    setPinnedRootPaths,
    addedFilePaths,
    setAddedFilePaths,
    hiddenIds,
    setHiddenIds,
    notes,
    setNotes,
    shareTemplate,
    setShareTemplate,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
  } = usePersistedLibrary({ setItems, setLibraryPath, setLoading, setError });
  const [selectedCard, setSelectedCard] = useState<MediaItem | null>(null);
  const [previewError, setPreviewError] = useState<Record<string, boolean>>({});
  const [mediaError, setMediaError] = useState<Record<string, boolean>>({});
  const [showRemovedPanel, setShowRemovedPanel] = useState(false);
  const [visibleCount, setVisibleCount] = useState(8);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [mediaReady, setMediaReady] = useState<Record<string, boolean>>({});
  const [inViewMediaIds, setInViewMediaIds] = useState<Set<string>>(new Set());
  const mediaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    card: MediaItem | null;
  }>({ open: false, x: 0, y: 0, card: null });

  const publishAssistRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const detailOverlayRef = useRef<HTMLDivElement | null>(null);

  const demoCards = useMemo(() => buildDemoCards(t), [t]);

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
          normalizeCategory(card.category) === activeCategory &&
          card.title.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [activeCategory, hiddenIds, search, sourceCards],
  );

  const sortedFilteredCards = useMemo(() => {
    const copy = [...filteredCards];
    copy.sort((a, b) => compareMediaItems(a, b, sortBy, sortDir));
    return copy;
  }, [filteredCards, sortBy, sortDir]);

  const removedCards = useMemo(
    () => sourceCards.filter((card) => hiddenIds.has(card.id)),
    [hiddenIds, sourceCards],
  );
  const activeIsMediaLayout = isMediaCategory(activeCategory);
  const isCurrentPinned = libraryPath ? pinnedRootPaths.includes(libraryPath) : false;
  const displayedCards = useMemo(
    () => sortedFilteredCards.slice(0, visibleCount),
    [sortedFilteredCards, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(8);
  }, [activeCategory, search, libraryPath, items.length, sortBy, sortDir, hiddenIds]);

  const runSearch = () => setSearch(searchDraft);

  useEffect(() => {
    if (!selectedCard) return;
    const el = detailOverlayRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [selectedCard?.id]);

  useEffect(() => {
    if (sortedFilteredCards.length <= 8) return;
    const timer = window.setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + 8, sortedFilteredCards.length));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [sortedFilteredCards, visibleCount]);

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

  const pickFolder = async () => {
    setError("");
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("dialog.pickRoot"),
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
        setError(t("error.noFilesInDir"));
        return;
      }

      setItems((prev) => {
        const merged = mergeById(prev, data);

        // If current category yields nothing, auto switch to the largest category
        // so the user immediately sees results.
        const hasCurrent = merged.some((it) => normalizeCategory(it.category) === activeCategory);
        if (!hasCurrent) {
          const counts = new Map<MediaCategory, number>();
          for (const it of merged) {
            const cat = normalizeCategory(it.category);
            if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
          }
          let best: MediaCategory | null = null;
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
      setError(t("error.scanFailed"));
    } finally {
      setLoading(false);
    }
  };

  const addFiles = async () => {
    setError("");
    const selected = await open({
      directory: false,
      multiple: true,
      title: t("dialog.pickFiles"),
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setLoading(true);
    try {
      const added = await invoke<MediaItem[]>("add_files", { paths });
      if (added.length === 0) {
        setError(t("error.noSupportedFiles"));
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
      setError(t("error.addFilesFailed"));
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

  const closeModalAndMenus = () => {
    setShowShareMenu(false);
    setShowFileMenu(false);
    setSelectedCard(null);
  };

  useEffect(() => {
    if (!showShareMenu && !showFileMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const insidePublish = publishAssistRef.current?.contains(target) ?? false;
      const insideFile = fileMenuRef.current?.contains(target) ?? false;
      if (insidePublish || insideFile) return;
      setShowShareMenu(false);
      setShowFileMenu(false);
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
  }, [showFileMenu, showShareMenu]);
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
          t("error.openFileFailed", {
            detail: openErr instanceof Error ? openErr.message : t("error.unknown"),
          }),
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
      title: t("dialog.pickMoveTarget"),
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
      setError(t("error.moveFailed"));
    }
  };

  const removeCurrentFromView = () => {
    if (!selectedCard?.path) return;
    const ok = window.confirm(t("confirm.hideFile", { title: selectedCard.title }));
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
        setError(t("error.copyPathFailed"));
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
        setError(t("error.copyPathFailed"));
      }
    }
  };

  const shareFile = async (path: string) => {
    try {
      await invoke("share_file", { path });
    } catch (e) {
      setError(
        t("error.shareFailed", {
          detail: e instanceof Error ? e.message : t("error.unknown"),
        }),
      );
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
      setError(t("error.noPublishText"));
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
        setError(t("error.copyPublishFailed"));
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
      setError(t("error.openXFailed"));
    }
  };

  const shareCurrentFile = async () => {
    if (!selectedCard?.path) return;
    try {
      await invoke("share_file", { path: selectedCard.path });
    } catch (e) {
      setError(
        t("error.shareFailed", {
          detail: e instanceof Error ? e.message : t("error.unknown"),
        }),
      );
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
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-black/30 p-6 backdrop-blur-xl">
          <h1 className="mb-8 text-xl font-semibold tracking-wide text-white">{t("app.title")}</h1>
          <nav className="space-y-2">
            {categoryTabs.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${
                  activeCategory === category.id
                    ? "bg-white text-zinc-900 shadow-soft"
                    : "text-zinc-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="text-base">{category.icon}</span>
                <span>{categoryLabel(t, category.id)}</span>
              </button>
            ))}
          </nav>
          <LanguageSwitcher />
        </aside>

        <main className="flex-1 p-8 md:p-10">
          <div className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-center gap-2">
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
                placeholder={t("search.placeholder")}
                className="w-56 rounded-lg border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-zinc-100 outline-none transition focus:border-white/35"
              />
              <button
                type="button"
                onClick={runSearch}
                className="rounded-lg border border-white/20 bg-black/10 px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-white/10"
              >
                {t("search.button")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-l border-white/10 pl-4">
              <span className="text-xs text-zinc-500">{t("sort.label")}</span>
              {SORT_OPTION_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={sortBy === id}
                  aria-label={t("sort.byField", { field: t(`sort.${id}`) })}
                  onClick={() => setSortBy(id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    sortBy === id
                      ? "border-white/40 bg-white/15 text-white"
                      : "border-white/20 bg-black/10 text-zinc-100 hover:bg-white/10"
                  }`}
                >
                  {t(`sort.${id}`)}
                </button>
              ))}
              <button
                type="button"
                aria-label={sortDir === "asc" ? t("sort.toggleAsc") : t("sort.toggleDesc")}
                aria-pressed={sortDir === "desc"}
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                className="rounded-lg border border-white/20 bg-black/10 px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-white/10"
              >
                {sortDir === "asc" ? t("sort.asc") : t("sort.desc")}
              </button>
            </div>
          </div>
          <header className="mb-8">
            <h2 className="text-3xl font-semibold text-white">{t("library.featured")}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={pickFolder}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
              >
                {loading ? t("library.scanning") : t("library.pickFolder")}
              </button>
              <button
                type="button"
                onClick={addFiles}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/10"
              >
                {t("library.addFiles")}
              </button>
              <button
                type="button"
                onClick={() => setShowRemovedPanel((prev) => !prev)}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/10"
              >
                {t("library.removedList", { count: removedCards.length })}
              </button>
              {libraryPath ? (
                <>
                  <button
                    type="button"
                    onClick={togglePinCurrentFolder}
                    className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/10"
                  >
                    {isCurrentPinned ? t("library.unpinFolder") : t("library.pinFolder")}
                  </button>
                  <button
                    type="button"
                    onClick={clearLibrary}
                    className="rounded-xl border border-white/20 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10"
                  >
                    {t("library.clearFolder")}
                  </button>
                </>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              {libraryPath
                ? t("library.currentDir", { path: libraryPath })
                : t("library.demoHint")}
            </p>
            {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
          </header>

          {showRemovedPanel ? (
            <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-100">{t("removed.title")}</h3>
                <button
                  type="button"
                  onClick={restoreAll}
                  disabled={removedCards.length === 0}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("removed.restoreAll")}
                </button>
              </div>
              {removedCards.length === 0 ? (
                <p className="text-xs text-zinc-400">{t("removed.empty")}</p>
              ) : (
                <div className="max-h-40 space-y-2 overflow-auto pr-1">
                  {removedCards.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div>
                        <p className="truncate text-xs text-zinc-100">{card.title}</p>
                        <p className="text-[11px] text-zinc-400">{categoryLabel(t, card.category)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreOne(card.id)}
                        className="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-zinc-200 transition hover:bg-white/10"
                      >
                        {t("removed.restore")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section
            className={
              activeIsMediaLayout
                ? "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                : "columns-1 gap-5 sm:columns-2 xl:columns-3 2xl:columns-4"
            }
          >
            {displayedCards.map((card, index) => (
              <article
                key={card.id}
                onContextMenu={(e) => openContextMenu(e, card)}
                className={`apple-card fade-in-up rounded-2xl border border-white/10 bg-zinc-900/60 shadow-soft ${
                  activeIsMediaLayout ? "" : "mb-5 break-inside-avoid"
                }`}
              >
                <div className="overflow-hidden rounded-t-2xl">
                  {categoryEquals(card.category, "image") && card.path ? (
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
                      {t("card.thumbFailed")}
                    </div>
                  ) : null}
                  {categoryEquals(card.category, "video") && card.path ? (
                    <div
                      data-media-id={card.id}
                      ref={(el) => {
                        mediaRefs.current[card.id] = el;
                      }}
                    >
                      {!inViewMediaIds.has(card.id) ? (
                        <div
                          style={{
                            height: activeIsMediaLayout ? "220px" : `${cardHeights[index % cardHeights.length]}px`,
                          }}
                          className="flex w-full items-center justify-center bg-black text-xs text-zinc-500"
                        >
                          {t("card.scrollToLoadVideo")}
                        </div>
                      ) : (
                        <div className="relative">
                          {mediaError[card.id] ? (
                            <div className="absolute left-3 top-3 z-10 rounded-lg bg-black/40 px-2 py-1 text-[11px] text-zinc-200">
                              {t("card.videoLoadFailed")}
                            </div>
                          ) : null}
                          <VideoInlinePlayer
                            src={convertFileSrc(card.path)}
                            height={
                              activeIsMediaLayout
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
                  {categoryEquals(card.category, "audio") && card.path ? (
                    <div
                      data-media-id={card.id}
                      ref={(el) => {
                        mediaRefs.current[card.id] = el;
                      }}
                      className="flex h-[140px] w-full items-center justify-center bg-gradient-to-br from-zinc-700/40 via-zinc-800/50 to-zinc-900 px-4"
                    >
                      {!inViewMediaIds.has(card.id) ? (
                        <div className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-500">
                          {t("card.scrollToLoadAudio")}
                        </div>
                      ) : (
                        <div className="relative w-full">
                          {!mediaReady[card.id] ? (
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-400 pointer-events-none">
                              {t("card.loadingAudio")}
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
                  {(!categoryEquals(card.category, "image") &&
                    !categoryEquals(card.category, "video") &&
                    !categoryEquals(card.category, "audio")) ||
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
                    {categoryLabel(t, card.category)}
                    {card.extension ? ` · .${card.extension}` : ` · ${t("card.placeholderData")}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedCard(card)}
                    className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/10"
                  >
                    {t("card.viewDetails")}
                  </button>
                </div>
              </article>
            ))}
          </section>

          {sortedFilteredCards.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-white/10 bg-zinc-900/50 p-6 text-sm text-zinc-400">
              {t("library.emptyCategory")}
            </div>
          ) : null}
          {sortedFilteredCards.length > displayedCards.length ? (
            <div className="mt-6 text-center text-xs text-zinc-500">{t("library.loadingMore")}</div>
          ) : null}
        </main>
      </div>

      {selectedCard ? (
        <DetailModal
          card={selectedCard}
          overlayRef={detailOverlayRef}
          publishAssistRef={publishAssistRef}
          fileMenuRef={fileMenuRef}
          onClose={closeModalAndMenus}
          showShareMenu={showShareMenu}
          setShowShareMenu={setShowShareMenu}
          showFileMenu={showFileMenu}
          setShowFileMenu={setShowFileMenu}
          videoThumbs={videoThumbs}
          onVideoReady={(id) => setMediaReady((prev) => ({ ...prev, [id]: true }))}
          onVideoError={(id) => setMediaError((prev) => ({ ...prev, [id]: true }))}
          onThumbReady={(id, dataUrl) =>
            setVideoThumbs((prev) => (prev[id] ? prev : { ...prev, [id]: dataUrl }))
          }
          onShareFile={() => void shareCurrentFile()}
          onCopyPublishText={() => void copyPublishText()}
          onOpenXIntent={() => void openXIntent()}
          onOpenCurrentFile={() => void openCurrentFile()}
          onCopyCurrentPath={() => void copyCurrentPath()}
          onRevealInFinder={() => void revealItemInDir(selectedCard.path)}
          onMoveFile={moveCurrentFile}
          onRemoveFromView={removeCurrentFromView}
          notes={notes}
          setNotes={setNotes}
          shareTemplate={shareTemplate}
          setShareTemplate={setShareTemplate}
          publishPreviewText={buildPublishText(selectedCard)}
        />
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
              {t("menu.viewDetails")}
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void openPath(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              {t("menu.openInSystem")}
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void revealItemInDir(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              {t("menu.revealInFinder")}
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
              {t("menu.copyPath")}
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
              onClick={() => {
                void shareFile(contextMenu.card!.path);
                closeContextMenu();
              }}
            >
              {t("menu.systemShare")}
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
              {t("menu.removeFromApp")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
