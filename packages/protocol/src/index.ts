export type DeviceRole = "writer" | "extension";
export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type DeliveryError =
  | "no_focused_field"
  | "page_restricted"
  | "peer_offline"
  | "delivery_timeout";
export type ProtocolErrorCode =
  | "invalid_message"
  | "message_too_large"
  | "unauthorized"
  | "wrong_device_role"
  | "duplicate_message"
  | "rate_limited";

export type ClientMessage =
  | { type: "ping" }
  | { type: "text.deliver"; messageId: string; text: string }
  | {
      type: "delivery.ack";
      messageId: string;
      delivered: boolean;
      error?: DeliveryError;
    };

export type ServerMessage =
  | {
      type: "connection.ready";
      connectionId: string;
      role: DeviceRole;
      paired: boolean;
    }
  | { type: "pong" }
  | { type: "pairing.completed" }
  | { type: "presence.changed"; extensionOnline: boolean }
  | { type: "text.delivery"; messageId: string; text: string }
  | {
      type: "delivery.result";
      messageId: string;
      delivered: boolean;
      error?: DeliveryError;
    }
  | { type: "protocol.error"; code: ProtocolErrorCode };

export interface PairingRequestResponse {
  code: string;
  token: string;
  expiresAt: string;
}

export interface PairingClaimResponse {
  token: string;
}

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
    parsed.type === "text.deliver" &&
    validId(parsed.messageId) &&
    typeof parsed.text === "string" &&
    parsed.text.trim().length > 0 &&
    [...parsed.text].length <= 4_000
  ) {
    return {
      type: "text.deliver",
      messageId: parsed.messageId,
      text: parsed.text,
    };
  }
  if (
    parsed.type === "delivery.ack" &&
    validId(parsed.messageId) &&
    typeof parsed.delivered === "boolean" &&
    (parsed.error === undefined || isDeliveryError(parsed.error))
  ) {
    return {
      type: "delivery.ack",
      messageId: parsed.messageId,
      delivered: parsed.delivered,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  }
  return undefined;
}

export function parseServerMessage(value: unknown): ServerMessage | undefined {
  const parsed = parseObject(value);
  if (!parsed || typeof parsed.type !== "string") return undefined;
  if (parsed.type === "pong") return { type: "pong" };
  if (parsed.type === "pairing.completed") return { type: "pairing.completed" };
  if (
    parsed.type === "connection.ready" &&
    typeof parsed.connectionId === "string" &&
    isDeviceRole(parsed.role) &&
    typeof parsed.paired === "boolean"
  ) {
    return {
      type: "connection.ready",
      connectionId: parsed.connectionId,
      role: parsed.role,
      paired: parsed.paired,
    };
  }
  if (
    parsed.type === "presence.changed" &&
    typeof parsed.extensionOnline === "boolean"
  ) {
    return {
      type: "presence.changed",
      extensionOnline: parsed.extensionOnline,
    };
  }
  if (
    parsed.type === "text.delivery" &&
    validId(parsed.messageId) &&
    typeof parsed.text === "string" &&
    parsed.text.length > 0
  ) {
    return {
      type: "text.delivery",
      messageId: parsed.messageId,
      text: parsed.text,
    };
  }
  if (
    parsed.type === "delivery.result" &&
    validId(parsed.messageId) &&
    typeof parsed.delivered === "boolean" &&
    (parsed.error === undefined || isDeliveryError(parsed.error))
  ) {
    return {
      type: "delivery.result",
      messageId: parsed.messageId,
      delivered: parsed.delivered,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  }
  if (parsed.type === "protocol.error" && isProtocolError(parsed.code)) {
    return { type: "protocol.error", code: parsed.code };
  }
  return undefined;
}

export function isDeviceRole(value: unknown): value is DeviceRole {
  return value === "writer" || value === "extension";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isDeliveryError(value: unknown): value is DeliveryError {
  return (
    value === "no_focused_field" ||
    value === "page_restricted" ||
    value === "peer_offline" ||
    value === "delivery_timeout"
  );
}

function isProtocolError(value: unknown): value is ProtocolErrorCode {
  return (
    value === "invalid_message" ||
    value === "message_too_large" ||
    value === "unauthorized" ||
    value === "wrong_device_role" ||
    value === "duplicate_message" ||
    value === "rate_limited"
  );
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  try {
    const candidate = typeof value === "string" ? JSON.parse(value) : value;
    return candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
