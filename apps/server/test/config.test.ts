import { describe, expect, test } from "bun:test";
import { positiveInteger, rateLimitConfig } from "../src/config";

describe("rate limit configuration", () => {
  test("uses defaults", () => {
    expect(rateLimitConfig({}, "PAIRING", 8, 3_600)).toEqual({
      maximum: 8,
      windowMs: 3_600_000,
    });
  });

  test("reads maximum and window seconds", () => {
    expect(
      rateLimitConfig(
        {
          PAIRING_RATE_LIMIT_MAX: "12",
          PAIRING_RATE_LIMIT_WINDOW_SECONDS: "120",
        },
        "PAIRING",
        8,
        3_600,
      ),
    ).toEqual({ maximum: 12, windowMs: 120_000 });
  });

  test("rejects invalid values", () => {
    expect(() => positiveInteger("0", 8, "LIMIT")).toThrow(
      "LIMIT must be a positive integer",
    );
    expect(() => positiveInteger("1.5", 8, "LIMIT")).toThrow(
      "LIMIT must be a positive integer",
    );
  });
});
