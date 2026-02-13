﻿﻿﻿import config from "./config.js";
import http from "node:http";
import { initHttp, fetchJson } from "./http.js";
import { getPolymarketMarkets } from "./providers/polymarket.js";
import { loadState, saveState, saveStateAsync } from "./state.js";
import { computeSignalsForMarket, shouldSendAlert, upsertMarketSample } from "./signals.js";
import { captureDefaults, loadRuntimeConfig, parseAndApply } from "./runtimeConfig.js";
import { ensureTelegramCommands, pollTelegramCommands } from "./telegramCommands.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function formatMoney(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return "0";
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPct01(x, digits = 1) {
  const v = Number(x);
  if (!Number.isFinite(v)) {
    return "0%";
  }
  return `${round(v * 100, digits)}%`;
}

function formatProb(price) {
  const p = Number(price);
  if (!Number.isFinite(p)) {
    return "0%";
  }
  return `${round(p * 100, 1)}%`;
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${config.tgBotToken}/sendMessage`;
  await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: config.tgChatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    },
    config.requestTimeoutMs
  );
}

function buildAlertText(meta, signal) {
  const lines = [];
  const header =
    signal.kind === "volume_spike"
      ? "🔥 Volume spike"
      : signal.kind === "big_buy"
        ? "🐳 Big move"
        : signal.kind === "price_change"
          ? "🚀 Price Pump"
        : signal.kind === "new_market"
          ? "🆕 New market"
          : "Polymarket signal";
  lines.push(header);
  if (meta.eventTitle) {
    lines.push(`Event: ${meta.eventTitle}`);
  }
  lines.push(`Market: <a href="${meta.url}">${meta.title}</a>`);

  if (signal.kind === "volume_spike") {
    lines.push(
      `💰 Volume (30m): $${formatMoney(signal.fromVolumeUsd)} -> $${formatMoney(signal.toVolumeUsd)} (+$${formatMoney(signal.deltaUsd)}, ${formatPct01(signal.pctOfTotal, 1)} of total)`
    );
    if (signal.outcomeKey) {
      const up = signal.deltaPrice > 0;
      const arrow = up ? "📈" : "📉";
      const pp = round(Math.abs(signal.deltaPrice) * 100, 1);
      lines.push(`🎯 Outcome: ${signal.outcomeKey} (${arrow} ${pp}pp)`);
    }
  }

  if (signal.kind === "big_buy") {
    const up = signal.deltaPrice > 0;
    const arrow = up ? "📈" : "📉";
    const pp = round(Math.abs(signal.deltaPrice) * 100, 1);
    lines.push(`🎯 Outcome: ${signal.outcomeKey}`);
    lines.push(`Price (10m): ${formatProb(signal.prevPrice)} -> ${formatProb(signal.currPrice)} (${arrow} ${pp}pp)`);
    lines.push(
      `💰 Volume (10m): $${formatMoney(signal.fromVolumeUsd)} -> $${formatMoney(signal.toVolumeUsd)} (+$${formatMoney(signal.volumeDeltaUsd)}, ${formatPct01(signal.pctOfTotal, 1)} of total)`
    );
  }

  if (signal.kind === "price_change") {
    const up = signal.deltaPrice > 0;
    const arrow = up ? "🚀" : "🔻";
    const pp = round(Math.abs(signal.deltaPrice) * 100, 1);
    lines.push(`🎯 Outcome: ${signal.outcomeKey}`);
    lines.push(`Price (10m): ${formatProb(signal.prevPrice)} -> ${formatProb(signal.currPrice)} (${arrow} ${pp}pp)`);
  }

  if (signal.kind === "new_market") {
    lines.push(`💰 Volume: $${formatMoney(signal.volumeUsd)}`);
    lines.push(`💧 Liquidity: $${formatMoney(signal.liquidityUsd)}`);
  }

  return lines.join("\n");
}

async function runOnce(state, keepAlive) {
  const markets = await getPolymarketMarkets(config, keepAlive);
  console.log(`[scan] polymarket markets: ${markets.length}`);

  const nowTs = Date.now();
  const retentionMs = Math.max(10, config.stateRetentionMinutes) * 60_000;
  const isBootstrapped = Boolean(state.meta?.bootstrapped);

  const signals = [];
  let newMarketsSeen = 0;
  let loopCount = 0;

  for (const market of markets) {
    // Yield to command polling every 1000 markets to stay responsive during heavy CPU loops
    loopCount++;
    if (keepAlive && loopCount % 5000 === 0) {
      await keepAlive();
    }

    const isNew = upsertMarketSample(state, market, nowTs, retentionMs);
    if (isNew) {
      newMarketsSeen += 1;
    }

    const entry = state.markets[market.id];

    // 1. Check for "new market" signal
    const createdTs = market.createdAtTs || 0;
    const ageHours = createdTs > 0 ? (nowTs - createdTs) / 3_600_000 : 999;
    const hasAlertedNew = entry?.alerts?.["new_market"];

    if (
      config.enableNewMarket &&
      isBootstrapped &&
      !hasAlertedNew &&
      market.volumeUsd >= config.newMarketMinVolumeUsd &&
      market.liquidityUsd >= config.newMarketMinLiquidityUsd &&
      ageHours <= config.newMarketMaxAgeHours
    ) {
      signals.push({
        marketId: market.id,
        kind: "new_market",
        volumeUsd: market.volumeUsd,
        liquidityUsd: market.liquidityUsd
      });
    }

    // 2. Compute other signals (volume, big buy, price change)
    const computed = computeSignalsForMarket(entry, nowTs, config);

    if (config.enableVolumeSpike && computed.volumeSpike) {
      signals.push({
        marketId: market.id,
        kind: "volume_spike",
        ...computed.volumeSpike
      });
    }

    if (config.enableBigBuy && computed.bigBuy) {
      signals.push({
        marketId: market.id,
        kind: "big_buy",
        ...computed.bigBuy
      });
    }

    if (config.enablePriceChange && computed.priceChange) {
      signals.push({
        marketId: market.id,
        kind: "price_change",
        ...computed.priceChange
      });
    }
  }

  for (const s of signals) {
    if (typeof s.score === "number") {
      continue;
    }
    if (s.kind === "volume_spike") {
      s.score = s.deltaUsd;
    } else if (s.kind === "big_buy") {
      s.score = s.volumeDeltaUsd;
    } else if (s.kind === "price_change") {
      s.score = Math.abs(s.deltaPrice) * 100000; // High score for price moves
    } else if (s.kind === "new_market") {
      s.score = s.volumeUsd;
    } else {
      s.score = 0;
    }
  }

  signals.sort((a, b) => (b.score || 0) - (a.score || 0));

  if (signals.length === 0) {
    console.log("[scan] no signals");
  }

  const selected = signals.length === 0 ? [] : signals.slice(0, Math.max(1, config.maxAlertsPerCycle));
  let alertsSent = 0;

  for (const signal of selected) {
    const entry = state.markets[signal.marketId];
    if (!entry) {
      continue;
    }

    let alertKey = signal.kind;
    if (signal.kind === "big_buy" || signal.kind === "price_change") {
      // Unique alert per outcome to avoid spamming same move
      alertKey = `${signal.kind}:${signal.outcomeKey}`;
    }

    if (!shouldSendAlert(entry, alertKey, nowTs, config.alertCooldownMs)) {
      continue;
    }

    try {
      await sendTelegram(buildAlertText(entry.meta, signal));
      alertsSent += 1;
      console.log(`[alert] sent: ${signal.marketId} ${signal.kind}`);
    } catch (e) {
      const msg = String(e?.stack || e?.message || e);
      console.error(`[alert] telegram send failed: ${msg}`);
      state.meta.lastErrorAt = Date.now();
      state.meta.lastError = msg;
      break;
    }
  }

  // Prune state to avoid unbounded growth: drop markets not seen within retention window.
  const cutoffTs = nowTs - retentionMs;
  let removed = 0;
  for (const [id, entry] of Object.entries(state.markets || {})) {
    if (!entry || typeof entry.lastSeenTs !== "number") {
      continue;
    }
    if (entry.lastSeenTs < cutoffTs) {
      delete state.markets[id];
      removed += 1;
    }
  }

  state.meta.lastScanAt = nowTs;
  state.meta.lastScanMarkets = markets.length;
  state.meta.lastScanNewMarkets = newMarketsSeen;
  state.meta.lastScanSignals = signals.length;
  state.meta.lastScanAlertsSent = alertsSent;
  state.meta.lastScanRemovedMarkets = removed;
}

async function main() {
  console.log("[boot] polymarket watcher started");

  // Health check server for hosting (Render/Railway require binding to a port)
  const port = process.env.PORT || 8080;
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Polymarket Bot is running");
  }).listen(port, () => console.log(`[server] listening on port ${port}`));

  const state = loadState(config.stateFile);
  const defaults = captureDefaults(config);

  try {
    await ensureTelegramCommands(config, state);
    saveState(config.stateFile, state);
  } catch {
    // ignore
  }

  const runtime = loadRuntimeConfig(config.runtimeConfigFile);
  for (const [k, v] of Object.entries(runtime)) {
    try {
      parseAndApply(config, k, v);
    } catch (e) {
      console.error(`[runtime] failed to apply ${k}: ${e.message || e}`);
    }
  }

  initHttp(config.proxyUrl);

  async function pollCommands() {
    try {
      const beforeOffset = Number(state.meta?.tgUpdateOffset || 0);
      await pollTelegramCommands(config, state, defaults);
      const afterOffset = Number(state.meta?.tgUpdateOffset || 0);
      if (afterOffset !== beforeOffset) {
        // Persist update offset promptly to avoid re-processing commands after a crash.
        saveState(config.stateFile, state);
      }
      // Apply proxy changes without restart if PROXY_URL was updated.
      initHttp(config.proxyUrl);
    } catch (e) {
      console.error(`[tg] ${e.message || e}`);
    }
  }

  const keepAlive = async () => {
    await pollCommands();
  };

  if (process.env.RUN_ONCE === "1") {
    const startedAt = Date.now();
    await pollCommands();
    await runOnce(state, keepAlive);
    state.meta.bootstrapped = true;
    state.meta.lastCycleMs = Date.now() - startedAt;
    saveState(config.stateFile, state);
    return;
  }

  // Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\n[boot] shutting down, saving state...");
    saveState(config.stateFile, state);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    const startedAt = Date.now();

    try {
      await pollCommands();
      await runOnce(state, keepAlive);
      state.meta.bootstrapped = true;
      state.meta.lastCycleMs = Date.now() - startedAt;
      await saveStateAsync(config.stateFile, state);
    } catch (error) {
      console.error(`[scan] ${error.message}`);
      state.meta.lastErrorAt = Date.now();
      state.meta.lastError = String(error?.stack || error?.message || error);
      await saveStateAsync(config.stateFile, state);
    }

    const elapsed = Date.now() - startedAt;
    let wait = Math.max(1_000, config.pollIntervalMs - elapsed);
    const stepMs = Math.max(1_000, Math.floor(config.tgCommandPollMs || 5_000));
    while (wait > 0) {
      const step = Math.min(wait, stepMs);
      await sleep(step);
      wait -= step;
      await pollCommands();
    }
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exit(1);
});
