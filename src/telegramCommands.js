import { fetchJson, HttpError } from "./http.js";
import os from "node:os";
import {
  CONFIG_KEYS,
  SENSITIVE_KEYS,
  applyDefault,
  getEffectiveValue,
  loadRuntimeConfig,
  parseAndApply,
  saveRuntimeConfig
} from "./runtimeConfig.js";

const COMMANDS_VERSION = 2;
const COMMANDS = [
  { command: "help", description: "Справка и примеры" },
  { command: "config", description: "Текущие настройки (все)" },
  { command: "status", description: "Статус: последний скан, ошибки" },
  { command: "set", description: "Изменить настройку: /set KEY VALUE" },
  { command: "unset", description: "Убрать override: /unset KEY" },
  { command: "preset", description: "Готовые пресеты: conservative|balanced|aggressive" },
  { command: "on", description: "Включить сигналы: volume|bigbuy|new|all" },
  { command: "off", description: "Выключить сигналы: volume|bigbuy|new|all" },
  { command: "overrides", description: "Показать только overrides" },
  { command: "desc", description: "Описание ключа: /desc KEY" },
  { command: "get", description: "Показать значение: /get KEY" },
  { command: "keys", description: "Список ключей" },
  { command: "whoami", description: "Показать chat_id и user_id" },
  { command: "reset", description: "Сбросить все overrides" }
];

const KEY_INFO = {
  TG_COMMAND_POLL_MS: {
    desc: "Как часто бот проверяет команды конфигурации в Telegram (мс).",
    example: "/set TG_COMMAND_POLL_MS 5000"
  },
  POLL_INTERVAL_MS: {
    desc: "Интервал скана Polymarket (мс). Меньше = быстрее, но выше нагрузка/риск лимитов.",
    example: "/set POLL_INTERVAL_MS 60000"
  },
  REQUEST_TIMEOUT_MS: {
    desc: "Таймаут HTTP запросов (мс).",
    example: "/set REQUEST_TIMEOUT_MS 30000"
  },
  MAX_ALERTS_PER_CYCLE: {
    desc: "Максимум алертов за один цикл скана.",
    example: "/set MAX_ALERTS_PER_CYCLE 10"
  },
  ALERT_COOLDOWN_MS: {
    desc: "Кулдаун на повторный алерт по одному и тому же сигналу (мс).",
    example: "/set ALERT_COOLDOWN_MS 1800000"
  },
  PROXY_URL: {
    desc: "Прокси для Polymarket. Используется только как fallback при ошибках/блокировке.",
    example: "/set PROXY_URL http://user:pass@host:port"
  },
  POLYMARKET_BASE_URL: {
    desc: "Базовый URL Gamma API Polymarket.",
    example: "/set POLYMARKET_BASE_URL https://gamma-api.polymarket.com"
  },
  POLYMARKET_CATEGORY: {
    desc: "Категория событий Polymarket (например Sports, Politics). Оставьте пустым для всех.",
    example: "/set POLYMARKET_CATEGORY Sports"
  },
  POLYMARKET_EVENTS_LIMIT: {
    desc: "Лимит событий за цикл (автоматически урежется, чтобы не упираться по времени/лимитам).",
    example: "/set POLYMARKET_EVENTS_LIMIT 700"
  },
  POLYMARKET_PAGE_SIZE: {
    desc: "Размер страницы /events.",
    example: "/set POLYMARKET_PAGE_SIZE 50"
  },
  POLYMARKET_REQ_DELAY_MS: {
    desc: "Задержка между запросами к Polymarket (мс). Больше = безопаснее по лимитам.",
    example: "/set POLYMARKET_REQ_DELAY_MS 500"
  },
  POLYMARKET_MAX_RETRIES: {
    desc: "Количество ретраев для 429/5xx/timeout.",
    example: "/set POLYMARKET_MAX_RETRIES 5"
  },
  POLYMARKET_RETRY_BASE_MS: {
    desc: "База backoff для ретраев (мс), дальше экспоненциально.",
    example: "/set POLYMARKET_RETRY_BASE_MS 750"
  },
  POLYMARKET_MIN_LIQUIDITY: {
    desc: "Фильтр: не брать рынки с ликвидностью ниже этого значения.",
    example: "/set POLYMARKET_MIN_LIQUIDITY 0"
  },
  MARKET_ENDDATE_MAX_PAST_HOURS: {
    desc: "Фильтр: игнорировать рынки, закончившиеся более N часов назад.",
    example: "/set MARKET_ENDDATE_MAX_PAST_HOURS 12"
  },
  ENABLE_VOLUME_SPIKE: {
    desc: "Вкл/выкл сигнал Volume Spike.",
    example: "/set ENABLE_VOLUME_SPIKE true"
  },
  ENABLE_BIG_BUY: {
    desc: "Вкл/выкл сигнал Big Move (объем + движение цены).",
    example: "/set ENABLE_BIG_BUY true"
  },
  ENABLE_NEW_MARKET: {
    desc: "Вкл/выкл алерт по новым рынкам с большим объемом.",
    example: "/set ENABLE_NEW_MARKET true"
  },
  VOLUME_SPIKE_USD_30M: {
    desc: "Volume Spike: прирост объема за 30 минут (USD).",
    example: "/set VOLUME_SPIKE_USD_30M 5000"
  },
  VOLUME_SPIKE_MIN_PCT_TOTAL_30M: {
    desc: "Volume Spike: минимальная доля прироста от общего объема (0.01 = 1%).",
    example: "/set VOLUME_SPIKE_MIN_PCT_TOTAL_30M 0.01"
  },
  BIG_BUY_USD_10M: {
    desc: "Big Move: прирост объема за 10 минут (USD).",
    example: "/set BIG_BUY_USD_10M 5000"
  },
  BIG_BUY_MIN_PCT_TOTAL_10M: {
    desc: "Big Move: минимальная доля прироста от общего объема (0.01 = 1%).",
    example: "/set BIG_BUY_MIN_PCT_TOTAL_10M 0.01"
  },
  PRICE_MOVE_ABS_10M: {
    desc: "Big Move: минимальное абсолютное изменение цены исхода за 10 минут (0.08 = 8%).",
    example: "/set PRICE_MOVE_ABS_10M 0.08"
  },
  NEW_MARKET_MIN_VOLUME_USD: {
    desc: "New Market: мин. объем, чтобы алертить рынок при первом появлении.",
    example: "/set NEW_MARKET_MIN_VOLUME_USD 5000"
  },
  NEW_MARKET_MIN_LIQUIDITY_USD: {
    desc: "New Market: мин. ликвидность, чтобы алертить рынок при первом появлении.",
    example: "/set NEW_MARKET_MIN_LIQUIDITY_USD 0"
  },
  NEW_MARKET_MAX_AGE_HOURS: {
    desc: "New Market: игнорировать рынки, созданные более N часов назад (защита от спама старыми рынками).",
    example: "/set NEW_MARKET_MAX_AGE_HOURS 6"
  },
  STATE_RETENTION_MINUTES: {
    desc: "Сколько минут хранить историю сэмплов в state (влияет на размер state.json).",
    example: "/set STATE_RETENTION_MINUTES 180"
  },
  DEBUG: {
    desc: "Отладочные логи (true/false).",
    example: "/set DEBUG false"
  }
};

