# Kanjiwrittr

Handwrite Japanese on one device, confirm the text, and send it to the currently focused field in a paired browser.

Milestones 1–3 provide secure device pairing, browser-to-browser delivery, a pressure-sensitive handwriting canvas, and local Japanese kanji recognition with confirmation before sending.

See [TODO.md](TODO.md) for the implementation roadmap and milestone completion criteria.

## Requirements

- [Bun](https://bun.sh/) 1.3.14 or newer
- Docker with Compose for container deployment

## Workspaces

```text
apps/web          SolidJS browser-based writing application
apps/server       Bun HTTP and WebSocket server
apps/extension    Chromium Manifest V3 extension
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

The static landing page runs at `http://localhost:5173`, and the dynamic writing preview is available at `http://localhost:5173/app/`. Vite proxies `/ws` and `/healthz` to the Bun server on port `3000`.

The server creates `data/kanjiwrittr.sqlite` by default. Set a stable `CREDENTIAL_SECRET` in production so pending one-time pairing codes remain valid across a server restart. Device credentials are stored only as hashes, and delivered text is neither logged nor persisted.

Rate limits are enabled by default. For unlimited local pairing attempts, set `RATE_LIMITS_ENABLED=false` in the root `.env` and restart the development server. Never disable them in production.

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

## Chromium extension preview

After `bun run build`, load `apps/extension/dist` as an unpacked extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/dist`.

Build the extension with the public server URL that should appear by default:

```sh
KANJIWRITTR_DEFAULT_SERVER_URL=https://your-kanjiwrittr-domain.example bun run build:extension
```

Open the popup, request a pairing code, and enter it at `/app/` on the writing device. The service worker maintains the authenticated connection and inserts acknowledged deliveries into the most recently focused input, textarea, or contenteditable field, including fields in frames. The popup also exposes server settings and explicit unpairing.

## Docker deployment

Build and start locally:

```sh
docker compose up --build -d
docker compose ps
```

The service is exposed on port `3000` by default. Override the host port when necessary:

```sh
KANJIWRITTR_PORT=8080 docker compose up --build -d
```

Copy `.env.example` to `.env`, replace `CREDENTIAL_SECRET` with a long random value, then start Compose. The image runs as the unprivileged `bun` user, includes a `/healthz` health check, and persists SQLite in the `kanjiwrittr-data` volume.

## Handwriting recognition

The writing app captures stylus, touch, and mouse strokes with pressure, timing, and bounds. A Web Worker segments visible character cells and runs the self-hosted MIT-licensed DaKanji ONNX model through single-threaded ONNX Runtime Web WASM. Model assets are cached for repeat visits. Recognition choices and sentence suggestions remain editable, and raw strokes never leave the writing device.

See [docs/pairing-protocol.md](docs/pairing-protocol.md) for the relay design and [docs/recognition.md](docs/recognition.md) for model licensing, limitations, caching, and measurement details.

## Integration smoke test

With a built server running, verify pairing, presence, isolated routing, acknowledgements, and revocation:

```sh
KANJIWRITTR_TEST_URL=http://127.0.0.1:3000 bun run test:integration
```
