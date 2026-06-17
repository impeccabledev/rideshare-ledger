# Cron / Keepalive Examples

This file shows example usage for keeping the backend responsive using the `/health` endpoint.

## Built-in Keepalive (Render Basic/Free Plan)

**Starting from v2.0**, the backend includes a built-in keepalive scheduler that automatically pings `/health` every 14 minutes. This runs inside the Node.js process and requires no external cron service.

**Setup:**
1. Install dependencies: `npm install` (includes `node-cron`)
2. Start the server: `npm start`
3. The keepalive scheduler activates automatically and logs pings to stdout

This approach works on Render's free and basic tiers that don't include native cron access.

---

## External Cron Options

If you prefer external cron (e.g., on higher Render tiers or other hosting), use one of these free services:

### Option 1: UptimeRobot (Free, Recommended)

1. Sign up at https://uptimerobot.com
2. Create a new uptime check for `https://your-app.example.com/health`
3. Set interval to 10–15 minutes
4. Receive alerts if the endpoint goes down

### Option 2: EasyCron (Free)

1. Sign up at https://www.easycron.com
2. Create a new cron job:
   - **Cron URL:** `https://your-app.example.com/health`
   - **Schedule:** `0 */15 * * * *` (every 15 minutes)

### Option 3: Using `scripts/ping.js` with External Cron

Set `PING_URL` and run the script. The script will retry a few times with backoff and exit with `0` on success or `2` on failure.

Example (manual):

```bash
PING_URL="https://your-app.example.com/health" node scripts/ping.js
```

You can configure via env vars:

- `PING_URL` — URL to ping (required)
- `ATTEMPTS` — number of attempts (default 3)
- `TIMEOUT_MS` — per-request timeout in ms (default 10000)
- `BASE_DELAY_MS` — base backoff delay in ms (default 2000)

### Example crontab (if you have cron access)

Run every 15 minutes and log output:

```cron
*/15 * * * * PING_URL="https://your-app.example.com/health" /usr/bin/node /path/to/repo/scripts/ping.js >> /var/log/ping-health.log 2>&1
```

**Note:** If using Render or similar serverless platforms with cold-start times, avoid intervals shorter than 10 minutes. If you experience 429 errors, increase to 20–30 minutes.

## Example: Warm then run heavier job

If you have a heavier cron task that sometimes times out on first request, use the ping script to warm up first:

```bash
# warm
PING_URL="https://your-app.example.com/health" node /path/to/repo/scripts/ping.js || exit 1

# then run heavier request or script
node /path/to/repo/scripts/heavy-task.js
```
