import fs from "node:fs";
import path from "node:path";

export const CONFIG_KEYS = [
  "TG_COMMAND_POLL_MS",
  "POLL_INTERVAL_MS",
  "REQUEST_TIMEOUT_MS",
  "MAX_ALERTS_PER_CYCLE",
  "ALERT_COOLDOWN_MS",
  "PROXY_URL",
  "POLYMARKET_BASE_URL",
  "POLYMARKET_CATEGORY",
  "POLYMARKET_IGNORE_WORDS",
  "POLYMARKET_EVENTS_LIMIT",
  "POLYMARKET_PAGE_SIZE",
  "POLYMARKET_REQ_DELAY_MS",
  "POLYMARKET_MAX_RETRIES",
  "POLYMARKET_RETRY_BASE_MS",
  "POLYMARKET_MIN_LIQUIDITY",
  "MARKET_ENDDATE_MAX_PAST_HOURS",
  "ENABLE_VOLUME_SPIKE",
  "ENABLE_BIG_BUY",
  "ENABLE_NEW_MARKET",
  "ENABLE_PRICE_CHANGE",
  "VOLUME_SPIKE_USD_30M",
  "VOLUME_SPIKE_MIN_PCT_TOTAL_30M",
  "BIG_BUY_USD_10M",
  "BIG_BUY_MIN_PCT_TOTAL_10M",
  "PRICE_MOVE_ABS_10M",
  "NEW_MARKET_MIN_VOLUME_USD",
  "NEW_MARKET_MIN_LIQUIDITY_USD",
  "NEW_MARKET_MAX_AGE_HOURS",
  "PRICE_CHANGE_ABS_10M",
  "PRICE_CHANGE_MIN_VOLUME_USD_10M",
  "STATE_RETENTION_MINUTES",
  "DEBUG"
];

const KEY_SET = new Set(CONFIG_KEYS);

export const SENSITIVE_KEYS = new Set(["PROXY_URL"]);
const BOOLEAN_KEYS = new Set(["DEBUG", "ENABLE_VOLUME_SPIKE", "ENABLE_BIG_BUY", "ENABLE_NEW_MARKET", "ENABLE_PRICE_CHANGE"]);

