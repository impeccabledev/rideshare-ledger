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

async function request(path, { method = "GET", body } = {}) {
  const headers = { ...authHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const url = `${API_BASE}${path}`;
  console.log("request:", method, url);
  
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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