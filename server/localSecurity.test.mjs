import assert from "node:assert/strict";
import { isBlockedLocalPath, isLoopbackAddress } from "./localSecurity.mjs";

for (const requestUrl of [
  "/zohoapisales.md",
  "/@fs/C:/Users/example/zohoapisales.md",
  "/.data/zoho-hit-list.sqlite",
  "/.data/zoho-hit-list.sqlite-wal",
  "/.env.local",
  "/%2eenv",
  "/.git/config",
  "/nested/.git/HEAD",
  "/server/private.pem",
  "/.npmrc",
]) {
  assert.equal(isBlockedLocalPath(requestUrl), true, `${requestUrl} must be blocked`);
}

for (const requestUrl of ["/", "/src/App.jsx", "/api/zoho-hit-list", "/api/zoho-sales-deals", "/assets/data.json"]) {
  assert.equal(isBlockedLocalPath(requestUrl), false, `${requestUrl} must remain available`);
}

assert.equal(isLoopbackAddress("127.0.0.1"), true);
assert.equal(isLoopbackAddress("::1"), true);
assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
assert.equal(isLoopbackAddress("192.168.1.20"), false);

console.log("Local private-file and loopback security test passed.");