const GROUPS = [
  { title: "Telegram", keys: ["TG_COMMAND_POLL_MS"] },
  { title: "Polling", keys: ["POLL_INTERVAL_MS", "REQUEST_TIMEOUT_MS"] },
  { title: "Alerts", keys: ["MAX_ALERTS_PER_CYCLE", "ALERT_COOLDOWN_MS"] },
  {
    title: "Polymarket",
    keys: [
      "PROXY_URL",
      "POLYMARKET_BASE_URL",
      "POLYMARKET_CATEGORY",
      "POLYMARKET_EVENTS_LIMIT",
      "POLYMARKET_PAGE_SIZE",
      "POLYMARKET_REQ_DELAY_MS",
      "POLYMARKET_MAX_RETRIES",
      "POLYMARKET_RETRY_BASE_MS",
      "POLYMARKET_MIN_LIQUIDITY",
      "MARKET_ENDDATE_MAX_PAST_HOURS"
    ]
  },
  {
    title: "Signals",
    keys: [
      "ENABLE_VOLUME_SPIKE",
      "VOLUME_SPIKE_USD_30M",
      "VOLUME_SPIKE_MIN_PCT_TOTAL_30M",
      "ENABLE_BIG_BUY",
      "BIG_BUY_USD_10M",
      "BIG_BUY_MIN_PCT_TOTAL_10M",
      "PRICE_MOVE_ABS_10M",
      "ENABLE_NEW_MARKET",
      "NEW_MARKET_MIN_VOLUME_USD",
      "NEW_MARKET_MIN_LIQUIDITY_USD",
      "NEW_MARKET_MAX_AGE_HOURS"
    ]
  },
  { title: "State/Debug", keys: ["STATE_RETENTION_MINUTES", "DEBUG"] }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(maxMs) {
  return Math.floor(Math.random() * Math.max(1, maxMs));
}

function normalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function isAuthorized(config, message) {
  const chatId = String(message?.chat?.id ?? "");
  if (chatId !== String(config.tgChatId)) {
    return false;
  }
  if (config.tgAdminUserId) {
    const fromId = String(message?.from?.id ?? "");
    if (fromId !== String(config.tgAdminUserId)) {
      return false;
    }
  }
  return true;
}

function maskProxyUrl(proxyUrl) {
  const raw = String(proxyUrl || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "[invalid proxy url]";
  }
}

function formatValue(key, value) {
  if (key === "PROXY_URL") {
    return maskProxyUrl(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function formatMainSettings(config) {
  if (!config) return "⚠️ Config is missing";
  const lines = [];
  lines.push("Главное:");
  lines.push(`⏱ Скан: каждые ${Math.round(Number(config.pollIntervalMs || 0) / 1000)} сек`);
  lines.push(`🏷 Категория: ${String(config.polymarketCategory || "All")}`);
  lines.push(`🛰 Прокси: ${config.proxyUrl ? `настроен (fallback) ${maskProxyUrl(config.proxyUrl)}` : "выкл"}`);

  const vOn = config.enableVolumeSpike ? "вкл" : "выкл";
  const bOn = config.enableBigBuy ? "вкл" : "выкл";
  const nOn = config.enableNewMarket ? "вкл" : "выкл";
  lines.push(`📡 Сигналы: volume=${vOn}, bigbuy=${bOn}, new=${nOn}`);

  lines.push(
    `🔥 Volume spike: +$${config.volumeSpikeUsd30m} за 30м и >=${Math.round(config.volumeSpikeMinPctOfTotal30m * 1000) / 10}% от total`
  );
  lines.push(
    `🐳 Big move: +$${config.bigBuyVolumeUsd10m} за 10м и >=${Math.round(config.bigBuyMinPctOfTotal10m * 1000) / 10}% от total, price >=${Math.round(config.priceMoveAbs10m * 1000) / 10}pp`
  );
  lines.push(`🆕 New market: volume >=$${config.newMarketMinVolumeUsd}, age <=${config.newMarketMaxAgeHours}h`);
  return lines.join("\n");
}

async function tgCall(config, method, payload) {
  const url = `https://api.telegram.org/bot${config.tgBotToken}/${method}`;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const data = await fetchJson(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload || {})
        },
        config.requestTimeoutMs
      );
      if (!data?.ok) {
        throw new Error(`Telegram ${method} failed`);
      }
      return data;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : null;
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (attempt >= maxRetries || !retryable) {
        throw e;
      }
      const retryAfter = e instanceof HttpError ? e.retryAfterMs : null;
      const backoff = 500 * Math.pow(2, attempt) + jitterMs(250);
      const wait = Math.min(15_000, Math.max(retryAfter || 0, backoff));
      await sleep(wait);
    }
  }

  throw new Error("unreachable");
}

