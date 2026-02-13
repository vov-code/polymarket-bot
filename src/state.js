﻿import fs from "node:fs";
import path from "node:path";

export function loadState(stateFile) {
  const resolved = path.resolve(process.cwd(), stateFile);
  if (!fs.existsSync(resolved)) {
    return {
      meta: {
        createdAt: Date.now(),
        bootstrapped: false,
        tgUpdateOffset: 0
      },
      markets: {}
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return {
        meta: {
          createdAt: Date.now(),
          bootstrapped: false,
          tgUpdateOffset: 0
        },
        markets: {}
      };
    }

    if (!parsed.meta || typeof parsed.meta !== "object") {
      parsed.meta = {
        createdAt: Date.now(),
        bootstrapped: Object.keys(parsed.markets || {}).length > 0,
        tgUpdateOffset: 0
      };
    }
    if (typeof parsed.meta.createdAt !== "number") {
      parsed.meta.createdAt = Date.now();
    }
    if (typeof parsed.meta.bootstrapped !== "boolean") {
      parsed.meta.bootstrapped = Object.keys(parsed.markets || {}).length > 0;
    }
    if (typeof parsed.meta.tgUpdateOffset !== "number") {
      parsed.meta.tgUpdateOffset = 0;
    }

    if (!parsed.markets || typeof parsed.markets !== "object") {
      parsed.markets = {};
    }

    return parsed;
  } catch {
    return {
      meta: {
        createdAt: Date.now(),
        bootstrapped: false,
        tgUpdateOffset: 0
      },
      markets: {}
    };
  }
}

export function saveState(stateFile, state) {
  const resolved = path.resolve(process.cwd(), stateFile);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${resolved}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
  fs.renameSync(tmp, resolved);
}

export async function saveStateAsync(stateFile, state) {
  const resolved = path.resolve(process.cwd(), stateFile);
  const dir = path.dirname(resolved);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmp = `${resolved}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(state), "utf8");
  await fs.promises.rename(tmp, resolved);
}
