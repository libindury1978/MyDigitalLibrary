import { useI18n } from "../i18n/I18nProvider";
import type { Locale } from "../i18n/translate";

const options: { id: Locale; labelKey: "language.zh" | "language.en" }[] = [
  { id: "zh", labelKey: "language.zh" },
  { id: "en", labelKey: "language.en" },
];

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="mt-auto pt-6">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">{t("language.label")}</p>
      <div className="flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setLocale(opt.id)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs transition ${
              locale === opt.id
                ? "bg-white font-medium text-zinc-900"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
            aria-pressed={locale === opt.id}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
