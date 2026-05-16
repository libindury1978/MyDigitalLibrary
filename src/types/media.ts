export type MediaCategory = "video" | "audio" | "image" | "article";

export type MediaItem = {
  id: string;
  category: string;
  title: string;
  path: string;
  extension: string;
  /** 来自后端的 Unix 毫秒时间戳；无则按 0 参与排序（演示卡片等） */
  createdAt?: number;
};

export type ShareTemplate = {
  hashtags: string;
  link: string;
};

export type SortBy = "title" | "extension" | "path" | "created";
export type SortDir = "asc" | "desc";

export type CategoryTab = { id: MediaCategory; icon: string };
