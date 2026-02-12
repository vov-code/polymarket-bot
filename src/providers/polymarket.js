import { fetchJson } from "../http.js";

import { HttpError } from "../http.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(maxMs) {
  return Math.floor(Math.random() * Math.max(1, maxMs));
}

function isRetryableStatus(status) {
  return (
    status === 429 ||
    status === 408 ||
    status === 409 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function shouldFallbackToProxy(error) {
  // Proxy is meant as "only when needed" (blocked / no response), not as a generic
  // alternative route for normal 429/5xx backoffs.
  if (error instanceof HttpError) {
    return error.status === 403 || error.status === 407 || error.status === 451;
  }

  // Network / timeout / DNS / connect errors (undici) typically come as non-HttpError.
  const name = String(error?.name || "");
  const code = String(error?.code || "");
  if (name === "AbortError") {
    return true;
  }
  if (code.includes("TIMEOUT") || code.includes("ECONN") || code.includes("ENOTFOUND") || code.includes("EAI_AGAIN")) {
    return true;
  }
  return true;
}

async function fetchGammaJsonAttempt(url, config, useProxy) {
  const maxRetries = Math.max(0, Math.floor(config.polymarketMaxRetries));
  const base = Math.max(50, Math.floor(config.polymarketRetryBaseMs));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchJson(
        url,
        {
          headers: {
            accept: "application/json"
          }
        },
        config.requestTimeoutMs,
        { useProxy }
      );
    } catch (error) {
      const status = error instanceof HttpError ? error.status : null;
      const retryable = status !== null ? isRetryableStatus(status) : true;

      if (attempt >= maxRetries || !retryable) {
        throw error;
      }

      const retryAfter = error instanceof HttpError ? error.retryAfterMs : null;
      const backoff = base * Math.pow(2, attempt) + jitterMs(250);
      const wait = Math.min(60_000, Math.max(retryAfter || 0, backoff));

      if (config.debug) {
        console.log(
          `[poly] retry ${attempt + 1}/${maxRetries} in ${wait}ms (status=${status ?? "?"}, proxy=${useProxy ? "on" : "off"})`
        );
      }

      await sleep(wait);
    }
  }

  throw new Error("unreachable");
}

async function fetchGammaJson(url, config) {
  const proxyEnabled = Boolean(String(config.proxyUrl || "").trim());
  const now = Date.now();

  if (!config._polyProxyState) {
    config._polyProxyState = {
      forceProxyUntil: 0
    };
  }

  if (proxyEnabled && now < config._polyProxyState.forceProxyUntil) {
    return fetchGammaJsonAttempt(url, config, true);
  }

  try {
    return await fetchGammaJsonAttempt(url, config, false);
  } catch (error) {
    if (!proxyEnabled) {
      throw error;
    }

    if (!shouldFallbackToProxy(error)) {
      throw error;
    }

    // Avoid wasting time on repeated direct failures if Polymarket is blocked.
    config._polyProxyState.forceProxyUntil = now + 15 * 60_000;
    if (config.debug) {
      console.log("[poly] direct failed, switching to proxy (15m circuit)");
    }

    try {
      return await fetchGammaJsonAttempt(url, config, true);
    } catch (proxyError) {
      // If proxy also fails, don't lock ourselves into proxy-only mode.
      config._polyProxyState.forceProxyUntil = 0;
      throw proxyError;
    }
  }
}

function parseArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildOutcomes(market) {
  const outcomes = parseArray(market.outcomes || market.outcomeNames);
  const prices = parseArray(market.outcomePrices || market.prices);

  if (outcomes.length === 0 || prices.length === 0) {
    return [];
  }

  const result = [];
  const maxLen = Math.min(outcomes.length, prices.length);

  for (let i = 0; i < maxLen; i += 1) {
    const name = String(outcomes[i] || "").trim();
    const price = toNumber(prices[i]);

    if (!name || !price || price <= 0) {
      continue;
    }

    result.push({
      name,
      price,
      decimalOdds: 1 / price
    });
  }

  return result;
}

function isRecentEnough(endDate, maxPastHours) {
  if (!endDate) {
    return true;
  }

  const ts = Date.parse(endDate);
  if (!Number.isFinite(ts)) {
    return true;
  }

  const maxPastMs = maxPastHours * 60 * 60 * 1000;
  return ts >= Date.now() - maxPastMs;
}

function toMarket(event, market, config) {
  const outcomes = buildOutcomes(market);
  if (outcomes.length < 2) {
    return null;
  }

  const liquidityRaw = Number(market.liquidityNum ?? market.liquidity ?? 0);
  const liquidity = Number.isFinite(liquidityRaw) ? liquidityRaw : 0;
  if (Number.isFinite(config.polymarketMinLiquidity) && liquidity < config.polymarketMinLiquidity) {
    return null;
  }

  const endDate = market.endDate || event.endDate || "";
  if (!isRecentEnough(endDate, config.marketEndDateMaxPastHours)) {
    return null;
  }

  const volumeUsd = Number(market.volumeNum ?? market.volume ?? 0);
  const id = String(market.id || market.slug || "").trim();
  if (!id) {
    return null;
  }

  return {
    source: "polymarket",
    id,
    slug: market.slug || "",
    title: String(market.question || event.title || market.slug || "").trim(),
    eventTitle: String(event.title || "").trim(),
    url: market.slug ? `https://polymarket.com/market/${market.slug}` : "",
    startDate: market.startDate || event.startDate || "",
    endDate,
    liquidityUsd: liquidity,
    volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : 0,
    outcomes
  };
}

export async function getPolymarketMarkets(config) {
  const pageSize = Math.max(1, Math.floor(config.polymarketPageSize));
  const requestedLimit = Math.max(1, Math.floor(config.polymarketEventsLimit));
  const reqDelayMs = Math.max(0, Math.floor(config.polymarketReqDelayMs));

  // Conservative budget: sequential requests only, enforce a cap per polling interval.
  const minPerRequestMs = Math.max(250, reqDelayMs);
  const maxPagesThisCycle = Math.max(1, Math.floor(config.pollIntervalMs / minPerRequestMs));
  const limit = Math.min(requestedLimit, maxPagesThisCycle * pageSize);

  if (config.debug && limit !== requestedLimit) {
    console.log(
      `[poly] capping POLYMARKET_EVENTS_LIMIT from ${requestedLimit} to ${limit} to stay under rate budget (poll=${config.pollIntervalMs}ms, delay=${minPerRequestMs}ms)`
    );
  }
  const markets = [];

  for (let offset = 0; offset < limit; offset += pageSize) {
    const batchLimit = Math.min(pageSize, limit - offset);
    const url = `${config.polymarketBaseUrl}/events?active=true&closed=false&category=${encodeURIComponent(
      config.polymarketCategory
    )}&limit=${batchLimit}&offset=${offset}`;

    const events = await fetchGammaJson(url, config);

    if (!Array.isArray(events) || events.length === 0) {
      break;
    }

    for (const event of events) {
      if (!Array.isArray(event.markets)) {
        continue;
      }

      for (const market of event.markets) {
        if (!market || market.closed || market.active === false) {
          continue;
        }

        const parsed = toMarket(event, market, config);
        if (parsed) {
          markets.push(parsed);
        }
      }
    }

    if (events.length < batchLimit) {
      break;
    }

    if (reqDelayMs > 0) {
      await sleep(reqDelayMs);
    }
  }

  return markets;
}
