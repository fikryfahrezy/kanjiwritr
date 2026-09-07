# Kanjiwritr

Handwrite Japanese on one device, confirm the text, and send it to the currently focused field in a paired browser.

Milestones 1–3 provide secure device pairing, browser-to-browser delivery, a pressure-sensitive handwriting canvas, and local Japanese kanji recognition with confirmation before sending.

## Requirements

- [Bun](https://bun.sh/) 1.3.14 or newer
- Docker with Compose for container deployment

## Workspaces

```text
apps/web          SolidJS browser-based writing application
apps/server       Bun HTTP and WebSocket server
apps/extension    Chromium and Firefox Manifest V3 extension
packages/protocol Shared transport message types and parsers
```

## Local development

Install dependencies:

```sh
bun install
```

Start the web UI and backend together:

```sh
bun run dev
```

The static landing page runs at `http://localhost:5173`, and the writing app is available at `http://localhost:5173/app/`. Vite proxies `/ws` and `/healthz` to the Bun server on port `3000`.

The server creates `data/kanjiwritr.sqlite` by default. Set a stable `CREDENTIAL_SECRET` in production so pending one-time pairing codes remain valid across a server restart. Device credentials are stored only as hashes, and delivered text is neither logged nor persisted.

Rate limits are enabled by default. For unlimited local pairing attempts, set `RATE_LIMITS_ENABLED=false` in the root `.env` and restart the development server. Never disable them in production. Pairing issuance, pairing claims, and WebSocket authentication can be configured independently with the `*_RATE_LIMIT_MAX` and `*_RATE_LIMIT_WINDOW_SECONDS` variables documented in `.env.example`.

The web build uses two HTML entry points. `apps/web/index.html` contains the complete marketing page for search engines and works without JavaScript; `apps/web/app/index.html` loads the SolidJS application. The production server redirects `/app` to `/app/` and keeps application fallbacks inside that route.

## Build and test

```sh
bun run typecheck
bun test
bun run build
```

Start the production build locally:

```sh
bun run start
```

Then open `http://localhost:3000` or check `http://localhost:3000/healthz`.

## Browser receiver extensions

Download packaged builds from the
[latest GitHub Release](https://github.com/fikryfahrezy/kanjiwritr/releases/latest),
or build them locally as described below.

After `bun run build`, the browser-specific extensions are available under
`apps/extension/dist`.

### Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist/chromium`.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `apps/extension/dist/firefox/manifest.json`.

Firefox removes temporary add-ons when the browser restarts. A signed release
can be installed persistently after it is packaged and submitted to Firefox Add-ons.

Build the extension with the public server URL that should appear by default:

```sh
KANJIWRITR_DEFAULT_SERVER_URL=https://your-kanjiwritr-domain.example bun run build:extension
```

The command above builds both targets. To build only one target, run
`bun run --cwd apps/extension build:chromium` or
`bun run --cwd apps/extension build:firefox`.

Open the popup, request a pairing code, and enter it at `/app/` on the writing device. The extension's background process maintains the authenticated connection and replaces the contents of the most recently focused input, textarea, or contenteditable field with each acknowledged delivery, including fields in frames. The popup also exposes server settings and explicit unpairing.

### Automated extension releases

The `Browser extensions` GitHub Actions workflow builds and validates both
targets on pull requests and pushes to `main`. Its packaged ZIP files are
available from the workflow run for 14 days.

Pushing a tag that matches the extension package version creates a GitHub
Release and attaches both browser ZIP files, the corresponding source archive,
and SHA-256 checksums. For example, after setting
`apps/extension/package.json` to version `0.2.0`:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Set the Actions repository variable `KANJIWRITR_DEFAULT_SERVER_URL` to make a
deployed server the default in release builds. Without it, releases default to
`http://localhost:3000`, and users can still change the server in the popup.

Chromium users download and extract the ZIP, then load its directory as an
unpacked extension. Firefox requires Mozilla signing for normal persistent
installation. To attach a signed Firefox XPI automatically, create AMO API
credentials and add them as Actions secrets named `AMO_JWT_ISSUER` and
`AMO_JWT_SECRET`. Without those secrets, the release still includes the unsigned
Firefox ZIP for temporary installation through `about:debugging`.

## Docker deployment

Build and start locally:

```sh
docker compose up --build -d
docker compose ps
```

The service is exposed on port `3000` by default. Override the host port when necessary:

```sh
KANJIWRITR_PORT=8080 docker compose up --build -d
```

Copy `.env.example` to `.env`, replace `CREDENTIAL_SECRET` with a long random value, then start Compose. The image runs as the unprivileged `bun` user, includes a `/healthz` health check, and persists SQLite in the `kanjiwritr-data` volume.

When the service is behind Cloudflare, set `TRUST_CLOUDFLARE_PROXY=true` so rate limits use Cloudflare's validated `CF-Connecting-IP` value instead of the proxy connection address. Enable this only when clients cannot bypass Cloudflare and reach the origin directly—for example, use Cloudflare Tunnel or restrict origin ingress to Cloudflare.

## Handwriting recognition

The writing app captures stylus, touch, and mouse strokes with pressure, timing, and bounds. A Web Worker segments visible character cells and runs the self-hosted MIT-licensed DaKanji ONNX model through single-threaded ONNX Runtime Web WASM. Model assets are cached for repeat visits. Recognition choices and sentence suggestions remain editable, and raw strokes never leave the writing device.

See [docs/pairing-protocol.md](docs/pairing-protocol.md) for the relay design and [docs/recognition.md](docs/recognition.md) for model licensing, limitations, caching, and measurement details.

## Integration smoke test

With a built server running, verify pairing, presence, isolated routing, acknowledgements, and revocation:

```sh
KANJIWRITR_TEST_URL=http://127.0.0.1:3000 bun run test:integration
```
