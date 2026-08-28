import { resolve, sep } from "node:path";
import { encodeServerMessage, parseClientMessage } from "@kanjiwrittr/protocol";

interface SocketData {
  connectionId: string;
}

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const webRoot = resolve(process.env.WEB_ROOT ?? "apps/web/dist");
const maximumMessageBytes = 16 * 1024;

if (!Number.isFinite(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT ?? "3000"}`);
}

const server = Bun.serve<SocketData>({
  hostname: host,
  port,
  fetch(request, bunServer) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", service: "kanjiwrittr" }, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const upgraded = bunServer.upgrade(request, {
        data: { connectionId: crypto.randomUUID() },
      });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/app") {
      return Response.redirect(new URL("/app/", url).href, 308);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    return serveWebAsset(url.pathname, request.method === "HEAD");
  },
  websocket: {
    idleTimeout: 60,
    maxPayloadLength: maximumMessageBytes,
    open(socket) {
      socket.send(encodeServerMessage({
        type: "connection.ready",
        connectionId: socket.data.connectionId,
      }));
    },
    message(socket, payload) {
      if (byteLength(payload) > maximumMessageBytes) {
        socket.send(encodeServerMessage({ type: "protocol.error", code: "message_too_large" }));
        socket.close(1009, "Message too large");
        return;
      }

      const message = parseClientMessage(typeof payload === "string" ? payload : payload.toString());
      if (!message) {
        socket.send(encodeServerMessage({ type: "protocol.error", code: "invalid_message" }));
        return;
      }

      if (message.type === "ping") {
        socket.send(encodeServerMessage({ type: "pong" }));
        return;
      }

      // Preview mode intentionally acknowledges without logging or persisting the text.
      socket.send(encodeServerMessage({
        type: "text.received",
        messageId: message.messageId,
      }));
    },
  },
});

console.info(`Kanjiwrittr listening on http://${server.hostname}:${server.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.info(`Received ${signal}; closing Kanjiwrittr.`);
    void server.stop(true).finally(() => process.exit(0));
  });
}

async function serveWebAsset(pathname: string, headOnly: boolean): Promise<Response> {
  const decodedPath = decodePathname(pathname);
  if (decodedPath === undefined) return new Response("Bad request", { status: 400 });

  const relativePath = decodedPath === "/"
    ? "index.html"
    : decodedPath.endsWith("/")
      ? `${decodedPath.slice(1)}index.html`
      : decodedPath.slice(1);
  const candidatePath = resolve(webRoot, relativePath);
  const isWithinWebRoot = candidatePath === webRoot || candidatePath.startsWith(`${webRoot}${sep}`);
  if (!isWithinWebRoot) return new Response("Not found", { status: 404 });

  const candidate = Bun.file(candidatePath);
  if (await candidate.exists()) return fileResponse(candidate, pathname, headOnly);

  if (pathname.startsWith("/assets/") || pathname.includes(".")) {
    return new Response("Not found", { status: 404 });
  }

  const fallbackPath = pathname.startsWith("/app/") ? "app/index.html" : "index.html";
  const fallback = Bun.file(resolve(webRoot, fallbackPath));
  if (await fallback.exists()) return fileResponse(fallback, `/${fallbackPath}`, headOnly);

  return new Response("Web application has not been built", { status: 503 });
}

function fileResponse(file: Blob, pathname: string, headOnly: boolean): Response {
  const immutableAsset = pathname.startsWith("/assets/");
  return new Response(headOnly ? null : file, {
    headers: {
      "cache-control": immutableAsset
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-length": String(file.size),
      ...(file.type ? { "content-type": file.type } : {}),
    },
  });
}

function decodePathname(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function byteLength(payload: string | Buffer): number {
  return typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength;
}
