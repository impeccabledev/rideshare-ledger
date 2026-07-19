const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

function authHeaders() {
  return {
    "x-group-id": localStorage.getItem("group_id") || "",
    "x-join-code": localStorage.getItem("join_code") || "",
  };
}

async function handle(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) throw new Error(data.error || `API error (${res.status})`);
  return data;
}

// Helper: fetch with Abort timeout and retries (exponential backoff).
// Only callers using safe/idempotent methods should enable retries.
async function fetchWithTimeoutAndRetry(url, options = {}, timeoutMs = 15000, maxRetries = 2) {
  let attempt = 0;
  const baseDelay = 300;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

  const waitBeforeRetry = async () => {
    const delay = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * 100);
    await new Promise((resolve) => setTimeout(resolve, delay + jitter));
  };

  while (true) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);

      if (retryableStatuses.has(res.status) && attempt < maxRetries) {
        attempt += 1;
        await waitBeforeRetry();
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(id);
      // If aborted due to timeout or other transient network error, retry
      attempt += 1;
      const isAbort = err && err.name === 'AbortError';
      const isNetworkErr = err instanceof TypeError; // fetch network errors surface as TypeError

      if (attempt > maxRetries || (!isAbort && !isNetworkErr)) {
        // Give up
        throw err;
      }

      await waitBeforeRetry();
      // continue to next attempt
    }
  }
}

/**
 * request wrapper used across the frontend.
 * Adds configurable timeout + retry to avoid cron-trigger failures when backend is cold or slow.
 * Configure via VITE_API_TIMEOUT_MS and VITE_API_MAX_RETRIES in your environment.
 */
async function request(path, { method = "GET", body } = {}) {
  const headers = { ...authHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const url = `${API_BASE}${path}`;
  const timeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
  const configuredRetries = Number(import.meta.env.VITE_API_MAX_RETRIES || 2);
  const maxRetries = method === "GET" ? configuredRetries : 0;

  console.log("request:", method, url, { timeoutMs, maxRetries });

  const options = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const res = await fetchWithTimeoutAndRetry(url, options, timeoutMs, maxRetries);
  return handle(res);
}

// ----- Auth / group -----
export async function groupCheck() {
  return request("/group_check");
}


// ----- Members -----
export async function getMembers() {
  const data = await request("/members");
  return data.members || [];
}

export async function createMember(payload) {
  const data = await request("/members", { method: "POST", body: payload });
  return data.member;
}

export async function updateMemberRates(payload) {
  return request("/member_rates", { method: "POST", body: payload });
}

// ----- Entries -----
export async function getEntries(month) {
  const data = await request(`/entries?month=${encodeURIComponent(month)}`);
  return data.entries || [];
}

export async function saveEntry(payload) {
  const data = await request("/entries", { method: "POST", body: payload });
  return data.entry;
}

export async function deleteEntry(date) {
  console.log("deleteEntry called with date:", date);
  const data = await request(`/entries/${encodeURIComponent(date)}`, { method: "DELETE" });
  console.log("deleteEntry result:", data);
  return data;
}

// ----- Holidays -----
export async function getHolidays(month) {
  const data = await request(`/holidays?month=${encodeURIComponent(month)}`);
  return data.holidays || [];
}

// ----- Notify (optional) -----
export async function notify(payload) {
  return request("/notify", { method: "POST", body: payload || {} });
}
