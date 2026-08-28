import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = resolve(root, "src");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const result = await Bun.build({
  entrypoints: [
    resolve(source, "service-worker.ts"),
    resolve(source, "content-script.ts"),
    resolve(source, "popup.ts"),
  ],
  outdir: output,
  target: "browser",
  format: "esm",
  naming: "[name].js",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await Promise.all([
  cp(resolve(source, "manifest.json"), resolve(output, "manifest.json")),
  cp(resolve(source, "popup.html"), resolve(output, "popup.html")),
  cp(resolve(source, "popup.css"), resolve(output, "popup.css")),
]);

console.info(`Extension built at ${output}`);
