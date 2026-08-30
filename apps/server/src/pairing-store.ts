import { Database } from "bun:sqlite";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DeviceRole,
  PairingClaimResponse,
  PairingRequestResponse,
} from "@kanjiwritr/protocol";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_TTL_MS = 10 * 60_000;

interface DeviceRow {
  device_id: string;
  pairing_id: string;
  role: DeviceRole;
  paired: number;
}

interface PairingRow {
  id: string;
  expires_at: number;
}

export interface AuthenticatedDevice {
  deviceId: string;
  pairingId: string;
  role: DeviceRole;
  paired: boolean;
}

export class PairingStore {
  private readonly database: Database;

  constructor(
    path: string,
    private readonly credentialSecret: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true, strict: true });
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        pairing_id TEXT NOT NULL REFERENCES pairings(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('writer', 'extension')),
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER,
        UNIQUE(pairing_id, role)
      );
      CREATE INDEX IF NOT EXISTS devices_pairing_index ON devices(pairing_id);
      CREATE INDEX IF NOT EXISTS pairings_expiry_index ON pairings(expires_at);
    `);
    this.migrateLegacyWriterRole();
  }

  createPairing(): PairingRequestResponse {
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = crypto.randomUUID();
      const code = randomCode();
      const token = randomToken();
      try {
        this.database.transaction(() => {
          this.database.run(
            "INSERT INTO pairings (id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
            [id, this.codeHash(code), now, now + CODE_TTL_MS],
          );
          this.database.run(
            "INSERT INTO devices (id, pairing_id, role, token_hash, created_at) VALUES (?, ?, 'extension', ?, ?)",
            [crypto.randomUUID(), id, tokenHash(token), now],
          );
        })();
        return {
          code,
          token,
          expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
        };
      } catch (cause) {
        if (attempt === 4) throw cause;
      }
    }
    throw new Error("Could not allocate a pairing code");
  }

  claimPairing(code: string): PairingClaimResponse | undefined {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length !== 8) return undefined;
    const now = Date.now();
    const pairing = this.database
      .query<PairingRow, [string, number]>(`
      SELECT id, expires_at FROM pairings
      WHERE code_hash = ? AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    `)
      .get(this.codeHash(normalized), now);
    if (!pairing) return undefined;

    const token = randomToken();
    try {
      this.database.transaction(() => {
        const updated = this.database.run(
          "UPDATE pairings SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
          [now, pairing.id, now],
        );
        if (updated.changes !== 1)
          throw new Error("Pairing code was already used");
        this.database.run(
          "INSERT INTO devices (id, pairing_id, role, token_hash, created_at) VALUES (?, ?, 'writer', ?, ?)",
          [crypto.randomUUID(), pairing.id, tokenHash(token), now],
        );
      })();
      return { token };
    } catch {
      return undefined;
    }
  }

  authenticate(token: string): AuthenticatedDevice | undefined {
    if (token.length < 32 || token.length > 256) return undefined;
    const row = this.database
      .query<DeviceRow, [string]>(`
      SELECT d.id AS device_id, d.pairing_id, d.role, CASE WHEN p.claimed_at IS NULL THEN 0 ELSE 1 END AS paired
      FROM devices d
      JOIN pairings p ON p.id = d.pairing_id
      WHERE d.token_hash = ? AND d.revoked_at IS NULL AND p.revoked_at IS NULL
    `)
      .get(tokenHash(token));
    return row
      ? {
          deviceId: row.device_id,
          pairingId: row.pairing_id,
          role: row.role,
          paired: row.paired === 1,
        }
      : undefined;
  }

  touch(deviceId: string): void {
    this.database.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [
      Date.now(),
      deviceId,
    ]);
  }

  revokePairing(pairingId: string): void {
    const now = Date.now();
    this.database.transaction(() => {
      this.database.run(
        "UPDATE pairings SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        [now, pairingId],
      );
      this.database.run(
        "UPDATE devices SET revoked_at = ? WHERE pairing_id = ? AND revoked_at IS NULL",
        [now, pairingId],
      );
    })();
  }

  cleanup(): void {
    const retentionCutoff = Date.now() - 7 * 24 * 60 * 60_000;
    this.database.run(
      "DELETE FROM pairings WHERE (expires_at < ? AND claimed_at IS NULL) OR revoked_at < ?",
      [Date.now(), retentionCutoff],
    );
  }

  close(): void {
    this.database.close();
  }

  private codeHash(code: string): string {
    return createHmac("sha256", this.credentialSecret)
      .update(code)
      .digest("hex");
  }

  private migrateLegacyWriterRole(): void {
    const table = this.database
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'",
      )
      .get();
    if (!table?.sql?.includes("'ipad'")) return;

    this.database.run("PRAGMA foreign_keys = OFF");
    try {
      this.database.transaction(() => {
        this.database.exec(`
          ALTER TABLE devices RENAME TO devices_legacy_writer_role;
          CREATE TABLE devices (
            id TEXT PRIMARY KEY,
            pairing_id TEXT NOT NULL REFERENCES pairings(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('writer', 'extension')),
            token_hash TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER,
            revoked_at INTEGER,
            UNIQUE(pairing_id, role)
          );
          INSERT INTO devices (id, pairing_id, role, token_hash, created_at, last_seen_at, revoked_at)
          SELECT id, pairing_id, CASE role WHEN 'ipad' THEN 'writer' ELSE role END,
                 token_hash, created_at, last_seen_at, revoked_at
          FROM devices_legacy_writer_role;
          DROP TABLE devices_legacy_writer_role;
          CREATE INDEX devices_pairing_index ON devices(pairing_id);
        `);
      })();
    } finally {
      this.database.run("PRAGMA foreign_keys = ON");
    }
  }
}

function randomCode(): string {
  const bytes = randomBytes(8);
  return [...bytes]
    .map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length])
    .join("");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
