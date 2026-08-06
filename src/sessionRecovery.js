export const AUTH_REQUIRED_CODE = "AUTH_REQUIRED";
export const SESSION_UNAVAILABLE_CODE = "SESSION_UNAVAILABLE";

export class SalesOsSessionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "SalesOsSessionError";
    this.code = code;
  }
}

export function isAuthRequiredError(error) {
  return error?.code === AUTH_REQUIRED_CODE;
}

export function withTimeout(promise, timeoutMs, message, code = "REQUEST_TIMEOUT") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SalesOsSessionError(code, message)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timer));
}

function errorText(error) {
  return `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`.toLowerCase();
}

function isDefinitelySignedOut(error) {
  const text = errorText(error);
  return text.includes("authsessionmissing")
    || text.includes("session missing")
    || text.includes("refresh token not found")
    || text.includes("invalid refresh token")
    || text.includes("refresh_token_not_found")
    || text.includes("invalid_refresh_token")
    || error?.status === 401;
}

function sessionFailure(error, fallbackMessage) {
  if (isDefinitelySignedOut(error)) {
    return new SalesOsSessionError(
      AUTH_REQUIRED_CODE,
      "Your secure session expired. Please sign in again.",
      error,
    );
  }
  return new SalesOsSessionError(SESSION_UNAVAILABLE_CODE, fallbackMessage, error);
}

async function authCall(work, timeoutMs, timeoutMessage) {
  try {
    return await withTimeout(
      Promise.resolve().then(work),
      timeoutMs,
      timeoutMessage,
      SESSION_UNAVAILABLE_CODE,
    );
  } catch (error) {
    if (error instanceof SalesOsSessionError) throw error;
    throw sessionFailure(error, timeoutMessage);
  }
}

export async function readSession(auth, { timeoutMs = 15_000 } = {}) {
  const result = await authCall(
    () => auth.getSession(),
    timeoutMs,
    "Sales OS could not check your secure session. Please try again.",
  );
  if (result?.error) {
    throw sessionFailure(
      result.error,
      "Sales OS could not check your secure session. Please try again.",
    );
  }
  return result?.data?.session || null;
}

const refreshPromises = new WeakMap();

export async function refreshSession(auth, { timeoutMs = 15_000 } = {}) {
  const existing = refreshPromises.get(auth);
  if (existing) return existing;

  const refreshPromise = (async () => {
    if (typeof auth?.refreshSession !== "function") {
      throw new SalesOsSessionError(
        AUTH_REQUIRED_CODE,
        "Your secure session expired. Please sign in again.",
      );
    }
    const result = await authCall(
      () => auth.refreshSession(),
      timeoutMs,
      "Sales OS could not renew your secure session. Please try again.",
    );
    const session = result?.data?.session;
    if (result?.error || !session?.access_token) {
      throw sessionFailure(
        result?.error,
        "Sales OS could not renew your secure session. Please try again.",
      );
    }
    return session;
  })();

  refreshPromises.set(auth, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    if (refreshPromises.get(auth) === refreshPromise) refreshPromises.delete(auth);
  }
}

export async function requireSession(auth, options = {}) {
  const session = await readSession(auth, options);
  if (session?.access_token) return session;
  return refreshSession(auth, options);
}

async function verifyUser(auth, accessToken, timeoutMs) {
  const result = await authCall(
    () => auth.getUser(accessToken),
    timeoutMs,
    "Sales OS could not verify your secure session. Please try again.",
  );
  if (result?.error || !result?.data?.user) {
    throw sessionFailure(
      result?.error,
      "Sales OS could not verify your secure session. Please try again.",
    );
  }
  return result.data.user;
}

export async function getVerifiedAuthUser(auth, { timeoutMs = 15_000 } = {}) {
  const session = await readSession(auth, { timeoutMs });
  if (!session?.access_token) return null;

  try {
    return await verifyUser(auth, session.access_token, timeoutMs);
  } catch {
    // A refresh covers both an expired token and a brief verification failure.
    const refreshed = await refreshSession(auth, { timeoutMs });
    return verifyUser(auth, refreshed.access_token, timeoutMs);
  }
}

function responseMessage(status, payload) {
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  if (status === 403) return "Your account is not approved to read this Sales OS data.";
  if (status === 429) return "Sales OS is receiving too many requests. Please try again shortly.";
  if (status >= 500) return "The secure Zoho data service is temporarily unavailable.";
  return "Zoho data could not be loaded.";
}

function isTransientStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502
    || status === 503 || status === 504;
}

async function pause(delayMs) {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The secure Zoho data service took too long to respond.");
    }
    throw new Error("Sales OS could not reach the secure Zoho data service.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export function createAuthorizedFunctionRequester({
  auth,
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 30_000,
  retryDelayMs = 300,
}) {
  if (!auth || !baseUrl || !apiKey || typeof fetchImpl !== "function") {
    throw new Error("The secure Supabase connection is not configured.");
  }

  async function send(url, accessToken, options) {
    return fetchWithTimeout(fetchImpl, url, {
      method: options.method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }, requestTimeoutMs);
  }

  return async function request(path, requestOptions = {}) {
    const options = {
      method: String(requestOptions.method || "GET").toUpperCase(),
      body: requestOptions.body,
    };
    const url = new URL(path, baseUrl).toString();
    let session = await requireSession(auth);
    let accessToken = session.access_token;
    let response = null;
    let authRecoveryUsed = false;
    let networkRetryUsed = false;
    let transientRetryUsed = false;

    while (true) {
      try {
        response = await send(url, accessToken, options);
      } catch (error) {
        if (networkRetryUsed) throw error;
        networkRetryUsed = true;
        await pause(retryDelayMs);
        continue;
      }

      if (response.status === 401) {
        if (authRecoveryUsed) {
          throw new SalesOsSessionError(
            AUTH_REQUIRED_CODE,
            "Your secure session expired. Please sign in again.",
          );
        }
        const currentSession = await readSession(auth);
        session = currentSession?.access_token && currentSession.access_token !== accessToken
          ? currentSession
          : await refreshSession(auth);
        accessToken = session.access_token;
        authRecoveryUsed = true;
        continue;
      }

      if (isTransientStatus(response.status) && !transientRetryUsed) {
        transientRetryUsed = true;
        await pause(retryDelayMs);
        continue;
      }
      break;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        throw new SalesOsSessionError(
          AUTH_REQUIRED_CODE,
          "Your secure session expired. Please sign in again.",
        );
      }
      throw new Error(responseMessage(response.status, payload));
    }
    return payload;
  };
}
