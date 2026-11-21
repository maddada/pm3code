// t3code-pm keeps its strings out of upstream's generated catalogs, so syncs never conflict there.
export async function loadPmTranslations(locale: string): Promise<object> {
  const module: { default: object } = await import(`./translations/${locale}.json`);
  return module.default;
}
