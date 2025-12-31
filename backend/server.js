import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const {
  PORT = 4000,
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
} = process.env;

if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  throw new Error("Missing env vars. Check SHEET_ID / EMAIL / PRIVATE_KEY.");
}

const auth = new google.auth.JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const TAB_MEMBERS = "members";
const TAB_SETTINGS = "settings";
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
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

async function appendValues(range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

async function loadSettings() {
  const rows = await getValues(`${TAB_SETTINGS}!A:B`);
  const m = {};
  for (const r of rows.slice(1)) {
    if (r[0]) m[r[0]] = r[1];
  }
  return {
    one_way_total: Number(m.one_way_total ?? 0),
    two_way_total: Number(m.two_way_total ?? 0),
  };
}

function unitsForTrip(trip_type) {
  if (trip_type === "one_way") return 1;
  if (trip_type === "two_way") return 2;
  return 0;
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

// ---------------- US Federal holidays (observed) ----------------

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function nthWeekdayOfMonth(year, monthIdx0, weekday0Sun, nth) {
  // nth: 1..5
  const first = new Date(year, monthIdx0, 1);
  const offset = (weekday0Sun - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return new Date(year, monthIdx0, day);
}

function lastWeekdayOfMonth(year, monthIdx0, weekday0Sun) {
  const last = new Date(year, monthIdx0 + 1, 0); // last day of month
  const offset = (last.getDay() - weekday0Sun + 7) % 7;
  return new Date(year, monthIdx0, last.getDate() - offset);
}

function observedFixedDateHoliday(year, monthIdx0, day) {
  // Observed rule: if Sat -> Fri, if Sun -> Mon, else same day
  const d = new Date(year, monthIdx0, day);
  const dow = d.getDay();
  if (dow === 6) { // Saturday
    const obs = new Date(d);
    obs.setDate(d.getDate() - 1);
    return obs;
  }
  if (dow === 0) { // Sunday
    const obs = new Date(d);
    obs.setDate(d.getDate() + 1);
    return obs;
  }
  return d;
}

function usFederalHolidaysObservedForYear(year) {
  // Note: Inauguration Day is NOT included. It's not a federal holiday nationwide.
  // This list matches the standard US federal holidays.
  const holidays = [];

  // Fixed-date (observed)
  holidays.push({ date: observedFixedDateHoliday(year, 0, 1), name: "New Year's Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 5, 19), name: "Juneteenth National Independence Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 6, 4), name: "Independence Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 10, 11), name: "Veterans Day" });
  holidays.push({ date: observedFixedDateHoliday(year, 11, 25), name: "Christmas Day" });

  // Monday/Thursday-based (already on a weekday, no observed shift needed)
  holidays.push({ date: nthWeekdayOfMonth(year, 0, 1, 3), name: "Birthday of Martin Luther King, Jr." }); // 3rd Mon Jan
  holidays.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Washington's Birthday" }); // 3rd Mon Feb
  holidays.push({ date: lastWeekdayOfMonth(year, 4, 1), name: "Memorial Day" }); // last Mon May
  holidays.push({ date: nthWeekdayOfMonth(year, 8, 1, 1), name: "Labor Day" }); // 1st Mon Sep
  holidays.push({ date: nthWeekdayOfMonth(year, 9, 1, 2), name: "Columbus Day" }); // 2nd Mon Oct
  holidays.push({ date: nthWeekdayOfMonth(year, 10, 4, 4), name: "Thanksgiving Day" }); // 4th Thu Nov

  // Return as YYYY-MM-DD strings
  return holidays.map((h) => ({ date: fmtDate(h.date), name: h.name }));
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- MEMBERS ----
app.get("/members", async (_req, res) => {
  try {
    const rows = await getValues(`${TAB_MEMBERS}!A:C`);
    if (rows.length <= 1) return res.json({ members: [] });

    const header = rows[0];
    const idx = {};
    header.forEach((h, i) => (idx[h] = i));

    const members = rows
      .slice(1)
      .filter((r) => r.length)
      .map((r) => ({
        member_id: r[idx["member_id"]] ?? "",
        name: r[idx["name"]] ?? "",
        active: String(r[idx["active"]] ?? "TRUE").toUpperCase() === "TRUE",
      }))
      .filter((m) => m.member_id && m.name);

    res.json({ members });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read members" });
  }
});

// ---- SETTINGS ----
app.get("/settings", async (_req, res) => {
  try {
    const s = await loadSettings();
    res.json({ settings: s });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

app.post("/settings", async (req, res) => {
  try {
    const { one_way_total, two_way_total } = req.body || {};
    const one = Number(one_way_total);
    const two = Number(two_way_total);

    if (!Number.isFinite(one) || one <= 0) return res.status(400).json({ error: "one_way_total must be a positive number" });
    if (!Number.isFinite(two) || two <= 0) return res.status(400).json({ error: "two_way_total must be a positive number" });
    if (two < one) return res.status(400).json({ error: "two_way_total should be >= one_way_total" });

    const rows = await getValues(`${TAB_SETTINGS}!A:B`);
    const data = rows.length ? rows : [["key", "value"]];

    const upsert = (key, value) => {
      const i = data.findIndex((r, idx) => idx > 0 && r[0] === key);
      if (i >= 0) data[i] = [key, String(value)];
      else data.push([key, String(value)]);
    };

    upsert("one_way_total", one);
    upsert("two_way_total", two);

    await setValues(`${TAB_SETTINGS}!A1:B${data.length}`, data);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ---- HOLIDAYS (US federal, observed) ----
app.get("/holidays", async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }
    const [yStr, mStr] = String(month).split("-");
    const year = Number(yStr);
    const list = usFederalHolidaysObservedForYear(year).filter((h) => h.date.startsWith(month));
    res.json({ holidays: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to compute holidays" });
  }
});

// ---- ENTRIES ----
app.get("/entries", async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }

    const entryRows = await getValues(`${TAB_DAY_ENTRIES}!A:H`);
    const riderRows = await getValues(`${TAB_DAY_RIDERS}!A:E`);

    const entries = [];
    if (entryRows.length > 1) {
      const h = entryRows[0];
      const idx = {};
      h.forEach((x, i) => (idx[x] = i));

      for (const r of entryRows.slice(1)) {
        const date = r[idx["date"]] ?? "";
        if (!date.startsWith(month)) continue;

        entries.push({
          entry_id: r[idx["entry_id"]] ?? "",
          date,
          driver_id: r[idx["driver_id"]] ?? "",
          day_type: r[idx["day_type"]] ?? "",
          day_total_used: Number(r[idx["day_total_used"]] ?? 0),
          total_amount: Number(r[idx["total_amount"]] ?? 0),
          notes: r[idx["notes"]] ?? "",
          created_at: r[idx["created_at"]] ?? "",
          riders: [],
        });
      }
    }

    const byId = new Map(entries.map((e) => [e.entry_id, e]));
    if (riderRows.length > 1) {
      const h = riderRows[0];
      const idx = {};
      h.forEach((x, i) => (idx[x] = i));

      for (const r of riderRows.slice(1)) {
        const entry_id = r[idx["entry_id"]] ?? "";
        const e = byId.get(entry_id);
        if (!e) continue;

        e.riders.push({
          member_id: r[idx["member_id"]] ?? "",
          trip_type: r[idx["trip_type"]] ?? "",
          units: Number(r[idx["units"]] ?? 0),
          charge: Number(r[idx["charge"]] ?? 0),
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

// ---- UPSERT ENTRY (fixed total + weighted split) ----
app.post("/entries", async (req, res) => {
  try {
    const { date, driver_id, day_type, riders, notes = "" } = req.body || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: "date required as YYYY-MM-DD" });
    }
    if (!driver_id) return res.status(400).json({ error: "driver_id required" });
    if (!["one_way", "two_way"].includes(day_type)) {
      return res.status(400).json({ error: "day_type must be one_way or two_way" });
    }
    if (!Array.isArray(riders) || riders.length === 0) {
      return res.status(400).json({ error: "riders must be a non-empty array" });
    }
    if (!riders.some((x) => x.member_id === driver_id)) {
      return res.status(400).json({ error: "Driver must be included in riders" });
    }

    const totals = await loadSettings();
    const day_total_used = day_type === "one_way" ? totals.one_way_total : totals.two_way_total;

    if (!Number.isFinite(day_total_used) || day_total_used <= 0) {
      return res.status(400).json({ error: "Day total not set in settings" });
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

    const sumCharges = computed.reduce((s, r) => s + r.charge, 0);
    const drift = round2(day_total_used - sumCharges);
    if (Math.abs(drift) >= 0.01) {
      const i = computed.findIndex((x) => x.member_id === driver_id);
      if (i >= 0) computed[i].charge = round2(computed[i].charge + drift);
    }

    const total_amount = round2(computed.reduce((s, r) => s + r.charge, 0));
    const created_at = new Date().toISOString();

    const entryHeader = ["entry_id","date","driver_id","day_type","day_total_used","total_amount","notes","created_at"];
    const entryRows = await getValues(`${TAB_DAY_ENTRIES}!A:H`);
    const entryData = entryRows.length ? entryRows : [entryHeader];

    const existingIdx = entryData.findIndex((r, i) => i > 0 && r[1] === date);
    const entryRow = [
      date,
      date,
      driver_id,
      day_type,
      String(day_total_used),
      String(total_amount),
      notes,
      created_at,
    ];

    if (existingIdx > 0) {
      entryData[existingIdx] = entryRow;
      await setValues(`${TAB_DAY_ENTRIES}!A1:H${entryData.length}`, entryData);
    } else {
      await appendValues(`${TAB_DAY_ENTRIES}!A:H`, [entryRow]);
    }

    const riderHeader = ["entry_id","member_id","trip_type","units","charge"];
    const riderRows = await getValues(`${TAB_DAY_RIDERS}!A:E`);
    const riderData = riderRows.length ? riderRows : [riderHeader];

    const kept = [riderHeader, ...riderData.slice(1).filter((r) => (r[0] ?? "") !== date)];
    for (const c of computed) {
      kept.push([c.entry_id, c.member_id, c.trip_type, String(c.units), String(c.charge)]);
    }
    await setValues(`${TAB_DAY_RIDERS}!A1:E${kept.length}`, kept);

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

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));

