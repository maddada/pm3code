// t3code-pm keeps its strings out of upstream's generated catalogs, so syncs never conflict there.
const PM_CATALOGS: Record<string, () => object> = {
  es: () => require("./translations/es.json"),
  zh: () => require("./translations/zh.json"),
  "pt-BR": () => require("./translations/pt-BR.json"),
  fr: () => require("./translations/fr.json"),
  de: () => require("./translations/de.json"),
  ja: () => require("./translations/ja.json"),
  ko: () => require("./translations/ko.json"),
  ru: () => require("./translations/ru.json"),
  sv: () => require("./translations/sv.json"),
};

/** Upstream's catalog for the locale with the PM strings on top. */
export const withPmCatalog = (locale: string, upstream: unknown): object => ({
  ...(upstream as object | undefined),
  ...PM_CATALOGS[locale]?.(),
});
