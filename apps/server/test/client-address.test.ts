import { describe, expect, test } from "bun:test";
import { clientAddress } from "../src/client-address";

describe("clientAddress", () => {
  test("uses the direct address by default", () => {
    const request = new Request("https://example.test", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    expect(clientAddress(request, "192.0.2.20", false)).toBe("192.0.2.20");
  });

  test("uses Cloudflare's address when explicitly trusted", () => {
    const request = new Request("https://example.test", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });
    expect(clientAddress(request, "192.0.2.20", true)).toBe("203.0.113.10");
  });

  test("accepts a Cloudflare IPv6 address", () => {
    const request = new Request("https://example.test", {
      headers: { "cf-connecting-ip": "2001:db8::10" },
    });
    expect(clientAddress(request, "192.0.2.20", true)).toBe("2001:db8::10");
  });

  test("rejects an invalid Cloudflare address", () => {
    const request = new Request("https://example.test", {
      headers: { "cf-connecting-ip": "not-an-ip" },
    });
    expect(clientAddress(request, "192.0.2.20", true)).toBe("192.0.2.20");
  });
});
