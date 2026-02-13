﻿﻿﻿﻿﻿import fs from "node:fs";
import path from "node:path";

function loadDotEnv(dotEnvPath = ".env") {
  const resolved = path.resolve(process.cwd(), dotEnvPath);
  if (!fs.existsSync(resolved)) {
    return;
  }

  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!key || Object.hasOwn(process.env, key)) {
      continue;
    }

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }

  return parsed;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

loadDotEnv();

const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;
if (!token || !chatId) {
  throw new Error("TG_BOT_TOKEN and TG_CHAT_ID are required. Fill .env first.");
}

const config = {
  tgBotToken: token,
  tgChatId: chatId,
  tgAdminUserId: process.env.TG_ADMIN_USER_ID || "",
  tgCommandPollMs: readNumber("TG_COMMAND_POLL_MS", 5_000),

  pollIntervalMs: readNumber("POLL_INTERVAL_MS", 60_000),
  requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", 30_000),

  maxAlertsPerCycle: readNumber("MAX_ALERTS_PER_CYCLE", 10),
  alertCooldownMs: readNumber("ALERT_COOLDOWN_MS", 30 * 60_000),

  // Polymarket scan
  polymarketBaseUrl: String(process.env.POLYMARKET_BASE_URL || "https://gamma-api.polymarket.com").replace(/\/+$/, ""),
  polymarketCategory: String(process.env.POLYMARKET_CATEGORY || "").trim(),
  polymarketEventsLimit: readNumber("POLYMARKET_EVENTS_LIMIT", 3000),
  polymarketPageSize: readNumber("POLYMARKET_PAGE_SIZE", 100),
  polymarketReqDelayMs: readNumber("POLYMARKET_REQ_DELAY_MS", 0),
  polymarketMaxRetries: readNumber("POLYMARKET_MAX_RETRIES", 5),
  polymarketRetryBaseMs: readNumber("POLYMARKET_RETRY_BASE_MS", 750),
  polymarketMinLiquidity: readNumber("POLYMARKET_MIN_LIQUIDITY", 0),
  marketEndDateMaxPastHours: readNumber("MARKET_ENDDATE_MAX_PAST_HOURS", 12),

  // Signals
  enableVolumeSpike: readBoolean("ENABLE_VOLUME_SPIKE", true),
  enableBigBuy: readBoolean("ENABLE_BIG_BUY", true),
  enableNewMarket: readBoolean("ENABLE_NEW_MARKET", true),
  volumeSpikeUsd30m: readNumber("VOLUME_SPIKE_USD_30M", 20000),
  volumeSpikeMinPctOfTotal30m: readNumber("VOLUME_SPIKE_MIN_PCT_TOTAL_30M", 0.25),
  bigBuyVolumeUsd10m: readNumber("BIG_BUY_USD_10M", 10000),
  bigBuyMinPctOfTotal10m: readNumber("BIG_BUY_MIN_PCT_TOTAL_10M", 0.10),
  priceMoveAbs10m: readNumber("PRICE_MOVE_ABS_10M", 0.08),
  enablePriceChange: readBoolean("ENABLE_PRICE_CHANGE", true),
  priceChangeAbs10m: readNumber("PRICE_CHANGE_ABS_10M", 0.15),
  priceChangeMinVolumeUsd10m: readNumber("PRICE_CHANGE_MIN_VOLUME_USD_10M", 1000),

  // New market alert
  newMarketMinVolumeUsd: readNumber("NEW_MARKET_MIN_VOLUME_USD", 1),
  newMarketMinLiquidityUsd: readNumber("NEW_MARKET_MIN_LIQUIDITY_USD", 0),
  newMarketMaxAgeHours: readNumber("NEW_MARKET_MAX_AGE_HOURS", 24),

  // State
  stateFile: process.env.STATE_FILE || "data/state.json",
  stateRetentionMinutes: readNumber("STATE_RETENTION_MINUTES", 180),
  runtimeConfigFile: process.env.RUNTIME_CONFIG_FILE || "config/runtime.json",

  debug: readBoolean("DEBUG", false),

  // Optional proxy for Polymarket
  proxyUrl: String(process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim()
};

export default config;
