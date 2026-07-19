function retryDelayMs(response, attempt, baseDelayMs) {
  const retryAfterSeconds = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, 5000);
  }
  return Math.min(baseDelayMs * (2 ** attempt), 2000);
}

function delay(milliseconds) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchJsonWithRetry(
  url,
  options = {},
  { attempts = 3, timeoutMs = 20000, baseDelayMs = 250 } = {},
) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => ({}));
      const retryable = response.status === 429 || response.status >= 500;

      if (retryable && attempt < attempts - 1) {
        await delay(retryDelayMs(response, attempt, baseDelayMs));
        continue;
      }

      return { response, payload };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await delay(Math.min(baseDelayMs * (2 ** attempt), 2000));
        continue;
      }
    }
  }

  throw lastError || new Error("Request failed.");
}
