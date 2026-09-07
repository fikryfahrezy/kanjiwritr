import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/rate-limiter";

describe("RateLimiter", () => {
  test("enforces the configured maximum when enabled", () => {
    const limiter = new RateLimiter();
    expect(limiter.allow("pairing", 1, 60_000)).toBe(true);
    expect(limiter.allow("pairing", 1, 60_000)).toBe(false);
  });

  test("allows unlimited attempts when explicitly disabled", () => {
    const limiter = new RateLimiter(false);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(limiter.allow("pairing", 1, 60_000)).toBe(true);
    }
  });

  test("retains entries for a configured window longer than one hour", () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    expect(limiter.allow("pairing", 1, 2 * 60 * 60_000)).toBe(true);
    limiter.cleanup(now + 60 * 60_000, 2 * 60 * 60_000);
    expect(limiter.allow("pairing", 1, 2 * 60 * 60_000)).toBe(false);
  });
});