async function sendTelegramTo(config, chatId, text) {
  await tgCall(config, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

async function sendTelegram(config, text) {
  return sendTelegramTo(config, config.tgChatId, text);
}

async function getUpdates(config, offset) {
  const data = await tgCall(config, "getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message"]
  });
  return Array.isArray(data.result) ? data.result : [];
}

function formatCfg(config, runtime) {
  const lines = [];
  lines.push(formatMainSettings(config));
  lines.push("");
  lines.push("Все настройки (ключи с (override) изменены через Telegram):");

  for (const group of GROUPS) {
    const keys = group.keys.filter((k) => CONFIG_KEYS.includes(k));
    if (keys.length === 0) {
      continue;
    }

    lines.push("");
    lines.push(`[${group.title}]`);
    for (const key of keys) {
      const hasOverride = Object.hasOwn(runtime, key);
      const effective = getEffectiveValue(config, key);
      lines.push(`${key}=${formatValue(key, effective)}${hasOverride ? " (override)" : ""}`);
    }
  }

  lines.push("");
  lines.push("Команды: /help");
  return lines.join("\n");
}

function formatHelp(config) {
  if (!config) return "⚠️ Config is missing";
  const lines = [];
  lines.push(`🤖 Host: ${os.hostname()}`);
  lines.push("Команды:");
  lines.push("/config показать текущие настройки");
  lines.push("/status статус и ошибки");
  lines.push("/preset conservative|balanced|aggressive быстрый старт");
  lines.push("/set KEY VALUE изменить (пример ниже)");
  lines.push("/unset KEY вернуть дефолт");
  lines.push("/overrides только overrides");
  lines.push("/desc KEY что значит ключ");
  lines.push("/on volume|bigbuy|new|all включить сигналы");
  lines.push("/off volume|bigbuy|new|all выключить сигналы");
  lines.push("/whoami показать chat_id и user_id");
  lines.push("");
  lines.push("Текущие главные настройки:");
  lines.push(formatMainSettings(config));
  lines.push("");
  lines.push("Примеры:");
  lines.push("/preset balanced");
  lines.push("/set VOLUME_SPIKE_USD_30M 3000");
  lines.push("/set VOLUME_SPIKE_MIN_PCT_TOTAL_30M 0.01");
  lines.push("/set PRICE_MOVE_ABS_10M 0.08");
  return lines.join("\n");
}

