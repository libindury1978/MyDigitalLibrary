import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { STORAGE_KEY } from "../constants/library";
import { mergeById } from "../lib/mergeItems";
import { coerceSortBy, coerceSortDir } from "../lib/sortMedia";
import type { MediaItem, ShareTemplate, SortBy, SortDir } from "../types/media";

type ParsedStorage = {
  pinnedRootPaths?: string[];
  addedFilePaths?: string[];
  hiddenIds?: string[];
  notes?: Record<string, string>;
  shareTemplate?: Partial<ShareTemplate>;
  sortBy?: string;
  sortDir?: string;
};

export function usePersistedLibrary(args: {
  setItems: Dispatch<SetStateAction<MediaItem[]>>;
  setLibraryPath: Dispatch<SetStateAction<string>>;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
}) {
  const { setItems, setLibraryPath, setLoading, setError } = args;
  const [hydrated, setHydrated] = useState(false);
  const [pinnedRootPaths, setPinnedRootPaths] = useState<string[]>([]);
  const [addedFilePaths, setAddedFilePaths] = useState<string[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [shareTemplate, setShareTemplate] = useState<ShareTemplate>({ hashtags: "", link: "" });
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    const hydrate = async () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          setHydrated(true);
          return;
        }

        const parsed = JSON.parse(raw) as ParsedStorage;

        setSortBy(coerceSortBy(parsed.sortBy));
        setSortDir(coerceSortDir(parsed.sortDir));

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

  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload = {
        pinnedRootPaths,
        addedFilePaths,
        hiddenIds: Array.from(hiddenIds),
        notes,
        shareTemplate,
        sortBy,
        sortDir,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [addedFilePaths, hiddenIds, hydrated, notes, pinnedRootPaths, shareTemplate, sortBy, sortDir]);

  return {
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
  };
}
