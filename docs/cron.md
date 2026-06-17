# Cron / Keepalive Examples

This file shows example usage for keeping the backend responsive using the `/health` endpoint and a small Node ping script included in `scripts/ping.js`.

## Using `scripts/ping.js`

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

## Example crontab

Run every 5 minutes and log output:

```cron
*/5 * * * * PING_URL="https://your-app.example.com/health" /usr/bin/node /path/to/repo/scripts/ping.js >> /var/log/ping-health.log 2>&1
```

## Example: warm then run heavier job

If you have a heavier cron task that sometimes times out on first request, ping `/health` first, then run the task:

```bash
# warm
PING_URL="https://your-app.example.com/health" node /path/to/repo/scripts/ping.js || exit 1

# then run heavier request or script
node /path/to/repo/scripts/heavy-task.js
```

## Monitoring services

You can also use UptimeRobot, Pingdom, or your cloud provider's uptime checks to run regular pings and alert on failures.
