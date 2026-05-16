import type { TranslateFn } from "../i18n/translate";
import { categoryLabel } from "../i18n/translate";
import type { CategoryTab, MediaCategory, MediaItem } from "../types/media";

export const categoryTabs: CategoryTab[] = [
  { id: "video", icon: "🎬" },
  { id: "audio", icon: "🎧" },
  { id: "image", icon: "🖼️" },
  { id: "article", icon: "📝" },
];

export const DEFAULT_CATEGORY: MediaCategory = "video";

export const cardHeights = [220, 280, 320, 360, 260, 300];

export const STORAGE_KEY = "my-digital-library:v1";

export function buildDemoCards(t: TranslateFn): MediaItem[] {
  return Array.from({ length: 24 }, (_, index) => {
    const id = categoryTabs[index % categoryTabs.length].id;
    const catLabel = categoryLabel(t, id);
    return {
      id: `demo-${index + 1}`,
      category: id,
      title: t("demo.workTitle", { category: catLabel, index: index + 1 }),
      path: "",
      extension: "",
    };
  });
}
