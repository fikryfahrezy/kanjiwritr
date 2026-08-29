import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = resolve(root, "src");
const output = resolve(root, "dist");
const defaultServerUrl = process.env.KANJIWRITR_DEFAULT_SERVER_URL ?? "http://localhost:3000";
const packageMetadata = await Bun.file(resolve(root, "package.json")).json() as { version?: unknown };
const extensionVersion = process.env.KANJIWRITR_EXTENSION_VERSION ?? packageMetadata.version;
const requestedBrowser = Bun.argv[2];
const browsers = [
  { name: "chromium", manifest: "manifest.json" },
  { name: "firefox", manifest: "manifest.firefox.json" },
] as const;
const selectedBrowsers = requestedBrowser
  ? browsers.filter(({ name }) => name === requestedBrowser)
  : browsers;

if (requestedBrowser && selectedBrowsers.length === 0) {
  console.error(`Unknown browser "${requestedBrowser}". Use chromium or firefox.`);
  process.exit(1);
}

if (typeof extensionVersion !== "string" || !isBrowserVersion(extensionVersion)) {
  console.error(`Invalid extension version "${String(extensionVersion)}". Use one to four dot-separated integers between 0 and 65535.`);
  process.exit(1);
}

if (!requestedBrowser) await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const browser of selectedBrowsers) {
  const browserOutput = resolve(output, browser.name);
  await rm(browserOutput, { recursive: true, force: true });
  await mkdir(browserOutput, { recursive: true });

  const result = await Bun.build({
    entrypoints: [
      resolve(source, "service-worker.ts"),
      resolve(source, "content-script.ts"),
      resolve(source, "popup.ts"),
    ],
    outdir: browserOutput,
    target: "browser",
    format: "esm",
    naming: "[name].js",
    minify: true,
    define: {
      __KANJIWRITR_DEFAULT_SERVER_URL__: JSON.stringify(defaultServerUrl),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  const manifest = await Bun.file(resolve(source, browser.manifest)).json() as Record<string, unknown>;
  manifest.version = extensionVersion;

  await Promise.all([
    writeFile(resolve(browserOutput, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    cp(resolve(source, "popup.html"), resolve(browserOutput, "popup.html")),
    cp(resolve(source, "popup.css"), resolve(browserOutput, "popup.css")),
    cp(resolve(source, "icons"), resolve(browserOutput, "icons"), { recursive: true }),
  ]);

  console.info(`${browser.name} extension built at ${browserOutput}`);
}

function isBrowserVersion(value: string): boolean {
  const parts = value.split(".");
  return parts.length >= 1
    && parts.length <= 4
    && parts.some((part) => part !== "0")
    && parts.every((part) => /^(0|[1-9]\d*)$/.test(part) && Number(part) <= 65_535);
}
