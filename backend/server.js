import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";
import twilio from "twilio";
import cron from "node-cron";

dotenv.config();

const app = express();
app.use(cors()); // tighten later to your deployed frontend domain
app.use(express.json());

// Lightweight health endpoint for uptime/cron checks and warm pings
app.get("/health", (req, res) => {
  // Return service status quickly; avoid heavy initialization here.
  res.json({ ok: true, time: new Date().toISOString(), service: "rideshare-ledger" });
});

const {
  PORT = 4000,
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  APP_URL,
} = process.env;

// Initialize Twilio client if credentials are provided
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  throw new Error(
    "Missing env vars: GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY"
  );
}

const auth = new google.auth.JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const TAB_MEMBERS = "members";
const TAB_DAY_ENTRIES = "day_entries";
const TAB_DAY_RIDERS = "day_riders";

async function getValues(range) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
  });
  return resp.data.values || [];
}

async function setValues(range, values) {
  console.log("setValues called:", range, "rows:", values.length);
  console.log("First row:", values[0]);
  console.log("Second row if exists:", values[1]);
  const resp = await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log("setValues response updatedCells:", resp.data?.updatedCells);
  return resp.data;
}

async function appendValues(range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function unitsForTrip(trip_type) {
  if (trip_type === "one_way") return 1;
  if (trip_type === "two_way") return 2;
  return 0;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function colLabel(n) {
  let label = "";
  let value = n;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

async function loadSheetEnsuringColumns(tabName, requiredCols) {
  const rows = await getValues(`${tabName}!A:Z`);
  if (!rows.length) {
    const header = [...requiredCols];
    await setValues(`${tabName}!A1:${colLabel(header.length)}1`, [header]);
    return { rows: [header], idx: header.reduce((a, h, i) => ((a[h] = i), a), {}) };
  }

  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => (idx[h] = i));

  let headerChanged = false;
  const ensureCol = (col) => {
    if (idx[col] == null) {
      header.push(col);
      idx[col] = header.length - 1;
      headerChanged = true;
    }
  };

  for (const col of requiredCols) ensureCol(col);

  // Most reads already have the expected schema. Reuse that response instead
  // of immediately issuing the same Google Sheets read a second time.
  if (!headerChanged) return { rows, idx };

  // If migration is needed, write the complete header once, then re-read so
  // callers receive the normalized sheet shape.
  await setValues(`${tabName}!A1:${colLabel(header.length)}1`, [header]);

  const rows2 = await getValues(`${tabName}!A:Z`);
  const header2 = rows2[0] || header;
  const idx2 = {};
  header2.forEach((h, i) => (idx2[h] = i));
  return { rows: rows2, idx: idx2 };
}

function normalizeGroupId(value) {
  return String(value || "").trim().toLowerCase();
}

function getReqGroupId(req) {
  return String(req.headers["x-group-id"] || "").trim();
}

function parseGroupCredentials() {
  const raw = process.env.GROUP_CREDENTIALS || process.env.GROUP_JOIN_CODES || "";
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [normalizeGroupId(k), String(v).trim()])
      );
    }
  } catch {
    // fall back to comma-separated key=value pairs
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const [group, code] = entry.split("=").map((part) => part.trim());
      if (group && code) acc[group] = code;
      return acc;
    }, {});
}

function validateGroupCredentials(groupId, joinCode) {
  const expected = parseGroupCredentials()[normalizeGroupId(groupId)];
  if (expected) {
    return String(expected || "").trim() === String(joinCode || "").trim();
  }
  return false;
}

async function validateGroupAccess(groupId, joinCode) {
  if (!groupId || !joinCode) return false;

  if (validateGroupCredentials(groupId, joinCode)) {
    return true;
  }

  try {
    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    if (rows.length <= 1) {
      return String(joinCode || "").trim() !== "";
    }

    const found = filterRowsByGroup(rows.slice(1), idx, groupId).some((row) => row && row.length);
    if (found) return true;

    const fallbackRows = rows.slice(1).filter((row) => row && row.length);
    const hasAnyGroupId = fallbackRows.some((row) => String(row[idx["group_id"]] ?? "").trim() === "");
    if (!hasAnyGroupId) {
      return String(joinCode || "").trim() !== "";
    }

    return String(joinCode || "").trim() !== "";
  } catch (e) {
    console.error("Failed to validate group access from sheet", e);
    return false;
  }
}

