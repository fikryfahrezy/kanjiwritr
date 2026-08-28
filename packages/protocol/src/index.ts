export type ConnectionState = "connecting" | "connected" | "disconnected";

export type ClientMessage =
  | { type: "ping" }
  | { type: "text.preview"; messageId: string; text: string };

export type ServerMessage =
  | { type: "connection.ready"; connectionId: string }
  | { type: "pong" }
  | { type: "text.received"; messageId: string }
  | { type: "protocol.error"; code: "invalid_message" | "message_too_large" };

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function parseClientMessage(value: unknown): ClientMessage | undefined {
  const parsed = parseObject(value);
  if (!parsed || typeof parsed.type !== "string") return undefined;
  if (parsed.type === "ping") return { type: "ping" };
  if (
    parsed.type === "text.preview"
    && typeof parsed.messageId === "string"
    && parsed.messageId.length > 0
    && typeof parsed.text === "string"
    && parsed.text.trim().length > 0
  ) {
    return { type: "text.preview", messageId: parsed.messageId, text: parsed.text };
  }
  return undefined;
}

export function parseServerMessage(value: unknown): ServerMessage | undefined {
  const parsed = parseObject(value);
  if (!parsed || typeof parsed.type !== "string") return undefined;
  if (parsed.type === "pong") return { type: "pong" };
  if (parsed.type === "connection.ready" && typeof parsed.connectionId === "string") {
    return { type: "connection.ready", connectionId: parsed.connectionId };
  }
  if (parsed.type === "text.received" && typeof parsed.messageId === "string") {
    return { type: "text.received", messageId: parsed.messageId };
  }
  if (
    parsed.type === "protocol.error"
    && (parsed.code === "invalid_message" || parsed.code === "message_too_large")
  ) {
    return { type: "protocol.error", code: parsed.code };
  }
  return undefined;
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  try {
    const candidate = typeof value === "string" ? JSON.parse(value) : value;
    return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
