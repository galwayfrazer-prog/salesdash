import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";
import {
  getZohoHitList,
  getZohoSalesDeals,
  HIT_LIST_REFRESH_INTERVAL_MS,
  publicZohoError,
} from "./server/zohoHitList.mjs";
import { isBlockedLocalPath, isLoopbackAddress } from "./server/localSecurity.mjs";

function localZohoHitListApi({ mode }) {
  const env = loadEnv(mode, process.cwd(), "");
  const privateDirectory = path.resolve(
    env.WV_LOCAL_DATA_DIR || path.join(os.homedir(), ".wildvision-sales-os"),
  );
  const localCredentialFile = path.resolve(
    env.ZOHO_LOCAL_CREDENTIAL_FILE || path.join(privateDirectory, "zohoapisales.md"),
  );
  const localCacheDirectory = path.join(privateDirectory, "data");
  let cachePromise = null;

  function getCache() {
    if (!cachePromise) {
      cachePromise = import("./server/localHitListCache.mjs")
        .then(({ createLocalHitListCache }) => createLocalHitListCache({
          dataDir: localCacheDirectory,
        }));
    }
    return cachePromise;
  }

  async function loadHitList({ forceRefresh = false } = {}) {
    const cache = await getCache();
    return getZohoHitList({
      env,
      allowLocalCredentialFile: true,
      localCredentialFile,
      forceRefresh,
      cache,
    });
  }

  async function loadSalesDeals({ forceRefresh = false, ownerEmail = "", team = false, teamSummary = false } = {}) {
    const cache = await getCache();
    return getZohoSalesDeals({
      env,
      allowLocalCredentialFile: true,
      localCredentialFile,
      forceRefresh,
      cache,
      ownerEmail,
      team,
      teamSummary,
    });
  }

  return {
    name: "local-zoho-hit-list-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (isBlockedLocalPath(request.url)) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        next();
      });

      async function backgroundRefresh() {
        try {
          await loadHitList({ forceRefresh: true });
        } catch (error) {
          console.warn(`[hit-list] Background refresh skipped (${error?.code || "UNKNOWN"}).`);
        }
      }

      const refreshTimer = setInterval(backgroundRefresh, HIT_LIST_REFRESH_INTERVAL_MS);
      refreshTimer.unref?.();
      void backgroundRefresh();

      server.httpServer?.once("close", () => {
        clearInterval(refreshTimer);
        void getCache().then((cache) => cache.close());
      });

      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url || "/", "http://localhost");
        const isHitListRequest = requestUrl.pathname === "/api/zoho-hit-list";
        const isSalesDealsRequest = requestUrl.pathname === "/api/zoho-sales-deals";
        if (!isHitListRequest && !isSalesDealsRequest) return next();

        if (!isLoopbackAddress(request.socket.remoteAddress)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: "The local CRM endpoint is available only on this computer." }));
          return;
        }

        if (request.headers["x-wv-local-request"] !== "sales-os") {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: "This local CRM request was not created by Sales OS." }));
          return;
        }

        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");

        if (request.method !== "GET") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET");
          response.end(JSON.stringify({ error: "Only read-only GET requests are allowed." }));
          return;
        }

        try {
          const forceRefresh = requestUrl.searchParams.get("refresh") === "1";
          const payload = isHitListRequest
            ? await loadHitList({ forceRefresh })
            : await loadSalesDeals({
              forceRefresh,
              ownerEmail: requestUrl.searchParams.get("ownerEmail") || "",
              team: requestUrl.searchParams.get("scope") === "team",
              teamSummary: requestUrl.searchParams.get("scope") === "summary",
            });
          response.statusCode = 200;
          response.end(JSON.stringify(payload));
        } catch (error) {
          const safeError = publicZohoError(error);
          response.statusCode = safeError.status;
          response.end(JSON.stringify({ error: safeError.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localZohoHitListApi({ mode })],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@supabase") || id.includes("node_modules/@realtime")) {
            return "supabase";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.env*",
        "**/zohoapisales.md",
        "**/.data/**",
        "**/*.sqlite",
        "**/*.sqlite-wal",
        "**/*.sqlite-shm",
      ],
    },
  },
}));