function rowMatchesGroup(row, idx, groupId) {
  if (!groupId) return false;
  if (!row || !Array.isArray(row)) return false;
  const value = normalizeGroupId(row[idx["group_id"]] ?? "");
  return value === normalizeGroupId(groupId);
}

function filterRowsByGroup(rows, idx, groupId) {
  return rows.filter((row) => rowMatchesGroup(row, idx, groupId));
}

function nthWeekdayOfMonth(year, monthIdx0, weekday0Sun, nth) {
  const first = new Date(year, monthIdx0, 1);
  const offset = (weekday0Sun - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return new Date(year, monthIdx0, day);
}

function lastWeekdayOfMonth(year, monthIdx0, weekday0Sun) {
  const last = new Date(year, monthIdx0 + 1, 0);
  const offset = (last.getDay() - weekday0Sun + 7) % 7;
  return new Date(year, monthIdx0, last.getDate() - offset);
}

function observedFixedDateHoliday(year, monthIdx0, day) {
  const d = new Date(year, monthIdx0, day);
  const dow = d.getDay();
  if (dow === 6) {
    const obs = new Date(d);
    obs.setDate(d.getDate() - 1);
    return obs;
  }
  if (dow === 0) {
    const obs = new Date(d);
    obs.setDate(d.getDate() + 1);
    return obs;
  }
  return d;
}

function usFederalHolidaysObservedForYear(year) {
  const holidays = [];
  holidays.push({ date: observedFixedDateHoliday(year, 0, 1), name: "New Year's Day" });
  holidays.push({ date: nthWeekdayOfMonth(year, 0, 1, 3), name: "MLK Day" });
  holidays.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents's Day" });
  holidays.push({ date: lastWeekdayOfMonth(year, 4, 1), name: "Memorial Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 5, 19), name: "Juneteenth Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 6, 4), name: "Independence Day" });
  holidays.push({ date: nthWeekdayOfMonth(year, 8, 1, 1), name: "Labor Day" });
  holidays.push({ date: nthWeekdayOfMonth(year, 9, 1, 2), name: "Columbus Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 10, 11), name: "Veterans Day" });
  holidays.push({ date: nthWeekdayOfMonth(year, 10, 4, 4), name: "Thanksgiving Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 11, 25), name: "Christmas Day" });

  return holidays.map((h) => ({ date: fmtDate(h.date), name: h.name }));
}

function normalizePhone(phoneRaw) {
  const s = String(phoneRaw || "").trim();
  if (!s) return "";
  // Strip leading apostrophe that may be used to prevent Google Sheets formula interpretation
  const cleaned = s.replace(/^'/, "");
  // keep + and digits only
  return cleaned.replace(/[^\d+]/g, "");
}

function genMemberId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- GROUP CHECK ----
app.get("/group_check", async (req, res) => {
  try {
    const groupId = String(req.headers["x-group-id"] || "").trim();
    const joinCode = String(req.headers["x-join-code"] || "").trim();

    if (!groupId || !joinCode) {
      return res.status(400).json({ error: "Missing x-group-id or x-join-code headers" });
    }

    const isValid = await validateGroupAccess(groupId, joinCode);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid group id or join code" });
    }

    res.json({ ok: true, group_id: groupId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Group check failed" });
  }
});

/** Ensure members header has required columns. Returns {rows, idx}. */
async function loadMembersSheetEnsuringColumns() {
  return loadSheetEnsuringColumns(TAB_MEMBERS, [
    "member_id",
    "name",
    "phone",
    "active",
    "one_way_total",
    "two_way_total",
    "group_id",
  ]);
}

// ---- MEMBERS ----
app.get("/members", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    if (rows.length <= 1) return res.json({ members: [] });

    const members = filterRowsByGroup(rows.slice(1), idx, groupId)
      .filter((r) => r && r.length)
      .map((r) => ({
        member_id: r[idx["member_id"]] ?? "",
        name: r[idx["name"]] ?? "",
        phone: r[idx["phone"]] ?? "",
        active: String(r[idx["active"]] ?? "TRUE").toUpperCase() === "TRUE",
        one_way_total: Number(r[idx["one_way_total"]] ?? 0),
        two_way_total: Number(r[idx["two_way_total"]] ?? 0),
      }))
      .filter((m) => m.member_id && m.name);

    res.json({ members });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read members" });
  }
});

// Create a new member (name + phone)
app.post("/members", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { name, phone, active = true, member_id } = req.body || {};
    const n = String(name || "").trim();
    if (!n) return res.status(400).json({ error: "name is required" });

    const p = normalizePhone(phone);
    const id = String(member_id || "").trim() || genMemberId();

    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    const scopedRows = filterRowsByGroup(rows.slice(1), idx, groupId);
    const existing = scopedRows.some((r) => String(r[idx["member_id"]] ?? "") === id);
    if (existing) return res.status(409).json({ error: "member_id already exists" });

    // Also prevent exact duplicate name+phone collisions (optional sanity)
    const dup = scopedRows.some(
      (r) =>
        String(r[idx["name"]] ?? "").trim().toLowerCase() === n.toLowerCase() &&
        normalizePhone(r[idx["phone"]] ?? "") === p
    );
    if (dup) return res.status(409).json({ error: "Member already exists (same name + phone)" });

    const one_way_total = ""; // let user set later
    const two_way_total = "";

    // Build row aligned to header
    const headerLen = rows[0].length;
    const newRow = new Array(headerLen).fill("");
    // Prefix phone with ' to prevent Google Sheets from interpreting + as formula
    const phoneForSheet = p.startsWith("+") ? "'" + p : p;
    newRow[idx["member_id"]] = id;
    newRow[idx["name"]] = n;
    newRow[idx["phone"]] = phoneForSheet;
    newRow[idx["active"]] = active ? "TRUE" : "FALSE";
    newRow[idx["one_way_total"]] = one_way_total;
    newRow[idx["two_way_total"]] = two_way_total;
    newRow[idx["group_id"]] = groupId;

    await appendValues(`${TAB_MEMBERS}!A:Z`, [newRow]);

    res.status(201).json({
      member: {
        member_id: id,
        name: n,
        phone: p,
        active: !!active,
        one_way_total: 0,
        two_way_total: 0,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create member" });
  }
});

// Update a member's rates
app.post("/member_rates", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { member_id, one_way_total, two_way_total } = req.body || {};
    if (!member_id) return res.status(400).json({ error: "member_id required" });

    const one = Number(one_way_total);
    const two = Number(two_way_total);

    if (!Number.isFinite(one) || one <= 0) return res.status(400).json({ error: "one_way_total must be positive" });
    if (!Number.isFinite(two) || two <= 0) return res.status(400).json({ error: "two_way_total must be positive" });
    if (two < one) return res.status(400).json({ error: "two_way_total should be >= one_way_total" });

    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    if (rows.length <= 1) return res.status(400).json({ error: "members sheet empty" });

    const rowIndex = rows.findIndex(
      (r, i) => i > 0 && String(r[idx["member_id"]] ?? "") === member_id && rowMatchesGroup(r, idx, groupId)
    );
    if (rowIndex < 0) return res.status(404).json({ error: "member not found" });

    while (rows[rowIndex].length < rows[0].length) rows[rowIndex].push("");

    rows[rowIndex][idx["one_way_total"]] = String(one);
    rows[rowIndex][idx["two_way_total"]] = String(two);
    rows[rowIndex][idx["group_id"]] = groupId;

    await setValues(`${TAB_MEMBERS}!A1:Z${rows.length}`, rows);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update member rates" });
  }
});

// ---- HOLIDAYS ----
app.get("/holidays", async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }
    const year = Number(String(month).slice(0, 4));
    const list = usFederalHolidaysObservedForYear(year).filter((h) => h.date.startsWith(month));
    res.json({ holidays: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to compute holidays" });
  }
});

// ---- ENTRIES ----
app.get("/entries", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }

    const { rows: entryRows, idx: entryIdx } = await loadSheetEnsuringColumns(TAB_DAY_ENTRIES, [
      "entry_id",
      "date",
      "driver_id",
      "day_type",
      "day_total_used",
      "total_amount",
      "notes",
      "created_at",
      "group_id",
    ]);
    const { rows: riderRows, idx: riderIdx } = await loadSheetEnsuringColumns(TAB_DAY_RIDERS, [
      "entry_id",
      "member_id",
      "trip_type",
      "units",
      "charge",
      "group_id",
    ]);

    const entries = [];
    if (entryRows.length > 1) {
      for (const r of filterRowsByGroup(entryRows.slice(1), entryIdx, groupId)) {
        const date = r[entryIdx["date"]] ?? "";
        if (!String(date).startsWith(month)) continue;

        entries.push({
          entry_id: r[entryIdx["entry_id"]] ?? "",
          date,
          driver_id: r[entryIdx["driver_id"]] ?? "",
          day_type: r[entryIdx["day_type"]] ?? "",
          day_total_used: Number(r[entryIdx["day_total_used"]] ?? 0),
          total_amount: Number(r[entryIdx["total_amount"]] ?? 0),
          notes: r[entryIdx["notes"]] ?? "",
          created_at: r[entryIdx["created_at"]] ?? "",
          riders: [],
        });
      }
    }

    const byId = new Map(entries.map((e) => [e.entry_id, e]));
    if (riderRows.length > 1) {
      for (const r of filterRowsByGroup(riderRows.slice(1), riderIdx, groupId)) {
        const entry_id = r[riderIdx["entry_id"]] ?? "";
        const e = byId.get(entry_id);
        if (!e) continue;

        e.riders.push({
          member_id: r[riderIdx["member_id"]] ?? "",
          trip_type: r[riderIdx["trip_type"]] ?? "",
          units: Number(r[riderIdx["units"]] ?? 0),
          charge: Number(r[riderIdx["charge"]] ?? 0),
        });
      }
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ entries });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read entries" });
  }
});

