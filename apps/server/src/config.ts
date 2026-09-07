export interface RateLimitConfig {
  maximum: number;
  windowMs: number;
}

export function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function rateLimitConfig(
  environment: Record<string, string | undefined>,
  prefix: "PAIRING" | "CLAIM" | "WEBSOCKET",
  defaultMaximum: number,
  defaultWindowSeconds: number,
): RateLimitConfig {
  const maximumName = `${prefix}_RATE_LIMIT_MAX`;
  const windowName = `${prefix}_RATE_LIMIT_WINDOW_SECONDS`;
  return {
    maximum: positiveInteger(
      environment[maximumName],
      defaultMaximum,
      maximumName,
    ),
    windowMs:
      positiveInteger(
        environment[windowName],
        defaultWindowSeconds,
        windowName,
      ) * 1_000,
  };
}
