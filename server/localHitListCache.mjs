import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATABASE_NAME = "zoho-hit-list.sqlite";
const DEFAULT_PRIVATE_DIRECTORY = path.join(os.homedir(), ".wildvision-sales-os");

export async function createLocalHitListCache({
  dataDir = path.join(DEFAULT_PRIVATE_DIRECTORY, "data"),
} = {}) {
  await mkdir(dataDir, { recursive: true });

  const databasePath = path.join(dataDir, DATABASE_NAME);
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS hit_list_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hit_list_snapshots_generated_at_idx
      ON hit_list_snapshots (generated_at DESC);
  `);

  const latestStatement = database.prepare(`
    SELECT generated_at, payload_json
    FROM hit_list_snapshots
    ORDER BY generated_at DESC, id DESC
    LIMIT 1
  `);
  const insertStatement = database.prepare(`
    INSERT INTO hit_list_snapshots (generated_at, payload_json)
    VALUES (?, ?)
  `);
  const pruneStatement = database.prepare(`
    DELETE FROM hit_list_snapshots
    WHERE id NOT IN (
      SELECT id
      FROM hit_list_snapshots
      ORDER BY generated_at DESC, id DESC
      LIMIT 12
    )
  `);

  return {
    databasePath,
    async readLatest() {
      const row = latestStatement.get();
      if (!row) return null;

      try {
        return {
          generatedAt: row.generated_at,
          payload: JSON.parse(row.payload_json),
        };
      } catch {
        return null;
      }
    },
    async write(payload) {
      insertStatement.run(payload.generatedAt, JSON.stringify(payload));
      pruneStatement.run();
    },
    close() {
      database.close();
    },
  };
}