// ---- UPSERT ENTRY (per-driver total + weighted split) ----
app.post("/entries", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { date, driver_id, day_type, riders = [], notes = "" } = req.body || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: "date required as YYYY-MM-DD" });
    }
    if (!driver_id) return res.status(400).json({ error: "driver_id required" });
    if (!["one_way", "two_way"].includes(day_type)) {
      return res.status(400).json({ error: "day_type must be one_way or two_way" });
    }
    if (!Array.isArray(riders)) {
      return res.status(400).json({ error: "riders must be an array" });
    }

    // Load driver totals from members tab
    const { rows: membersRows, idx: midx } = await loadMembersSheetEnsuringColumns();
    if (membersRows.length <= 1) return res.status(400).json({ error: "members sheet empty" });

    const driverRow = membersRows.find(
      (r, i) => i > 0 && String(r[midx["member_id"]] ?? "") === driver_id && rowMatchesGroup(r, midx, groupId)
    );
    if (!driverRow) return res.status(400).json({ error: "Driver not found in members" });

    const driverOne = Number(driverRow[midx["one_way_total"]] ?? 0);
    const driverTwo = Number(driverRow[midx["two_way_total"]] ?? 0);

    const day_total_used = day_type === "one_way" ? driverOne : driverTwo;

    // If no riders, save entry with empty riders array
    if (riders.length === 0) {
      const created_at = new Date().toISOString();
      const total_amount = 0;

      const { rows: entryRows, idx: entryIdx } = await loadSheetEnsuringColumns(TAB_DAY_ENTRIES, [
        "entry_id",
        "date",
        "driver_id",
        "day_type",
        "day_total_used",
        "total_amount",
        "notes",
        "created_at",
        "group_id",
      ]);
      const entryHeader = entryRows[0];
      const entryData = entryRows;

      const existingIdx = entryData.findIndex(
        (r, i) => i > 0 && String(r[entryIdx["date"]] ?? "") === date && rowMatchesGroup(r, entryIdx, groupId)
      );
      const entryRow = new Array(entryHeader.length).fill("");
      entryRow[entryIdx["entry_id"]] = date;
      entryRow[entryIdx["date"]] = date;
      entryRow[entryIdx["driver_id"]] = driver_id;
      entryRow[entryIdx["day_type"]] = day_type;
      entryRow[entryIdx["day_total_used"]] = String(day_total_used);
      entryRow[entryIdx["total_amount"]] = String(total_amount);
      entryRow[entryIdx["notes"]] = notes;
      entryRow[entryIdx["created_at"]] = created_at;
      entryRow[entryIdx["group_id"]] = groupId;

      if (existingIdx >= 1) {
        entryData[existingIdx] = entryRow;
        await setValues(`${TAB_DAY_ENTRIES}!A1:${colLabel(entryHeader.length)}${entryData.length}`, entryData);
      } else {
        await appendValues(`${TAB_DAY_ENTRIES}!A:Z`, [entryRow]);
      }

      // Clear riders for this date
      const { rows: riderRows } = await loadSheetEnsuringColumns(TAB_DAY_RIDERS, [
        "entry_id",
        "member_id",
        "trip_type",
        "units",
        "charge",
        "group_id",
      ]);
      if (riderRows.length > 1) {
        const riderData = riderRows;
        const kept = [riderData[0], ...riderData.slice(1).filter((r) => String(r[0] ?? "") !== date || !rowMatchesGroup(r, { group_id: 5 }, groupId))];
        await setValues(`${TAB_DAY_RIDERS}!A1:${colLabel(riderData[0].length)}${kept.length}`, kept);
      }

      return res.status(201).json({
        entry: {
          entry_id: date,
          date,
          driver_id,
          day_type,
          day_total_used,
          total_amount,
          notes,
          created_at,
          riders: [],
        },
      });
    }

    // Existing logic for when riders are provided
    if (!riders.some((x) => x.member_id === driver_id)) {
      return res.status(400).json({ error: "Driver must be included in riders" });
    }

    if (!Number.isFinite(day_total_used) || day_total_used <= 0) {
      return res.status(400).json({ error: "Driver rates not set (one_way_total/two_way_total)" });
    }

    const riderUnits = riders.map((x) => {
      if (!x.member_id) throw new Error("Missing member_id in riders");
      if (!["one_way", "two_way"].includes(x.trip_type)) throw new Error("Invalid trip_type in riders");
      return {
        entry_id: date,
        member_id: x.member_id,
        trip_type: x.trip_type,
        units: unitsForTrip(x.trip_type),
      };
    });

    const total_units = riderUnits.reduce((s, r) => s + r.units, 0);
    if (total_units <= 0) return res.status(400).json({ error: "No valid riders/units" });

    const computed = riderUnits.map((r) => ({
      ...r,
      charge: round2(day_total_used * (r.units / total_units)),
    }));

    // correct rounding drift to driver
    const sumCharges = computed.reduce((s, r) => s + r.charge, 0);
    const drift = round2(day_total_used - sumCharges);
    if (Math.abs(drift) >= 0.01) {
      const i = computed.findIndex((x) => x.member_id === driver_id);
      if (i >= 0) computed[i].charge = round2(computed[i].charge + drift);
    }

    const total_amount = round2(computed.reduce((s, r) => s + r.charge, 0));
    const created_at = new Date().toISOString();

    const { rows: entryRows, idx: entryIdx } = await loadSheetEnsuringColumns(TAB_DAY_ENTRIES, [
      "entry_id",
      "date",
      "driver_id",
      "day_type",
      "day_total_used",
      "total_amount",
      "notes",
      "created_at",
      "group_id",
    ]);
    const entryHeader = entryRows[0];
    const entryData = entryRows;

    const existingIdx = entryData.findIndex(
      (r, i) => i > 0 && String(r[entryIdx["date"]] ?? "") === date && rowMatchesGroup(r, entryIdx, groupId)
    );
    const entryRow = new Array(entryHeader.length).fill("");
    entryRow[entryIdx["entry_id"]] = date;
    entryRow[entryIdx["date"]] = date;
    entryRow[entryIdx["driver_id"]] = driver_id;
    entryRow[entryIdx["day_type"]] = day_type;
    entryRow[entryIdx["day_total_used"]] = String(day_total_used);
    entryRow[entryIdx["total_amount"]] = String(total_amount);
    entryRow[entryIdx["notes"]] = notes;
    entryRow[entryIdx["created_at"]] = created_at;
    entryRow[entryIdx["group_id"]] = groupId;

    if (existingIdx >= 1) {
      entryData[existingIdx] = entryRow;
      await setValues(`${TAB_DAY_ENTRIES}!A1:${colLabel(entryHeader.length)}${entryData.length}`, entryData);
    } else {
      await appendValues(`${TAB_DAY_ENTRIES}!A:Z`, [entryRow]);
    }

    const { rows: riderRows, idx: riderIdx } = await loadSheetEnsuringColumns(TAB_DAY_RIDERS, [
      "entry_id",
      "member_id",
      "trip_type",
      "units",
      "charge",
      "group_id",
    ]);
    const riderHeader = riderRows[0];
    const riderData = riderRows;

    const kept = [riderHeader, ...riderData.slice(1).filter((r) => String(r[riderIdx["entry_id"]] ?? "") !== date || !rowMatchesGroup(r, riderIdx, groupId))];
    for (const c of computed) {
      kept.push([c.entry_id, c.member_id, c.trip_type, String(c.units), String(c.charge), groupId]);
    }
    await setValues(`${TAB_DAY_RIDERS}!A1:${colLabel(riderHeader.length)}${kept.length}`, kept);

    res.status(201).json({
      entry: {
        entry_id: date,
        date,
        driver_id,
        day_type,
        day_total_used,
        total_amount,
        notes,
        created_at,
        riders: computed.map(({ entry_id, ...rest }) => rest),
      },
    });
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || "");
    if (msg.includes("Invalid trip_type")) {
      return res.status(400).json({ error: "riders.trip_type must be one_way or two_way" });
    }
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// Helper to delete a row by index (1-indexed, including header)
async function deleteRow(sheetName, rowIndex) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: 0, // Use the first sheet's ID, or get it dynamically
            dimension: "ROWS",
            startIndex: rowIndex - 1, // Convert to 0-indexed
            endIndex: rowIndex, // Exclusive end
          }
        }
      }]
    }
  });
}

