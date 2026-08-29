import { encodeClientMessage, parseServerMessage, type ServerMessage } from "../packages/protocol/src";

const baseUrl = process.env.KANJIWRITR_TEST_URL ?? "http://127.0.0.1:3000";

const pairA = await requestPairing();
const pairB = await requestPairing();
let pairingCompleted = false;
let unrelatedDelivery = false;
let extensionSocket!: WebSocket;

extensionSocket = await openSocket(pairA.token, (message) => {
  if (message.type === "pairing.completed") pairingCompleted = true;
  if (message.type === "text.delivery") {
    extensionSocket.send(encodeClientMessage({
      type: "delivery.ack",
      messageId: message.messageId,
      delivered: true,
    }));
  }
});
const unrelatedSocket = await openSocket(pairB.token, (message) => {
  if (message.type === "text.delivery") unrelatedDelivery = true;
});

const claimResponse = await fetch(`${baseUrl}/api/pairings/claim`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: pairA.code }),
});
if (!claimResponse.ok) throw new Error(`Pairing claim failed (${claimResponse.status})`);
const claim = await claimResponse.json() as { token: string };

let resolvePresence!: () => void;
const presence = timeout(new Promise<void>((resolve) => { resolvePresence = resolve; }), "extension presence");
let resolveDelivery!: () => void;
const delivered = timeout(new Promise<void>((resolve) => { resolveDelivery = resolve; }), "delivery acknowledgement");
const ipadSocket = await openSocket(claim.token, (message) => {
  if (message.type === "presence.changed" && message.extensionOnline) resolvePresence();
  if (message.type === "delivery.result" && message.delivered) resolveDelivery();
});
await presence;

ipadSocket.send(encodeClientMessage({ type: "text.deliver", messageId: crypto.randomUUID(), text: "日本語" }));
await delivered;
await Bun.sleep(50);
if (!pairingCompleted) throw new Error("Extension did not receive pairing completion");
if (unrelatedDelivery) throw new Error("Delivery crossed into an unrelated pairing");

const closeA = waitForClose(extensionSocket);
const closeIpad = waitForClose(ipadSocket);
const revokeResponse = await fetch(`${baseUrl}/api/pairings/current`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${claim.token}` },
});
if (!revokeResponse.ok) throw new Error(`Revocation failed (${revokeResponse.status})`);
await Promise.all([closeA, closeIpad]);
unrelatedSocket.close();

console.info("Pairing, presence, isolated delivery, acknowledgement, and revocation passed.");

async function requestPairing(): Promise<{ code: string; token: string }> {
  const response = await fetch(`${baseUrl}/api/pairings`, { method: "POST" });
  if (!response.ok) throw new Error(`Pair request failed (${response.status})`);
  return response.json();
}

function openSocket(token: string, onMessage: (message: ServerMessage) => void): Promise<WebSocket> {
  return timeout(new Promise((resolve, reject) => {
    const url = new URL("/ws", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      if (message) onMessage(message);
    });
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
  }), "WebSocket connection");
}

function waitForClose(socket: WebSocket): Promise<void> {
  return timeout(new Promise((resolve) => socket.addEventListener("close", () => resolve(), { once: true })), "revoked socket close");
}

async function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(5_000).then(() => { throw new Error(`Timed out waiting for ${label}`); }),
  ]);
}
