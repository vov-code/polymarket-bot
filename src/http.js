import { Agent, ProxyAgent } from "undici";

let initialized = false;
let directAgent = null;
let proxyAgent = null;
let currentProxyUrl = "";

export class HttpError extends Error {
  constructor(status, url, bodyPreview, retryAfterMs = null) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.bodyPreview = bodyPreview;
    this.retryAfterMs = retryAfterMs;
  }
}

function maskProxy(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "[invalid proxy url]";
  }
}

export function initHttp(proxyUrl) {
  const nextProxyUrl = String(proxyUrl || "");

  if (!directAgent) {
    directAgent = new Agent({ connect: { timeout: 30_000 } });
  }

  // Allow runtime updates (e.g. changed via Telegram /set PROXY_URL).
  if (initialized && nextProxyUrl === currentProxyUrl) {
    return;
  }

  if (proxyAgent && typeof proxyAgent.close === "function") {
    try {
      proxyAgent.close();
    } catch {
      // ignore
    }
  }

  currentProxyUrl = nextProxyUrl;

  if (nextProxyUrl) {
    proxyAgent = new ProxyAgent(nextProxyUrl);
    console.log(`[http] proxy configured (used only when a request opts-in): ${maskProxy(nextProxyUrl)}`);
  } else {
    proxyAgent = null;
    console.log("[http] proxy disabled");
  }

  initialized = true;
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) {
    return null;
  }

  const raw = String(headerValue).trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }

  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) {
    return null;
  }

  const delta = ts - Date.now();
  return delta > 0 ? delta : 0;
}

export async function fetchJson(url, options = {}, timeoutMs = 30_000, requestOptions = {}) {
  const useProxy = Boolean(requestOptions.useProxy);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = useProxy && proxyAgent ? proxyAgent : directAgent;

  try {
    const fetchOptions = {
      ...options,
      signal: controller.signal
    };

    // If initHttp() wasn't called, dispatcher can be null; don't pass it to undici.
    if (dispatcher) {
      fetchOptions.dispatcher = dispatcher;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const body = await response.text();
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw new HttpError(response.status, url, body.slice(0, 300), retryAfterMs);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
