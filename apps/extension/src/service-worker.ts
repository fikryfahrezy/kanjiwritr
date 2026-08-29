import { encodeClientMessage, parseServerMessage, type DeliveryError } from "@kanjiwritr/protocol";

declare const __KANJIWRITR_DEFAULT_SERVER_URL__: string;

type ExtensionConnectionState = "not-paired" | "waiting" | "connecting" | "online" | "reconnecting" | "error";

interface ExtensionState {
  serverUrl: string;
  token?: string;
  pairingCode?: string;
  pairingExpiresAt?: string;
  connectionState: ExtensionConnectionState;
  lastError?: string;
}

type StatePatch = { [Key in keyof ExtensionState]?: ExtensionState[Key] | undefined };

interface FocusedFrame {
  tabId: number;
  frameId: number;
  focusedAt: number;
}

const defaults: ExtensionState = {
  serverUrl: __KANJIWRITR_DEFAULT_SERVER_URL__,
  connectionState: "not-paired",
};

let socket: WebSocket | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
let focusedFrame: FocusedFrame | undefined;

chrome.runtime.onInstalled.addListener(() => {
  void getState().then((state) => chrome.storage.local.set(state));
});
chrome.runtime.onStartup.addListener(() => void restoreConnection());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keep-connected" && (!socket || socket.readyState > WebSocket.OPEN)) {
    void restoreConnection();
  }
});
void chrome.alarms.create("keep-connected", { periodInMinutes: 0.5 });

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (isFocusMessage(message) && sender.tab?.id !== undefined) {
    focusedFrame = { tabId: sender.tab.id, frameId: sender.frameId ?? 0, focusedAt: Date.now() };
    return;
  }
  if (!isPopupMessage(message)) return;
  void handlePopupMessage(message)
    .then((value) => respond({ ok: true, value }))
    .catch((cause: unknown) => respond({
      ok: false,
      error: cause instanceof Error ? cause.message : "Unexpected extension error.",
    }));
  return true;
});

void restoreConnection();

async function handlePopupMessage(message: PopupMessage): Promise<unknown> {
  if (message.type === "state.get") return getState();
  if (message.type === "pairing.request") return requestPairing();
  if (message.type === "server.save") return saveServer(message.serverUrl);
  await unpair();
  return getState();
}

async function requestPairing(): Promise<ExtensionState> {
  const state = await getState();
  closeSocket();
  if (state.token) await revokeRemote(state).catch(() => undefined);
  const response = await fetch(`${state.serverUrl}/api/pairings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Too many pairing attempts. Try again later." : "Could not request a pairing code.");
  const result = await response.json() as { code?: unknown; token?: unknown; expiresAt?: unknown };
  if (typeof result.code !== "string" || typeof result.token !== "string" || typeof result.expiresAt !== "string") {
    throw new Error("The server returned an invalid pairing response.");
  }
  const next: ExtensionState = {
    serverUrl: state.serverUrl,
    token: result.token,
    pairingCode: result.code,
    pairingExpiresAt: result.expiresAt,
    connectionState: "waiting",
  };
  await replaceState(next);
  connect(next);
  return next;
}

async function saveServer(rawUrl: string): Promise<ExtensionState> {
  const serverUrl = normalizeServerUrl(rawUrl);
  const previous = await getState();
  closeSocket();
  if (previous.token && previous.serverUrl !== serverUrl) await revokeRemote(previous).catch(() => undefined);
  const next: ExtensionState = { serverUrl, connectionState: "not-paired" };
  await replaceState(next);
  return next;
}

async function unpair(): Promise<void> {
  const state = await getState();
  closeSocket();
  await revokeRemote(state).catch(() => undefined);
  await replaceState({ serverUrl: state.serverUrl, connectionState: "not-paired" });
}

async function revokeRemote(state: ExtensionState): Promise<void> {
  if (!state.token) return;
  await fetch(`${state.serverUrl}/api/pairings/current`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${state.token}` },
  });
}

async function restoreConnection(): Promise<void> {
  const state = await getState();
  if (!state.token) return;
  if (state.pairingExpiresAt && Date.parse(state.pairingExpiresAt) <= Date.now()) {
    closeSocket();
    await revokeRemote(state).catch(() => undefined);
    await replaceState({
      serverUrl: state.serverUrl,
      connectionState: "not-paired",
      lastError: "The pairing code expired. Request a new one.",
    });
    return;
  }
  connect(state);
}

