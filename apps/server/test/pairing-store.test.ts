import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PairingStore } from "../src/pairing-store";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("PairingStore", () => {
  test("issues separate device credentials and consumes a code once", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanjiwritr-store-"));
    directories.push(directory);
    const path = join(directory, "pairing.sqlite");
    const store = new PairingStore(path, "test-only-secret");
    const requested = store.createPairing();
    const claimed = store.claimPairing(requested.code);

    expect(requested.code).toHaveLength(8);
    expect(claimed?.token).toBeString();
    expect(claimed?.token).not.toBe(requested.token);
    expect(store.claimPairing(requested.code)).toBeUndefined();
    expect(store.authenticate(requested.token)?.role).toBe("extension");
    expect(store.authenticate(claimed!.token)?.role).toBe("writer");

    const database = new Database(path, { readonly: true });
    const serializedRows = JSON.stringify(database.query("SELECT * FROM pairings JOIN devices ON pairings.id = devices.pairing_id").all());
    expect(serializedRows).not.toContain(requested.code);
    expect(serializedRows).not.toContain(requested.token);
    expect(serializedRows).not.toContain(claimed!.token);
    database.close();
    store.close();
  });

  test("revokes both sides of a pairing", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanjiwritr-store-"));
    directories.push(directory);
    const store = new PairingStore(join(directory, "pairing.sqlite"), "test-only-secret");
    const requested = store.createPairing();
    const claimed = store.claimPairing(requested.code)!;
    const pairingId = store.authenticate(requested.token)!.pairingId;

    store.revokePairing(pairingId);

    expect(store.authenticate(requested.token)).toBeUndefined();
    expect(store.authenticate(claimed.token)).toBeUndefined();
    store.close();
  });

  test("rejects an expired pairing code", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanjiwritr-store-"));
    directories.push(directory);
    const path = join(directory, "pairing.sqlite");
    const store = new PairingStore(path, "test-only-secret");
    const requested = store.createPairing();
    const database = new Database(path);
    database.run("UPDATE pairings SET expires_at = ?", [Date.now() - 1]);
    database.close();

    expect(store.claimPairing(requested.code)).toBeUndefined();
    store.close();
  });

  test("renames the legacy writing-device role", () => {
    const directory = mkdtempSync(join(tmpdir(), "kanjiwritr-store-"));
    directories.push(directory);
    const path = join(directory, "pairing.sqlite");
    const database = new Database(path);
    database.exec(`
      CREATE TABLE pairings (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        pairing_id TEXT NOT NULL REFERENCES pairings(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('ipad', 'extension')),
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER,
        UNIQUE(pairing_id, role)
      );
      CREATE INDEX devices_pairing_index ON devices(pairing_id);
    `);
    database.close();

    const store = new PairingStore(path, "test-only-secret");
    const requested = store.createPairing();
    const claimed = store.claimPairing(requested.code)!;

    expect(store.authenticate(claimed.token)?.role).toBe("writer");
    store.close();
  });
});
