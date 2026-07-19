import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const appSource = await readFile(path.join(root, "src", "App.jsx"), "utf8");

for (const forbidden of [
  /api\.anthropic\.com/i,
  /anthropic-dangerous-direct-browser-access/i,
  /api\.resend\.com\/emails/i,
  /function\s+switchUser\b/,
  /password\s*:\s*["'][^"']{6,}["']/i,
]) {
  assert.doesNotMatch(appSource, forbidden);
}
assert.match(appSource, /user\?\.mustChangePassword/);

const envExample = await readFile(path.join(root, ".env.example"), "utf8");
for (const line of envExample.split(/\r?\n/)) {
  if (!/^(ZOHO_CLIENT_SECRET|ZOHO_REFRESH_TOKEN|SUPABASE_SERVICE_ROLE_KEY|HIT_LIST_SYNC_SECRET)=/.test(line)) continue;
  assert.equal(line.split("=", 2)[1], "", "Secret examples must remain blank.");
}

const distDirectory = path.join(root, "dist", "assets");
try {
  for (const name of await readdir(distDirectory)) {
    if (!name.endsWith(".js")) continue;
    const bundledSource = await readFile(path.join(distDirectory, name), "utf8");
    assert.doesNotMatch(bundledSource, /ZOHO_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|HIT_LIST_SYNC_SECRET/);
    assert.doesNotMatch(bundledSource, /api\.anthropic\.com|api\.resend\.com\/emails/i);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log("Secret and browser-integration regression test passed.");