function formatOverrides(runtime) {
  const keys = Object.keys(runtime || {}).filter((k) => CONFIG_KEYS.includes(k));
  keys.sort();
  if (keys.length === 0) {
    return "(no overrides set)";
  }
  const lines = ["Overrides:"];
  for (const key of keys) {
    const value = runtime[key];
    lines.push(SENSITIVE_KEYS.has(key) ? `${key}=(hidden)` : `${key}=${formatValue(key, value)}`);
  }
  return lines.join("\n");
}

function formatStatus(state) {
  const meta = state?.meta || {};
  const tracked = state?.markets ? Object.keys(state.markets).length : 0;
  const lines = [];
  lines.push("Status:");
  lines.push(`Tracked markets: ${tracked}`);
  if (typeof meta.lastScanAt === "number") {
    lines.push(`Last scan: ${new Date(meta.lastScanAt).toLocaleString()}`);
  }
  if (typeof meta.lastCycleMs === "number") {
    lines.push(`Last cycle ms: ${meta.lastCycleMs}`);
  }
  if (typeof meta.lastScanMarkets === "number") {
    lines.push(`Last scan markets: ${meta.lastScanMarkets}`);
  }
  if (typeof meta.lastScanNewMarkets === "number") {
    lines.push(`New markets this scan: ${meta.lastScanNewMarkets}`);
  }
  if (typeof meta.lastScanSignals === "number") {
    lines.push(`Signals this scan: ${meta.lastScanSignals}`);
  }
  if (typeof meta.lastScanAlertsSent === "number") {
    lines.push(`Alerts sent this scan: ${meta.lastScanAlertsSent}`);
  }
  if (typeof meta.lastScanRemovedMarkets === "number") {
    lines.push(`Pruned markets this scan: ${meta.lastScanRemovedMarkets}`);
  }
  if (typeof meta.lastErrorAt === "number") {
    lines.push(`Last error at: ${new Date(meta.lastErrorAt).toLocaleString()}`);
    if (meta.lastError) {
      lines.push(`Last error: ${String(meta.lastError).slice(0, 300)}`);
    }
  }
  return lines.join("\n");
}

function parseSetPairs(tokens) {
  const pairs = [];
  for (const t of tokens) {
    const idx = String(t).indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const k = normalizeKey(String(t).slice(0, idx));
    const v = String(t).slice(idx + 1);
    if (!k) {
      continue;
    }
    pairs.push([k, v]);
  }
  return pairs;
}

export async function ensureTelegramCommands(config, state) {
  const meta = state?.meta || (state.meta = {});
  if (meta.tgCommandsVersion === COMMANDS_VERSION) {
    return;
  }

  try {
    await tgCall(config, "setMyCommands", { commands: COMMANDS });
    meta.tgCommandsVersion = COMMANDS_VERSION;
    meta.tgCommandsUpdatedAt = Date.now();
  } catch (e) {
    // Don't fail the bot if Telegram is not reachable; just skip autocomplete.
  }
}

