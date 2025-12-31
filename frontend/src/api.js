// frontend/src/api.js
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

function authHeaders() {
  const group_id = (localStorage.getItem("group_id") || "").trim();
  const join_code = (localStorage.getItem("join_code") || "").trim();

  return group_id && join_code
    ? { "x-group-id": group_id, "x-join-code": join_code }
    : {};
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "API error");
  return data;
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}

export async function groupCheck() {
  return request(`/group_check`);
}

export async function getMembers() {
  const data = await request(`/members`);
  return data.members;
}

export async function createMember(name) {
  const data = await request(`/members`, { method: "POST", body: { name } });
  return data.member;
}

export async function getEntries(month) {
  const data = await request(`/entries?month=${encodeURIComponent(month)}`);
  return data.entries;
}

export async function saveEntry(payload) {
  const data = await request(`/entries`, { method: "POST", body: payload });
  return data.entry;
}

export async function getHolidays(month) {
  // public endpoint, but harmless to send headers too
  const data = await request(`/holidays?month=${encodeURIComponent(month)}`);
  return data.holidays;
}

export async function updateMemberRates(payload) {
  return request(`/member_rates`, { method: "POST", body: payload });
}
