﻿function normalizeOutcomeKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function closestAtOrBefore(samples, cutoffTs) {
  let best = null;
  for (const s of samples) {
    if (!s || typeof s.t !== "number") {
      continue;
    }
    if (s.t <= cutoffTs && (!best || s.t > best.t)) {
      best = s;
    }
  }
  return best;
}

function computeMaxPriceMove(current, past) {
  let best = null;
  const currPrices = current.prices || {};
  const pastPrices = past.prices || {};

  for (const [key, currPrice] of Object.entries(currPrices)) {
    const prevPrice = pastPrices[key];
    if (typeof prevPrice !== "number" || typeof currPrice !== "number") {
      continue;
    }

    const delta = currPrice - prevPrice;
    const abs = Math.abs(delta);
    
    // Если движения равны по силе (например Yes +0.10, No -0.10),
    // отдаем приоритет тому, что выросло (delta > 0), так как это цель покупки.
    if (!best || abs > best.absDelta || (Math.abs(abs - best.absDelta) < 1e-9 && delta > best.delta)) {
      best = { key, delta, absDelta: abs, prevPrice, currPrice };
    }
  }

  return best;
}

export function upsertMarketSample(state, market, nowTs, retentionMs) {
  const id = market.id;
  const isNew = !state.markets[id];
  if (isNew) {
    state.markets[id] = { meta: {}, samples: [], alerts: {} };
  }

  const entry = state.markets[id];
  entry.lastSeenTs = nowTs;
  entry.meta = {
    title: market.title,
    eventTitle: market.eventTitle,
    url: market.url
  };

  const prices = {};
  for (const outcome of market.outcomes) {
    const key = normalizeOutcomeKey(outcome.name);
    if (!key) {
      continue;
    }
    if (typeof outcome.price === "number" && Number.isFinite(outcome.price)) {
      prices[key] = outcome.price;
    }
  }

  entry.samples.push({ t: nowTs, volumeUsd: market.volumeUsd, prices });

  const cutoff = nowTs - retentionMs;
  while (entry.samples.length > 0 && entry.samples[0].t < cutoff) {
    entry.samples.shift();
  }

  return isNew;
}

export function computeSignalsForMarket(entry, nowTs, config) {
  const samples = entry.samples || [];
  if (samples.length < 2) {
    return { volumeSpike: null, bigBuy: null, priceChange: null };
  }

  const current = samples[samples.length - 1];
  const currentVolume = typeof current.volumeUsd === "number" ? current.volumeUsd : 0;

  const thirtyMinAgo = closestAtOrBefore(samples, nowTs - 30 * 60_000);
  const tenMinAgo = closestAtOrBefore(samples, nowTs - 10 * 60_000);
  const tolMs = Math.max(5 * 60_000, 2 * Math.max(1_000, Number(config.pollIntervalMs || 0)));

  let volumeSpike = null;
  if (thirtyMinAgo && nowTs - thirtyMinAgo.t <= 30 * 60_000 + tolMs) {
    const fromVolumeUsd = Number(thirtyMinAgo.volumeUsd || 0);
    const toVolumeUsd = Number(current.volumeUsd || 0);
    const delta = toVolumeUsd - fromVolumeUsd;
    const pctOfTotal = currentVolume > 0 ? delta / currentVolume : 0;
    if (
      Number.isFinite(delta) &&
      delta >= config.volumeSpikeUsd30m &&
      pctOfTotal >= config.volumeSpikeMinPctOfTotal30m
    ) {
      const move = computeMaxPriceMove(current, thirtyMinAgo);
      volumeSpike = {
        deltaUsd: delta,
        pctOfTotal,
        fromTs: thirtyMinAgo.t,
        fromVolumeUsd,
        toVolumeUsd,
        outcomeKey: move ? move.key : null,
        deltaPrice: move ? move.delta : 0,
        prevPrice: move ? move.prevPrice : 0,
        currPrice: move ? move.currPrice : 0
      };
    }
  }

  let bigBuy = null;
  let priceChange = null;
  if (tenMinAgo && nowTs - tenMinAgo.t <= 10 * 60_000 + tolMs) {
    const fromVolumeUsd = Number(tenMinAgo.volumeUsd || 0);
    const toVolumeUsd = Number(current.volumeUsd || 0);
    const volDelta = toVolumeUsd - fromVolumeUsd;
    const pctOfTotal = currentVolume > 0 ? volDelta / currentVolume : 0;
    const move = computeMaxPriceMove(current, tenMinAgo);

    if (
      move &&
      Number.isFinite(volDelta) &&
      volDelta >= config.bigBuyVolumeUsd10m &&
      pctOfTotal >= config.bigBuyMinPctOfTotal10m &&
      move.absDelta >= config.priceMoveAbs10m
    ) {
      bigBuy = {
        volumeDeltaUsd: volDelta,
        pctOfTotal,
        fromVolumeUsd,
        toVolumeUsd,
        outcomeKey: move.key,
        deltaPrice: move.delta,
        prevPrice: move.prevPrice,
        currPrice: move.currPrice,
        fromTs: tenMinAgo.t
      };
    }

    if (
      config.enablePriceChange &&
      move &&
      move.absDelta >= config.priceChangeAbs10m &&
      volDelta >= config.priceChangeMinVolumeUsd10m
    ) {
      priceChange = {
        outcomeKey: move.key,
        deltaPrice: move.delta,
        prevPrice: move.prevPrice,
        currPrice: move.currPrice,
        volumeDeltaUsd: volDelta
      };
    }
  }

  return { volumeSpike, bigBuy, priceChange };
}

export function shouldSendAlert(entry, alertKey, nowTs, cooldownMs) {
  const alerts = entry.alerts || (entry.alerts = {});
  const prev = alerts[alertKey] || 0;
  if (nowTs - prev < cooldownMs) {
    return false;
  }
  alerts[alertKey] = nowTs;
  return true;
}
