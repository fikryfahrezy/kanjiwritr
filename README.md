# Kanjiwrittr

Handwrite Japanese on an iPad, confirm the text, and send it to the currently focused field in a Mac browser.

This initial milestone provides the Bun monorepo, a one-page product landing page, a placeholder SolidJS iPad UI, a Bun HTTP/WebSocket server, a Chromium extension preview, and a production Docker deployment. Pairing and real iPad-to-Mac forwarding are intentionally left for the next milestone.

## Requirements

- [Bun](https://bun.sh/) 1.3.14 or newer
- Docker with Compose for container deployment

## Workspaces

```text
apps/web          SolidJS iPad-facing web application
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

The current popup can insert test text into a focused input, textarea, or contenteditable field. Server pairing is not connected yet.

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

The image runs as the unprivileged `bun` user and includes a `/healthz` health check. It does not need a database volume yet because the placeholder server stores no user data.

## Current preview protocol

The placeholder page connects to `/ws` and can send a `text.preview` message. The server acknowledges the message without logging or persisting its text. Authentication, QR pairing, encryption, receiver presence, and actual delivery will be introduced together so an unauthenticated relay is never exposed by accident.