// ---- DELETE ENTRY ----
app.delete("/entries/:date", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { date } = req.params;
    console.log(`[DELETE] Attempting to delete entry for date: ${date}`);
    
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: "date required as YYYY-MM-DD" });
    }

    // First, get the current sheet metadata to find the correct sheetId
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    const entriesSheet = spreadsheet.data.sheets.find(s => s.properties.title === TAB_DAY_ENTRIES);
    const ridersSheet = spreadsheet.data.sheets.find(s => s.properties.title === TAB_DAY_RIDERS);
    const entriesSheetId = entriesSheet?.properties?.sheetId || 0;
    const ridersSheetId = ridersSheet?.properties?.sheetId || 0;

    // Delete from day_entries sheet
    const { rows: entryRows, idx: entryIdx } = await loadSheetEnsuringColumns(TAB_DAY_ENTRIES, [
      "entry_id",
      "date",
      "driver_id",
      "day_type",
      "day_total_used",
      "total_amount",
      "notes",
      "created_at",
      "group_id",
    ]);
    console.log(`[DELETE] entryRows length: ${entryRows.length}`);
    if (entryRows.length > 1) {
      const existingIdx = entryRows.findIndex(
        (r, i) => i > 0 && String(r[entryIdx["date"]] ?? "") === date && rowMatchesGroup(r, entryIdx, groupId)
      );
      console.log(`[DELETE] existingIdx for ${date}: ${existingIdx}`);
      if (existingIdx >= 1) {
        // Delete the row (index + 1 because header is row 0, data starts at row 1)
        const rowToDelete = existingIdx + 1; // 1-indexed including header
        console.log(`[DELETE] Deleting row ${rowToDelete} from day_entries`);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: GOOGLE_SHEET_ID,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId: entriesSheetId,
                  dimension: "ROWS",
                  startIndex: existingIdx, // 0-indexed, so existingIdx is the row to delete
                  endIndex: existingIdx + 1,
                }
              }
            }]
          }
        });
        console.log(`[DELETE] Deleted row ${rowToDelete} from day_entries`);
      } else {
        console.log(`[DELETE] Entry not found in day_entries sheet`);
      }
    }

    // Delete from day_riders sheet
    const { rows: riderRows, idx: riderIdx } = await loadSheetEnsuringColumns(TAB_DAY_RIDERS, [
      "entry_id",
      "member_id",
      "trip_type",
      "units",
      "charge",
      "group_id",
    ]);
    console.log(`[DELETE] riderRows length: ${riderRows.length}`);
    if (riderRows.length > 1) {
      // Find all rows for this date (there might be multiple riders)
      const rowsToDelete = [];
      riderRows.forEach((r, i) => {
        if (i > 0 && String(r[riderIdx["entry_id"]] ?? "") === date && rowMatchesGroup(r, riderIdx, groupId)) {
          rowsToDelete.push(i);
        }
      });
      console.log(`[DELETE] Found ${rowsToDelete.length} rider rows to delete:`, rowsToDelete);
      
      // Delete rows in reverse order (so indices stay valid)
      for (let i = rowsToDelete.length - 1; i >= 0; i--) {
        const rowIdx = rowsToDelete[i];
        console.log(`[DELETE] Deleting rider row ${rowIdx + 1} (index ${rowIdx})`);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: GOOGLE_SHEET_ID,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId: ridersSheetId,
                  dimension: "ROWS",
                  startIndex: rowIdx,
                  endIndex: rowIdx + 1,
                }
              }
            }]
          }
        });
      }
      console.log(`[DELETE] Deleted ${rowsToDelete.length} rider rows`);
    }

    console.log(`[DELETE] Successfully deleted entry for date: ${date}`);
    res.json({ ok: true, deleted: date });
  } catch (e) {
    console.error("[DELETE] Error:", e);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// ---- NOTIFY (SMS) ----
app.post("/notify", async (req, res) => {
  const groupId = getReqGroupId(req);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { message = "Reminder: please add today's ride details." } = req.body || {};

    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    const members = filterRowsByGroup(rows.slice(1), idx, groupId)
      .map((r) => ({
        member_id: r[idx["member_id"]] ?? "",
        name: r[idx["name"]] ?? "",
        phone: normalizePhone(r[idx["phone"]] ?? ""),
        active: String(r[idx["active"]] ?? "TRUE").toUpperCase() === "TRUE",
      }))
      .filter((m) => m.active && m.phone);

    // Build the full message with app URL
    const appUrl = APP_URL || "https://your-app-url.com";
    const fullMessage = `Hi! ${message}\n\nAdd your ride details here: ${appUrl}`;

    // Send SMS via Twilio if configured
    const results = [];
    if (twilioClient && TWILIO_PHONE_NUMBER) {
      for (const m of members) {
        try {
          await twilioClient.messages.create({
            body: fullMessage,
            from: TWILIO_PHONE_NUMBER,
            to: m.phone,
          });
          results.push({ member_id: m.member_id, name: m.name, phone: m.phone, status: "sent" });
        } catch (err) {
          console.error(`Failed to send SMS to ${m.phone}:`, err.message);
          results.push({ member_id: m.member_id, name: m.name, phone: m.phone, status: "failed", error: err.message });
        }
      }
    } else {
      // Return recipients without sending if Twilio is not configured
      for (const m of members) {
        results.push({ member_id: m.member_id, name: m.name, phone: m.phone, status: "pending", message: fullMessage });
      }
    }

    const sentCount = results.filter(r => r.status === "sent").length;
    const failedCount = results.filter(r => r.status === "failed").length;

    res.json({
      ok: true,
      message,
      appUrl,
      sent: sentCount,
      failed: failedCount,
      recipients: results,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to notify" });
  }
});

// ---- KEEPALIVE SCHEDULER ----
// Keep the backend warm by self-pinging /health periodically. Defaults are safe for Render.
if (process.env.NODE_ENV !== 'test') {
  // Default to 15 minutes in production; allow fast test schedule with KEEPALIVE_TEST=1
  const keepaliveSchedule = process.env.KEEPALIVE_TEST === '1' ? '*/1 * * * *' : (process.env.KEEPALIVE_SCHEDULE || '*/14 * * * *');

  // Auto-enable public ping when running in production and APP_URL is set, or override with KEEPALIVE_PUBLIC=1
  const publicPingEnabled = process.env.KEEPALIVE_PUBLIC === '1' || (process.env.NODE_ENV === 'production' && !!APP_URL);

  // Helper to fetch with timeout
  async function fetchWithTimeout(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  cron.schedule(keepaliveSchedule, async () => {
    const targets = [{ name: 'local', url: `http://localhost:${PORT}/health` }];

    if (publicPingEnabled) {
      const publicUrl = APP_URL ? (APP_URL.endsWith('/health') ? APP_URL : `${APP_URL.replace(/\/$/, '')}/health`) : null;
      if (publicUrl) targets.push({ name: 'public', url: publicUrl });
    }

    console.log(`[KEEPALIVE] Running scheduled ping (${keepaliveSchedule}) at ${new Date().toISOString()}`);
    for (const t of targets) {
      try {
        const res = await fetchWithTimeout(t.url, Number(process.env.KEEPALIVE_TIMEOUT_MS || 10000));
        console.log(`[KEEPALIVE] Pinged ${t.name} -> ${t.url}, status: ${res.status}`);
      } catch (err) {
        console.error(`[KEEPALIVE] Failed to ping ${t.name} -> ${t.url}:`, err && err.message ? err.message : err);
      }
      // small stagger to avoid simultaneous external hits
      await new Promise((r) => setTimeout(r, 600));
    }
  });

  console.log(`[KEEPALIVE] Scheduler started. Schedule='${keepaliveSchedule}', publicPing=${publicPingEnabled}`);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
