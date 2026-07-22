import assert from "node:assert/strict";
import { fetchJsonWithRetry } from "../supabase/functions/_shared/fetchJson.mjs";

const originalFetch = globalThis.fetch;
let requests = 0;

try {
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(JSON.stringify({ error: "temporary" }), { status: 429 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const { response, payload } = await fetchJsonWithRetry("https://example.invalid", {}, {
    baseDelayMs: 0,
    timeoutMs: 1000,
  });

  assert.equal(requests, 2);
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true });
  console.log("Zoho request retry test passed.");
} finally {
  globalThis.fetch = originalFetch;
}
