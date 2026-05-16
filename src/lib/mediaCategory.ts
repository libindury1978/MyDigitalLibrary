import type { MediaCategory, MediaItem } from "../types/media";

const LEGACY_TO_ID: Record<string, MediaCategory> = {
  视频: "video",
  音频: "audio",
  图片: "image",
  文章: "article",
  video: "video",
  audio: "audio",
  image: "image",
  article: "article",
};

export function normalizeCategory(raw: string): MediaCategory | null {
  return LEGACY_TO_ID[raw] ?? null;
}

export function isMediaCategory(cat: string): boolean {
  const id = normalizeCategory(cat);
  return id === "video" || id === "audio";
}

export function categoryEquals(cardCategory: string, target: MediaCategory): boolean {
  return normalizeCategory(cardCategory) === target;
}

export function normalizeMediaItem(item: MediaItem): MediaItem {
  const cat = normalizeCategory(item.category);
  return cat ? { ...item, category: cat } : item;
}

export function normalizeMediaItems(items: MediaItem[]): MediaItem[] {
  return items.map(normalizeMediaItem);
}
