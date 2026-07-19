export function isBlockedLocalPath(requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(requestUrl || "/", "http://localhost").pathname)
      .replaceAll("\\", "/")
      .toLowerCase();
  } catch {
    return true;
  }

  return /(?:^|\/)zohoapisales\.md$/.test(pathname)
    || /(?:^|\/)\.env(?:\.|$)/.test(pathname)
    || /(?:^|\/)\.git(?:\/|$)/.test(pathname)
    || /(?:^|\/)\.(?:npmrc|yarnrc\.yml)$/.test(pathname)
    || /\.(?:crt|pem|key|p12|pfx|cer|der)$/.test(pathname)
    || /(?:^|\/)\.data(?:\/|$)/.test(pathname)
    || /(?:^|\/)zoho-hit-list\.sqlite(?:-wal|-shm)?$/.test(pathname);
}

export function isLoopbackAddress(address = "") {
  const normalised = String(address).toLowerCase();
  return normalised === "127.0.0.1"
    || normalised === "::1"
    || normalised === "::ffff:127.0.0.1";
}
