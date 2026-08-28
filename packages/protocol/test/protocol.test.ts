import { describe, expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage } from "../src";

describe("protocol parsing", () => {
  test("accepts a valid preview message", () => {
    expect(parseClientMessage(JSON.stringify({
      type: "text.preview",
      messageId: "message-1",
      text: "日本語",
    }))).toEqual({ type: "text.preview", messageId: "message-1", text: "日本語" });
  });

  test("rejects empty text and malformed JSON", () => {
    expect(parseClientMessage('{"type":')).toBeUndefined();
    expect(parseClientMessage({
      type: "text.preview",
      messageId: "message-1",
      text: "   ",
    })).toBeUndefined();
  });

  test("accepts server acknowledgements", () => {
    expect(parseServerMessage('{"type":"text.received","messageId":"message-1"}'))
      .toEqual({ type: "text.received", messageId: "message-1" });
  });
});
