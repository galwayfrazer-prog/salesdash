import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalHitListCache } from "./localHitListCache.mjs";

const rootDir = await mkdtemp(path.join(os.tmpdir(), "wv-hit-list-cache-"));

try {
  const dataDir = path.join(rootDir, "data");
  const firstCache = await createLocalHitListCache({ dataDir });
  const payload = {
    source: "test",
    generatedAt: "2026-07-17T12:00:00.000Z",
    counts: {
      dealsScanned: 2,
      opportunities: 1,
      missingSpotify: 1,
      missingMicrosoftStart: 0,
    },
    rows: [{ id: "creator-1:spotify", creator: "Creator One" }],
  };

  await firstCache.write(payload);
  firstCache.close();

  const reopenedCache = await createLocalHitListCache({ dataDir });
  const saved = await reopenedCache.readLatest();
  reopenedCache.close();

  assert.equal(saved.generatedAt, payload.generatedAt);
  assert.deepEqual(saved.payload, payload);
  console.log("Local Hit List cache test passed.");
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
