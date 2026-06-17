# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

# Cron / keepalive guidance

If you run periodic cron jobs against the API (for example to keep a hosted backend warm or to run scheduled tasks), the frontend and server provide a lightweight health endpoint and configurable client-side timeouts/retries.

- Frontend env vars (Vite):
	- `VITE_API_TIMEOUT_MS` — request timeout in milliseconds (default: `15000`).
	- `VITE_API_MAX_RETRIES` — number of retry attempts on transient failures (default: `2`).

Set these in your environment where the frontend is built / run, e.g. in `.env` or your CI/hosting settings.

Example cron job (bash) that attempts a health ping with retries and logs failures:

```bash
# Try winding up to 3 attempts with a short backoff
URL="https://your-app.example.com/health"
for i in 1 2 3; do
	if curl --silent --fail --max-time 10 "$URL" -o /dev/null; then
		echo "health ok"
		exit 0
	fi
	echo "health check failed (attempt $i). Retrying..."
	sleep $((i * 2))
done
echo "health check failed after retries" >&2
exit 2
```

Alternatively, use a small Node script or a monitoring service (UptimeRobot, NewRelic, etc.) to perform regular pings.

If cron jobs still observe intermittent failures after adding retries/timeouts, consider also:

- Calling the backend `/health` endpoint before performing heavier requests in the cron job to warm the process.
- Adding server-side improvements: a fast `/health` (already present), ensuring DB connection pooling, or keeping a lightweight scheduled task to avoid cold starts.
