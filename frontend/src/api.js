const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

async function handle(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API error");
  return data;
}

export async function getMembers() {
  const res = await fetch(`${API_BASE}/members`);
  const data = await handle(res);
  return data.members;
}

export async function getEntries(month) {
  const res = await fetch(`${API_BASE}/entries?month=${month}`);
  const data = await handle(res);
  return data.entries;
}

export async function saveEntry(payload) {
  const res = await fetch(`${API_BASE}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handle(res);
  return data.entry;
}

export async function getHolidays(month) {
  const res = await fetch(`${API_BASE}/holidays?month=${month}`);
  const data = await handle(res);
  return data.holidays;
}

export async function updateMemberRates(payload) {
  const res = await fetch(`${API_BASE}/member_rates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}
