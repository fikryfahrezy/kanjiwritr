export class RateLimiter {
  private readonly entries = new Map<string, number[]>();

  constructor(private readonly enabled = true) {}

  allow(key: string, maximum: number, windowMs: number): boolean {
    if (!this.enabled) return true;
    const now = Date.now();
    const recent = (this.entries.get(key) ?? []).filter(
      (timestamp) => timestamp > now - windowMs,
    );
    if (recent.length >= maximum) {
      this.entries.set(key, recent);
      return false;
    }
    recent.push(now);
    this.entries.set(key, recent);
    return true;
  }

  cleanup(now: number): void {
    for (const [key, timestamps] of this.entries) {
      const recent = timestamps.filter(
        (timestamp) => timestamp > now - 60 * 60_000,
      );
      if (recent.length === 0) this.entries.delete(key);
      else this.entries.set(key, recent);
    }
  }
}
