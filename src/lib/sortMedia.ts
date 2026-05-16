import type { MediaItem, SortBy, SortDir } from "../types/media";

export const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  { id: "title", label: "名称" },
  { id: "extension", label: "扩展名" },
  { id: "path", label: "路径" },
  { id: "created", label: "创建时间" },
];

const VALID_SORT_BY = new Set<SortBy>(["title", "extension", "path", "created"]);

export function coerceSortBy(raw: unknown): SortBy {
  return typeof raw === "string" && VALID_SORT_BY.has(raw as SortBy) ? (raw as SortBy) : "title";
}

export function coerceSortDir(raw: unknown): SortDir {
  return raw === "desc" ? "desc" : "asc";
}

export function compareMediaItems(a: MediaItem, b: MediaItem, sortBy: SortBy, sortDir: SortDir): number {
  const dir = sortDir === "asc" ? 1 : -1;
  const apply = (c: number) => c * dir;
  if (sortBy === "title") {
    return apply(a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }
  if (sortBy === "extension") {
    const ae = a.extension.toLowerCase();
    const be = b.extension.toLowerCase();
    const primary = ae.localeCompare(be, undefined, { sensitivity: "base" });
    if (primary !== 0) return apply(primary);
    return apply(a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }
  if (sortBy === "created") {
    const ac = a.createdAt ?? 0;
    const bc = b.createdAt ?? 0;
    if (ac !== bc) return apply(ac < bc ? -1 : 1);
    return apply(a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }
  const ap = a.path || a.title;
  const bp = b.path || b.title;
  const primary = ap.localeCompare(bp, undefined, { sensitivity: "base" });
  if (primary !== 0) return apply(primary);
  return apply(a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}
