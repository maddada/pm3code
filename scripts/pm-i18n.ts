#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A one-shot fork check; synchronous Node APIs keep it small.
// t3code-pm: PM strings live in their own catalogs (apps/web/src/pm/i18n), out of upstream's.
// `node scripts/pm-i18n.ts generate` rewrites them from source; `check` fails when they drift, the
// same rules as scripts/i18n-check.ts applies to upstream's catalogs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

type Catalog = Record<string, unknown>;
const APPS = ["apps/web", "apps/mobile"];
const CONFIG = "src/pm/i18n/gt.config.json";
const mode = process.argv[2];
if (mode !== "generate" && mode !== "check") {
  console.error("Usage: node scripts/pm-i18n.ts generate|check");
  process.exit(2);
}

const root = NodePath.resolve(import.meta.dirname, "..");
const readJson = (file: string): Catalog => JSON.parse(NodeFS.readFileSync(file, "utf8"));
const missingFrom = (from: Catalog, catalog: Catalog) =>
  Object.keys(from).filter((key) => !Object.hasOwn(catalog, key));
const problems: string[] = [];

for (const app of APPS) {
  const appDir = NodePath.join(root, app);
  const configPath = NodePath.join(appDir, CONFIG);
  if (!NodeFS.existsSync(configPath)) continue;
  const config = JSON.parse(NodeFS.readFileSync(configPath, "utf8"));
  const catalogDir = NodePath.join(appDir, NodePath.dirname(config.files.gt.output));
  const gt = (configFile: string) =>
    NodeChildProcess.spawnSync("node_modules/.bin/gt", ["generate", "--config", configFile], {
      cwd: appDir,
      encoding: "utf8",
    });

  if (mode === "generate") {
    const before: Record<string, Catalog> = {};
    for (const locale of config.locales) {
      const file = NodePath.join(catalogDir, `${locale}.json`);
      before[locale] = NodeFS.existsSync(file) ? readJson(file) : {};
    }
    const result = gt(configPath);
    if (result.status !== 0) {
      problems.push(`${app}: gt generate failed\n${result.stdout}${result.stderr}`);
      continue;
    }
    // gt writes English into every locale; keep the translations already made by hand.
    const source = readJson(NodePath.join(catalogDir, `${config.defaultLocale}.json`));
    for (const locale of config.locales) {
      const file = NodePath.join(catalogDir, `${locale}.json`);
      const kept = Object.fromEntries(
        Object.keys(source).map((key) => [key, before[locale]?.[key] ?? source[key]]),
      );
      NodeFS.writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
    }
    continue;
  }

  const source = readJson(NodePath.join(catalogDir, `${config.defaultLocale}.json`));
  const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pm-i18n-check-"));
  try {
    const tmpConfig = NodePath.join(tmp, "gt.config.json");
    NodeFS.writeFileSync(
      tmpConfig,
      JSON.stringify({ ...config, locales: [], files: { gt: { output: `${tmp}/[locale].json` } } }),
    );
    const result = gt(tmpConfig);
    if (result.status !== 0) {
      problems.push(`${app}: gt generate failed\n${result.stdout}${result.stderr}`);
      continue;
    }
    const generated = readJson(NodePath.join(tmp, `${config.defaultLocale}.json`));
    for (const [key, text] of Object.entries(generated)) {
      if (!Object.hasOwn(source, key))
        problems.push(`${app}: ${key} ${JSON.stringify(text)} is missing from the PM en.json`);
      else if (JSON.stringify(source[key]) !== JSON.stringify(text))
        problems.push(
          `${app}: PM en.json has ${key} ${JSON.stringify(source[key])}, source says ${JSON.stringify(text)}`,
        );
    }
    for (const key of missingFrom(source, generated))
      problems.push(`${app}: ${key} ${JSON.stringify(source[key])} in the PM en.json is stale`);
  } finally {
    NodeFS.rmSync(tmp, { recursive: true, force: true });
  }
  for (const locale of config.locales) {
    const catalog = readJson(NodePath.join(catalogDir, `${locale}.json`));
    for (const key of missingFrom(source, catalog))
      problems.push(`${app}: PM ${locale}.json is missing ${key} ${JSON.stringify(source[key])}`);
    for (const key of missingFrom(catalog, source))
      problems.push(`${app}: PM ${locale}.json has ${key}, which en.json lacks`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error("\nRun `node scripts/pm-i18n.ts generate`, then translate any new keys by hand.");
  process.exit(1);
}