export function loadRuntimeConfig(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (KEY_SET.has(k)) {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function saveRuntimeConfig(filePath, runtimeConfig) {
  const resolved = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const cleaned = {};
  for (const [k, v] of Object.entries(runtimeConfig || {})) {
    if (KEY_SET.has(k)) {
      cleaned[k] = v;
    }
  }

  const tmp = `${resolved}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cleaned, null, 2), "utf8");
  fs.renameSync(tmp, resolved);
}

export function parseAndApply(config, key, rawValue) {
  const value = String(rawValue ?? "").trim();

  switch (key) {
    case "PROXY_URL":
    case "POLYMARKET_BASE_URL":
    case "POLYMARKET_CATEGORY":
    case "POLYMARKET_IGNORE_WORDS":
      configProxy(config, key, value);
      return value;
    default: {
      if (BOOLEAN_KEYS.has(key)) {
        const bool = parseBool(value);
        applyBoolean(config, key, bool);
        return bool;
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
        throw new Error("value must be a number");
      }
      applyNumber(config, key, num);
      return num;
    }
  }
}

function configProxy(config, key, value) {
  if (key === "PROXY_URL") {
    config.proxyUrl = value;
  }
  if (key === "POLYMARKET_BASE_URL") {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (!normalized) {
      throw new Error("POLYMARKET_BASE_URL cannot be empty");
    }
    try {
      // Validate user input (must be absolute).
      new URL(normalized);
    } catch {
      throw new Error("POLYMARKET_BASE_URL must be a valid URL");
    }
    config.polymarketBaseUrl = normalized;
  }
  if (key === "POLYMARKET_CATEGORY") {
    config.polymarketCategory = value;
  }
  if (key === "POLYMARKET_IGNORE_WORDS") {
    config.polymarketIgnoreWords = value;
  }
}

function parseBool(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) {
    return false;
  }
  throw new Error("value must be boolean (true/false)");
}

function applyBoolean(config, key, bool) {
  switch (key) {
    case "DEBUG":
      config.debug = bool;
      return;
    case "ENABLE_VOLUME_SPIKE":
      config.enableVolumeSpike = bool;
      return;
    case "ENABLE_BIG_BUY":
      config.enableBigBuy = bool;
      return;
    case "ENABLE_NEW_MARKET":
      config.enableNewMarket = bool;
      return;
    case "ENABLE_PRICE_CHANGE":
      config.enablePriceChange = bool;
      return;
    default:
      throw new Error("unsupported key");
  }
}

function applyNumber(config, key, num) {
  switch (key) {
    case "TG_COMMAND_POLL_MS":
      config.tgCommandPollMs = Math.max(1_000, Math.floor(num));
      return;
    case "POLL_INTERVAL_MS":
      config.pollIntervalMs = Math.max(5_000, Math.floor(num));
      return;
    case "REQUEST_TIMEOUT_MS":
      config.requestTimeoutMs = Math.max(5_000, Math.floor(num));
      return;
    case "MAX_ALERTS_PER_CYCLE":
      config.maxAlertsPerCycle = Math.max(1, Math.floor(num));
      return;
    case "ALERT_COOLDOWN_MS":
      config.alertCooldownMs = Math.max(60_000, Math.floor(num));
      return;
    case "POLYMARKET_EVENTS_LIMIT":
      config.polymarketEventsLimit = Math.max(1, Math.floor(num));
      return;
    case "POLYMARKET_PAGE_SIZE":
      config.polymarketPageSize = Math.max(1, Math.floor(num));
      return;
    case "POLYMARKET_REQ_DELAY_MS":
      config.polymarketReqDelayMs = Math.max(0, Math.floor(num));
      return;
    case "POLYMARKET_MAX_RETRIES":
      config.polymarketMaxRetries = Math.max(0, Math.floor(num));
      return;
    case "POLYMARKET_RETRY_BASE_MS":
      config.polymarketRetryBaseMs = Math.max(50, Math.floor(num));
      return;
    case "POLYMARKET_MIN_LIQUIDITY":
      config.polymarketMinLiquidity = Math.max(0, num);
      return;
    case "MARKET_ENDDATE_MAX_PAST_HOURS":
      config.marketEndDateMaxPastHours = Math.max(0, num);
      return;
    case "VOLUME_SPIKE_USD_30M":
      config.volumeSpikeUsd30m = Math.max(0, num);
      return;
    case "VOLUME_SPIKE_MIN_PCT_TOTAL_30M":
      config.volumeSpikeMinPctOfTotal30m = clamp01(num);
      return;
    case "BIG_BUY_USD_10M":
      config.bigBuyVolumeUsd10m = Math.max(0, num);
      return;
    case "BIG_BUY_MIN_PCT_TOTAL_10M":
      config.bigBuyMinPctOfTotal10m = clamp01(num);
      return;
    case "PRICE_MOVE_ABS_10M":
      config.priceMoveAbs10m = clamp01(num);
      return;
    case "NEW_MARKET_MIN_VOLUME_USD":
      config.newMarketMinVolumeUsd = Math.max(0, num);
      return;
    case "NEW_MARKET_MIN_LIQUIDITY_USD":
      config.newMarketMinLiquidityUsd = Math.max(0, num);
      return;
    case "NEW_MARKET_MAX_AGE_HOURS":
      config.newMarketMaxAgeHours = Math.max(0, num);
      return;
    case "PRICE_CHANGE_ABS_10M":
      config.priceChangeAbs10m = clamp01(num);
      return;
    case "PRICE_CHANGE_MIN_VOLUME_USD_10M":
      config.priceChangeMinVolumeUsd10m = Math.max(0, num);
      return;
    case "STATE_RETENTION_MINUTES":
      config.stateRetentionMinutes = Math.max(10, Math.floor(num));
      return;
    default:
      throw new Error("unsupported key");
  }
}

function clamp01(x) {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.max(0, Math.min(1, x));
}

export function getEffectiveValue(config, key) {
  switch (key) {
    case "TG_COMMAND_POLL_MS":
      return config.tgCommandPollMs;
    case "POLL_INTERVAL_MS":
      return config.pollIntervalMs;
    case "REQUEST_TIMEOUT_MS":
      return config.requestTimeoutMs;
    case "MAX_ALERTS_PER_CYCLE":
      return config.maxAlertsPerCycle;
    case "ALERT_COOLDOWN_MS":
      return config.alertCooldownMs;
    case "PROXY_URL":
      return config.proxyUrl;
    case "POLYMARKET_BASE_URL":
      return config.polymarketBaseUrl;
    case "POLYMARKET_CATEGORY":
      return config.polymarketCategory;
    case "POLYMARKET_IGNORE_WORDS":
      return config.polymarketIgnoreWords;
    case "POLYMARKET_EVENTS_LIMIT":
      return config.polymarketEventsLimit;
    case "POLYMARKET_PAGE_SIZE":
      return config.polymarketPageSize;
    case "POLYMARKET_REQ_DELAY_MS":
      return config.polymarketReqDelayMs;
    case "POLYMARKET_MAX_RETRIES":
      return config.polymarketMaxRetries;
    case "POLYMARKET_RETRY_BASE_MS":
      return config.polymarketRetryBaseMs;
    case "POLYMARKET_MIN_LIQUIDITY":
      return config.polymarketMinLiquidity;
    case "MARKET_ENDDATE_MAX_PAST_HOURS":
      return config.marketEndDateMaxPastHours;
    case "ENABLE_VOLUME_SPIKE":
      return config.enableVolumeSpike;
    case "ENABLE_BIG_BUY":
      return config.enableBigBuy;
    case "ENABLE_NEW_MARKET":
      return config.enableNewMarket;
    case "VOLUME_SPIKE_USD_30M":
      return config.volumeSpikeUsd30m;
    case "VOLUME_SPIKE_MIN_PCT_TOTAL_30M":
      return config.volumeSpikeMinPctOfTotal30m;
    case "BIG_BUY_USD_10M":
      return config.bigBuyVolumeUsd10m;
    case "BIG_BUY_MIN_PCT_TOTAL_10M":
      return config.bigBuyMinPctOfTotal10m;
    case "PRICE_MOVE_ABS_10M":
      return config.priceMoveAbs10m;
    case "NEW_MARKET_MIN_VOLUME_USD":
      return config.newMarketMinVolumeUsd;
    case "NEW_MARKET_MIN_LIQUIDITY_USD":
      return config.newMarketMinLiquidityUsd;
    case "NEW_MARKET_MAX_AGE_HOURS":
      return config.newMarketMaxAgeHours;
    case "ENABLE_PRICE_CHANGE":
      return config.enablePriceChange;
    case "PRICE_CHANGE_ABS_10M":
      return config.priceChangeAbs10m;
    case "PRICE_CHANGE_MIN_VOLUME_USD_10M":
      return config.priceChangeMinVolumeUsd10m;
    case "STATE_RETENTION_MINUTES":
      return config.stateRetentionMinutes;
    case "DEBUG":
      return config.debug;
    default:
      return undefined;
  }
}

export function captureDefaults(config) {
  const defaults = {};
  for (const key of CONFIG_KEYS) {
    defaults[key] = getEffectiveValue(config, key);
  }
  return defaults;
}

export function applyDefault(config, key, defaults) {
  if (!defaults || !Object.hasOwn(defaults, key)) {
    throw new Error("no default value available");
  }
  parseAndApply(config, key, defaults[key]);
}
