# tg-polymarket-watcher

Telegram bot that scans Polymarket and sends alerts when it detects interesting activity:

- Volume increased sharply over the last 30 minutes
- Large short-term move in outcome price combined with volume (proxy for a big buy)
- New markets that already have high volume/liquidity (after the first scan)

## Install

```bash
npm install
```

## Configure

1. Create `.env` from `.env.example`.
2. Fill `TG_BOT_TOKEN` and `TG_CHAT_ID`.
3. Optional: set `PROXY_URL` if Polymarket is blocked in your region.

### Runtime Config From Telegram

You can change most thresholds and polling settings without editing `.env`.
The bot stores overrides in `config/runtime.json` and applies them immediately.

Commands:

- `/cfg` show effective config (overridden keys are marked)
- `/whoami` show `chat_id` and `user_id`
- `/overrides` show only runtime overrides
- `/status` last scan stats
- `/get KEY` show one key
- `/set KEY VALUE` set override
- `/set KEY=VALUE` short form
- `/set KEY1=V1 KEY2=V2` set multiple at once
- `/unset KEY` revert to startup default (from `.env` at process start)
- `/reset` clear all overrides
- `/preset conservative|balanced|aggressive` quick presets
- `/on volume|bigbuy|new|all` enable signals
- `/off volume|bigbuy|new|all` disable signals
- `/keys` list supported keys
- `/desc KEY` describe key

Notes:

- Secrets like `TG_BOT_TOKEN` / `TG_CHAT_ID` are not configurable via Telegram.
- `PROXY_URL` is treated as sensitive and never echoed back in full.
- If you run the bot in a group, set `TG_ADMIN_USER_ID` to restrict who can change config.
- `TG_COMMAND_POLL_MS` controls how quickly the bot reacts to config commands (default 5000ms).

## Run

```bash
npm start
```

## Deploy (Docker)

Build:

```bash
docker build -t tg-polymarket-watcher .
```

Run (persist state + runtime config):

```bash
docker run -d --name tg-poly \
  --restart unless-stopped \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config:/app/config \
  tg-polymarket-watcher
```

## Notes

- Signals are computed from periodic snapshots (polling). This is not a perfect per-trade detector.
- Tune thresholds in `.env` to avoid spam.
- Built-in backoff is enabled for 429/5xx responses and requests are rate-budgeted per polling interval.
