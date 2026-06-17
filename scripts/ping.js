#!/usr/bin/env node
// Simple ping script with retries and timeout for cron keepalive
// Usage: set PING_URL or pass first arg; optional env: ATTEMPTS, TIMEOUT_MS, BASE_DELAY_MS

const url = process.env.PING_URL || process.argv[2];
const attempts = Number(process.env.ATTEMPTS || 3);
const timeoutMs = Number(process.env.TIMEOUT_MS || 10000);
const baseDelay = Number(process.env.BASE_DELAY_MS || 2000);

if (!url) {
  console.error('Usage: PING_URL=https://... node scripts/ping.js');
  process.exit(2);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pingOnce(u, t) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), t);
  try {
    const res = await fetch(u, { signal: controller.signal });
    clearTimeout(id);
    
    // If we get a 429 (Too Many Requests), return a special marker
    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') || '60';
      console.warn(`Rate limited (429). Retry-After: ${retryAfter}s`);
      throw new Error(`RATE_LIMITED:${retryAfter}`);
    }
    
    return res.ok;
  } catch (err) {
    clearTimeout(id);
    return false;
  }
}

(async function main() {
  for (let i = 1; i <= attempts; i++) {
    console.log(new Date().toISOString(), `Attempt ${i} -> ${url}`);
    try {
      const ok = await pingOnce(url, timeoutMs);
      if (ok) {
        console.log('Ping succeeded');
        process.exit(0);
      }
      console.warn('Ping failed or non-2xx response');
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      
      // If rate limited, back off significantly
      if (errMsg.startsWith('RATE_LIMITED:')) {
        const retryAfter = parseInt(errMsg.split(':')[1]) || 60;
        console.error(`Rate limited. Backing off for ${retryAfter}s before retry...`);
        const backoffMs = retryAfter * 1000 + Math.random() * 5000;
        await wait(backoffMs);
        continue;
      }
      
      console.error('Ping error:', errMsg);
    }

    if (i < attempts) {
      const delay = baseDelay * i;
      console.log(`Waiting ${delay}ms before next attempt`);
      await wait(delay + Math.floor(Math.random() * 200));
    }
  }

  console.error('All ping attempts failed');
  process.exit(2);
})();