function connect(state: ExtensionState): void {
  closeSocket();
  const url = new URL("/ws", state.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", state.token ?? "");
  void updateState({ connectionState: reconnectAttempt > 0 ? "reconnecting" : state.pairingCode ? "waiting" : "connecting" });
  const connection = new WebSocket(url);
  socket = connection;
  connection.addEventListener("open", () => {
    if (socket !== connection) return;
    reconnectAttempt = 0;
    void updateState({ connectionState: state.pairingCode ? "waiting" : "online", lastError: undefined });
    heartbeat = setInterval(() => {
      if (socket === connection && connection.readyState === WebSocket.OPEN) {
        connection.send(encodeClientMessage({ type: "ping" }));
      }
    }, 25_000);
  });
  connection.addEventListener("message", (event) => {
    if (socket === connection) void handleServerMessage(connection, event.data);
  });
  connection.addEventListener("close", (event) => {
    if (socket !== connection) return;
    socket = undefined;
    clearHeartbeat();
    if (event.code === 1008) {
      void getState().then((current) => replaceState({ serverUrl: current.serverUrl, connectionState: "not-paired", lastError: "Pairing was revoked or expired." }));
      return;
    }
    reconnectAttempt += 1;
    void updateState({ connectionState: "reconnecting", lastError: "Connection lost. Reconnecting…" });
    reconnectTimer = setTimeout(() => void restoreConnection(), Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5)));
  });
  connection.addEventListener("error", () => {
    if (socket === connection) void updateState({ connectionState: "error", lastError: "Cannot reach the Kanjiwritr server." });
  });
}

async function handleServerMessage(connection: WebSocket, value: unknown): Promise<void> {
  const message = parseServerMessage(value);
  if (!message) return;
  if (message.type === "connection.ready") {
    const state = await getState();
    if (!message.paired && !state.pairingCode) {
      await revokeRemote(state).catch(() => undefined);
      closeSocket();
      await replaceState({
        serverUrl: state.serverUrl,
        connectionState: "not-paired",
        lastError: "The previous pairing code is unavailable. Request a new one.",
      });
      return;
    }
    await updateState({
      connectionState: message.paired ? "online" : "waiting",
      ...(message.paired ? { pairingCode: undefined, pairingExpiresAt: undefined } : {}),
    });
    return;
  }
  if (message.type === "pairing.completed") {
    await updateState({
      connectionState: "online",
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      lastError: undefined,
    });
    return;
  }
  if (message.type !== "text.delivery") return;
  if (await wasDelivered(message.messageId)) {
    if (socket === connection && connection.readyState === WebSocket.OPEN) {
      connection.send(encodeClientMessage({ type: "delivery.ack", messageId: message.messageId, delivered: true }));
    }
    return;
  }
  const result = await insertIntoFocusedPage(message.text);
  if (result.delivered) await rememberDelivered(message.messageId);
  if (socket === connection && connection.readyState === WebSocket.OPEN) {
    connection.send(encodeClientMessage({
      type: "delivery.ack",
      messageId: message.messageId,
      delivered: result.delivered,
      ...(result.error ? { error: result.error } : {}),
    }));
  }
}

async function wasDelivered(messageId: string): Promise<boolean> {
  const stored = await chrome.storage.local.get("deliveredMessageIds");
  return Array.isArray(stored.deliveredMessageIds) && stored.deliveredMessageIds.includes(messageId);
}

async function rememberDelivered(messageId: string): Promise<void> {
  const stored = await chrome.storage.local.get("deliveredMessageIds");
  const ids = Array.isArray(stored.deliveredMessageIds)
    ? stored.deliveredMessageIds.filter((value): value is string => typeof value === "string")
    : [];
  await chrome.storage.local.set({ deliveredMessageIds: [...ids.slice(-99), messageId] });
}

async function insertIntoFocusedPage(text: string): Promise<{ delivered: boolean; error?: DeliveryError }> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return { delivered: false, error: "no_focused_field" };
  const destination = focusedFrame?.tabId === activeTab.id && Date.now() - focusedFrame.focusedAt < 30 * 60_000
    ? { frameId: focusedFrame.frameId }
    : undefined;
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "insert-text", text }, destination);
    return response?.inserted
      ? { delivered: true }
      : { delivered: false, error: "no_focused_field" };
  } catch {
    return { delivered: false, error: "page_restricted" };
  }
}

function closeSocket(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearHeartbeat();
  const previous = socket;
  socket = undefined;
  previous?.close();
}

function clearHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = undefined;
}

async function getState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(null);
  return { ...defaults, ...stored } as unknown as ExtensionState;
}

async function updateState(patch: StatePatch): Promise<void> {
  const state = { ...await getState(), ...patch };
  for (const key of Object.keys(patch) as (keyof ExtensionState)[]) {
    if (patch[key] === undefined) delete state[key];
  }
  await chrome.storage.local.set(state);
  await chrome.runtime.sendMessage({ type: "state.changed", state }).catch(() => undefined);
}

async function replaceState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.clear();
  await chrome.storage.local.set(state);
  await chrome.runtime.sendMessage({ type: "state.changed", state }).catch(() => undefined);
}

function normalizeServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http:// or https:// server URL.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

type PopupMessage =
  | { type: "state.get" }
  | { type: "pairing.request" }
  | { type: "server.save"; serverUrl: string }
  | { type: "pairing.unpair" };

function isPopupMessage(value: unknown): value is PopupMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "state.get" || value.type === "pairing.request" || value.type === "pairing.unpair") return true;
  return value.type === "server.save" && "serverUrl" in value && typeof value.serverUrl === "string";
}

function isFocusMessage(value: unknown): value is { type: "editable.focused" } {
  return !!value && typeof value === "object" && "type" in value && value.type === "editable.focused";
}