export async function pollTelegramCommands(config, state, defaults) {
  const runtime = loadRuntimeConfig(config.runtimeConfigFile);
  let offset = Number(state.meta?.tgUpdateOffset || 0);

  const updates = await getUpdates(config, offset);
  if (updates.length === 0) {
    return runtime;
  }

  for (const update of updates) {
    if (typeof update.update_id === "number") {
      offset = Math.max(offset, update.update_id + 1);
    }

    const message = update.message;
    const text = String(message?.text || "").trim();
    if (!text.startsWith("/")) {
      continue;
    }

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().split("@")[0];

    if (cmd === "/whoami" || cmd === "/id") {
      const chatId = String(message?.chat?.id ?? "");
      const fromId = String(message?.from?.id ?? "");
      await sendTelegramTo(config, chatId, `chat_id=${chatId}\nuser_id=${fromId}`);
      continue;
    }

    if (!isAuthorized(config, message)) {
      continue;
    }

    try {
      if (cmd === "/help" || cmd === "/start") {
        await sendTelegram(config, formatHelp(config));
        continue;
      }

      if (cmd === "/cfg" || cmd === "/config") {
        await sendTelegram(config, formatCfg(config, runtime));
        continue;
      }

      if (cmd === "/overrides") {
        await sendTelegram(config, formatOverrides(runtime));
        continue;
      }

      if (cmd === "/status") {
        await sendTelegram(config, formatStatus(state));
        continue;
      }

      if (cmd === "/keys") {
        await sendTelegram(config, `Keys:\n${CONFIG_KEYS.join("\n")}`);
        continue;
      }

      if (cmd === "/desc") {
        const key = normalizeKey(parts[1]);
        if (!CONFIG_KEYS.includes(key)) {
          throw new Error("unknown key");
        }
        const info = KEY_INFO[key];
        const effective = getEffectiveValue(config, key);
        const hasOverride = Object.hasOwn(runtime, key);
        const def = defaults && Object.hasOwn(defaults, key) ? defaults[key] : undefined;
        const lines = [];
        lines.push(`${key}`);
        if (info?.desc) {
          lines.push(info.desc);
        }
        if (info?.example) {
          lines.push(`Example: ${info.example}`);
        }
        lines.push(`Current: ${formatValue(key, effective)}${hasOverride ? " (override)" : ""}`);
        if (def !== undefined) {
          lines.push(`Default: ${formatValue(key, def)}`);
        }
        await sendTelegram(config, lines.join("\n"));
        continue;
      }

      if (cmd === "/get") {
        const key = normalizeKey(parts[1]);
        if (!CONFIG_KEYS.includes(key)) {
          throw new Error("unknown key");
        }
        const effective = getEffectiveValue(config, key);
        const hasOverride = Object.hasOwn(runtime, key);
        await sendTelegram(config, `${key}=${formatValue(key, effective)}${hasOverride ? " (override)" : ""}`);
        continue;
      }

      if (cmd === "/set") {
        const tokens = parts.slice(1);
        if (tokens.length === 0) {
          throw new Error("usage: /set KEY VALUE  OR  /set KEY=VALUE");
        }

        const pairs = parseSetPairs(tokens);
        if (pairs.length >= 1) {
          const results = [];
          for (const [k, v] of pairs) {
            if (!CONFIG_KEYS.includes(k)) {
              results.push(`- ${k}: unknown key`);
              continue;
            }
            try {
              const parsedValue = parseAndApply(config, k, v);
              runtime[k] = parsedValue;
              results.push(`- ${k}: OK`);
            } catch (e) {
              results.push(`- ${k}: Error: ${e.message || e}`);
            }
          }
          saveRuntimeConfig(config.runtimeConfigFile, runtime);
          await sendTelegram(config, `Set results:\n${results.join("\n")}`);
          continue;
        }

        const key = normalizeKey(tokens[0]);
        const value = tokens.slice(1).join(" ");
        if (!CONFIG_KEYS.includes(key)) {
          throw new Error("unknown key");
        }
        if (!String(value || "").trim()) {
          throw new Error("missing VALUE");
        }

        const parsedValue = parseAndApply(config, key, value);
        runtime[key] = parsedValue;
        saveRuntimeConfig(config.runtimeConfigFile, runtime);
        await sendTelegram(config, SENSITIVE_KEYS.has(key) ? `OK set ${key} (hidden)` : `OK set ${key}=${formatValue(key, parsedValue)}`);
        continue;
      }

      if (cmd === "/unset") {
        const key = normalizeKey(parts[1]);
        if (!CONFIG_KEYS.includes(key)) {
          throw new Error("unknown key");
        }
        delete runtime[key];
        saveRuntimeConfig(config.runtimeConfigFile, runtime);
        applyDefault(config, key, defaults);
        await sendTelegram(config, `OK unset ${key} (reverted to startup default)`);
        continue;
      }

      if (cmd === "/reset") {
        for (const key of CONFIG_KEYS) {
          delete runtime[key];
          try {
            applyDefault(config, key, defaults);
          } catch {
            // ignore
          }
        }
        saveRuntimeConfig(config.runtimeConfigFile, runtime);
        await sendTelegram(config, "OK reset all overrides");
        continue;
      }

      if (cmd === "/preset") {
        const name = String(parts[1] || "").trim().toLowerCase();
        const presets = {
          conservative: {
            VOLUME_SPIKE_USD_30M: 10000,
            VOLUME_SPIKE_MIN_PCT_TOTAL_30M: 0.02,
            BIG_BUY_USD_10M: 10000,
            BIG_BUY_MIN_PCT_TOTAL_10M: 0.02,
            PRICE_MOVE_ABS_10M: 0.1,
            NEW_MARKET_MIN_VOLUME_USD: 5000,
            MAX_ALERTS_PER_CYCLE: 6
          },
          balanced: {
            VOLUME_SPIKE_USD_30M: 5000,
            VOLUME_SPIKE_MIN_PCT_TOTAL_30M: 0.01,
            BIG_BUY_USD_10M: 5000,
            BIG_BUY_MIN_PCT_TOTAL_10M: 0.01,
            PRICE_MOVE_ABS_10M: 0.08,
            NEW_MARKET_MIN_VOLUME_USD: 1000,
            MAX_ALERTS_PER_CYCLE: 10
          },
          aggressive: {
            POLL_INTERVAL_MS: 3000,
            POLYMARKET_REQ_DELAY_MS: 100,
            VOLUME_SPIKE_USD_30M: 2500,
            VOLUME_SPIKE_MIN_PCT_TOTAL_30M: 0.01,
            BIG_BUY_USD_10M: 2500,
            BIG_BUY_MIN_PCT_TOTAL_10M: 0.01,
            PRICE_MOVE_ABS_10M: 0.06,
            NEW_MARKET_MIN_VOLUME_USD: 5000,
            MAX_ALERTS_PER_CYCLE: 15
          }
        };

        const preset = presets[name];
        if (!preset) {
          throw new Error("usage: /preset conservative|balanced|aggressive");
        }

        const results = [];
        for (const [k, v] of Object.entries(preset)) {
          try {
            const parsedValue = parseAndApply(config, k, v);
            runtime[k] = parsedValue;
            results.push(`- ${k}: OK`);
          } catch (e) {
            results.push(`- ${k}: Error: ${e.message || e}`);
          }
        }
        saveRuntimeConfig(config.runtimeConfigFile, runtime);
        await sendTelegram(config, `OK preset ${name}\n${results.join("\n")}`);
        continue;
      }

      if (cmd === "/on" || cmd === "/off") {
        const mode = cmd === "/on";
        const target = String(parts[1] || "").trim().toLowerCase();
        const map = { volume: "ENABLE_VOLUME_SPIKE", bigbuy: "ENABLE_BIG_BUY", new: "ENABLE_NEW_MARKET" };
        const keys =
          target === "all"
            ? ["ENABLE_VOLUME_SPIKE", "ENABLE_BIG_BUY", "ENABLE_NEW_MARKET"]
            : map[target]
              ? [map[target]]
              : [];
        if (keys.length === 0) {
          throw new Error("usage: /on volume|bigbuy|new|all  OR  /off volume|bigbuy|new|all");
        }
        for (const k of keys) {
          const parsedValue = parseAndApply(config, k, mode ? "true" : "false");
          runtime[k] = parsedValue;
        }
        saveRuntimeConfig(config.runtimeConfigFile, runtime);
        await sendTelegram(config, `OK ${mode ? "enabled" : "disabled"} ${target}`);
        continue;
      }
    } catch (e) {
      try {
        await sendTelegram(config, `Error: ${e.message || e}`);
      } catch (sendErr) {
        // Если не удалось отправить ошибку в Telegram, просто логируем (или игнорируем),
        // чтобы не сломать цикл обработки и обновить offset.
        console.error("Failed to send error to Telegram:", sendErr);
      }
    }
  }

  state.meta.tgUpdateOffset = offset;
  return runtime;
}
