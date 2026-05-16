import type { CategoryTab, MediaItem } from "../types/media";

export const categories: CategoryTab[] = [
  { label: "视频", icon: "🎬" },
  { label: "音频", icon: "🎧" },
  { label: "图片", icon: "🖼️" },
  { label: "文章", icon: "📝" },
];

export const cardHeights = [220, 280, 320, 360, 260, 300];

export const STORAGE_KEY = "my-digital-library:v1";

export function buildDemoCards(): MediaItem[] {
  return Array.from({ length: 24 }, (_, index) => {
    const category = categories[index % categories.length].label;
    return {
      id: `demo-${index + 1}`,
      category,
      title: `${category}作品 ${index + 1}`,
      path: "",
      extension: "",
    };
  });
}

export const demoCards: MediaItem[] = buildDemoCards();
