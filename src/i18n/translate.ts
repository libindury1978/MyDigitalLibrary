import { en } from "./locales/en";
import { zh, type Messages } from "./locales/zh";

export type Locale = "zh" | "en";

const catalogs: Record<Locale, Messages> = { zh, en };

export const LOCALE_STORAGE_KEY = "my-digital-library:locale";

export function readStoredLocale(): Locale {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "en" || raw === "zh") return raw;
  } catch {
    // ignore
  }
  const nav = navigator.language.toLowerCase();
  return nav.startsWith("zh") ? "zh" : "en";
}

function getNested(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function createTranslator(locale: Locale) {
  const messages = catalogs[locale];
  return function t(path: string, params?: Record<string, string | number>): string {
    let text = getNested(messages as unknown as Record<string, unknown>, path);
    if (text === undefined) {
      text = getNested(zh as unknown as Record<string, unknown>, path) ?? path;
    }
    if (!params) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const v = params[key];
      return v === undefined ? "" : String(v);
    });
  };
}

export type TranslateFn = ReturnType<typeof createTranslator>;

export function categoryLabel(t: TranslateFn, categoryId: string): string {
  const key = `category.${categoryId}`;
  const label = t(key);
  return label === key ? categoryId : label;
}
