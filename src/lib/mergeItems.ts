import type { MediaItem } from "../types/media";

export function mergeById(base: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const map = new Map<string, MediaItem>();
  for (const item of base) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}
