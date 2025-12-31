// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(cors()); // tighten later to your Vercel domain
app.use(express.json());

const {
  PORT = 4000,
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
} = process.env;

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

// ===== Tabs =====
const TAB_GROUPS = "groups"; // group_id, group_name, join_code, active
const TAB_MEMBERS = "members"; // member_id, name, active, one_way_total, two_way_total, group_id
const TAB_DAY_ENTRIES = "day_entries"; // entry_id, date, driver_id, day_type, day_total_used, total_amount, notes, created_at, group_id
const TAB_DAY_RIDERS = "day_riders"; // entry_id, member_id, trip_type, units, charge, group_id

// ===== Sheet helpers =====
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

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function unitsForTrip(trip_type) {
  if (trip_type === "one_way") return 1;
  if (trip_type === "two_way") return 2;
  return 0;
}

// ===== US Federal holidays (observed) =====
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

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
  holidays.push({ date: nthWeekdayOfMonth(year, 1, 1, 3), name: "President's's Day" });
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

// ===== Group auth (join-code based) =====
async function requireGroup(req, res, next) {
  try {
    const group_id = String(req.header("x-group-id") || "");
    const join_code = String(req.header("x-join-code") || "");

    if (!group_id || !join_code) {
      return res.status(401).json({ error: "Missing x-group-id / x-join-code" });
    }

    const rows = await getValues(`${TAB_GROUPS}!A:Z`);
    if (rows.length <= 1) return res.status(500).json({ error: "groups sheet empty" });

    const header = rows[0];
    const idx = {};
    header.forEach((h, i) => (idx[h] = i));

    const row = rows.find((r, i) => i > 0 && String(r[idx["group_id"]] ?? "") === group_id);
    if (!row) return res.status(401).json({ error: "Invalid group" });

    const active = String(row[idx["active"]] ?? "TRUE").toUpperCase() === "TRUE";
    if (!active) return res.status(403).json({ error: "Group inactive" });

    const code = String(row[idx["join_code"]] ?? "");
    if (code !== join_code) return res.status(401).json({ error: "Invalid join code" });

    req.group_id = group_id;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Group auth failed" });
  }
}

// ===== Utility: ensure columns exist in a sheet header =====
function ensureCols(header, idx, cols) {
  let changed = false;
  for (const col of cols) {
    if (idx[col] == null) {
      header.push(col);
      idx[col] = header.length - 1;
      changed = true;
    }
  }
  return changed;
}

// ===== Health =====
app.get("/health", async (_req, res) => {
  try {
    await getValues(`${TAB_GROUPS}!A1:A1`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Sheets auth/read failed" });
  }
});

// Optional: quick validate for join screen
app.get("/group_check", requireGroup, async (req, res) => {
  res.json({ ok: true, group_id: req.group_id });
});

// ===== HOLIDAYS (public) =====
app.get("/holidays", async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }
    const year = Number(String(month).slice(0, 4));
    const list = usFederalHolidaysObservedForYear(year).filter((h) => h.date.startsWith(String(month)));
    res.json({ holidays: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to compute holidays" });
  }
});

// ===== MEMBERS =====
app.get("/members", requireGroup, async (req, res) => {
  try {
    const rows = await getValues(`${TAB_MEMBERS}!A:Z`);
    if (rows.length <= 1) return res.json({ members: [] });

    const header = rows[0];
    const idx = {};
    header.forEach((h, i) => (idx[h] = i));

    // tolerate older sheets missing cols
    ensureCols(header, idx, ["member_id", "name", "active", "one_way_total", "two_way_total", "group_id"]);

    const members = rows
      .slice(1)
      .filter((r) => r.length)
      .map((r) => ({
        member_id: r[idx["member_id"]] ?? "",
        name: r[idx["name"]] ?? "",
        active: String(r[idx["active"]] ?? "TRUE").toUpperCase() === "TRUE",
        one_way_total: Number(r[idx["one_way_total"]] ?? 0),
        two_way_total: Number(r[idx["two_way_total"]] ?? 0),
        group_id: r[idx["group_id"]] ?? "",
      }))
      .filter((m) => m.member_id && m.name && String(m.group_id) === req.group_id);

    res.json({ members });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to read members" });
  }
});

// Create member under this group
app.post("/members", requireGroup, async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2) return res.status(400).json({ error: "name required" });

    const rows = await getValues(`${TAB_MEMBERS}!A:Z`);
    if (rows.length <= 0) return res.status(400).json({ error: "members sheet missing header" });

    const header = rows[0];
    const idx = {};
    header.forEach((h, i) => (idx[h] = i));

    const changed = ensureCols(header, idx, ["member_id", "name", "active", "one_way_total", "two_way_total", "group_id"]);
    if (changed) {
      await setValues(`${TAB_MEMBERS}!A1:Z1`, [header]);
    }

    // prevent duplicate name in same group
    const dupe = rows
      .slice(1)
      .some(
        (r) =>
          String(r[idx["group_id"]] ?? "") === req.group_id &&
          String(r[idx["name"]] ?? "").trim().toLowerCase() === name.toLowerCase()
      );
    if (dupe) return res.status(409).json({ error: "Member name already exists in this group" });

    const member_id = `m_${Date.now()}`;
    const newRow = new Array(header.length).fill("");
    newRow[idx["member_id"]] = member_id;
    newRow[idx["name"]] = name;
    newRow[idx["active"]] = "TRUE";
    newRow[idx["one_way_total"]] = "0";
    newRow[idx["two_way_total"]] = "0";
    newRow[idx["group_id"]] = req.group_id;

    await appendValues(`${TAB_MEMBERS}!A:Z`, [newRow]);

    res.status(201).json({
      member: {
        member_id,
        name,
        active: true,
        one_way_total: 0,
        two_way_total: 0,
        group_id: req.group_id,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create member" });
  }
});

// Update a member’s rates (only within the group)
app.post("/member_rates", requireGroup, async (req, res) => {
  try {
    const member_id = String(req.body?.member_id ?? "");
    const one = Number(req.body?.one_way_total);
    const two = Number(req.body?.two_way_total);

    if (!member_id) return res.status(400).json({ error: "member_id required" });
    if (!Number.isFinite(one) || one <= 0) return res.status(400).json({ error: "one_way_total must be positive" });
    if (!Number.isFinite(two) || two <= 0) return res.status(400).json({ error: "two_way_total must be positive" });
    if (two < one) return res.status(400).json({ error: "two_way_total should be >= one_way_total" });

    const rows = await getValues(`${TAB_MEMBERS}!A:Z`);
    if (rows.length <= 1) return res.status(400).json({ error: "members sheet empty" });

    const header = rows[0];
    const idx = {};
    header.forEach((h, i) => (idx[h] = i));

    const changed = ensureCols(header, idx, ["member_id", "one_way_total", "two_way_total", "group_id"]);
    if (changed) await setValues(`${TAB_MEMBERS}!A1:Z1`, [header]);

    const rowIndex = rows.findIndex((r, i) => i > 0 && String(r[idx["member_id"]] ?? "") === member_id);
    if (rowIndex < 0) return res.status(404).json({ error: "member not found" });

    const memberGroup = String(rows[rowIndex][idx["group_id"]] ?? "");
    if (memberGroup !== req.group_id) return res.status(403).json({ error: "Member not in this group" });

    while (rows[rowIndex].length < header.length) rows[rowIndex].push("");

    rows[rowIndex][idx["one_way_total"]] = String(one);
    rows[rowIndex][idx["two_way_total"]] = String(two);

    await setValues(`${TAB_MEMBERS}!A1:Z${rows.length}`, rows);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update member rates" });
  }
});

// ===== ENTRIES =====

// Read entries for group + month
app.get("/entries", requireGroup, async (req, res) => {
  try {
    const month = String(req.query?.month ?? "");
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month required as YYYY-MM" });
    }

    const entryRows = await getValues(`${TAB_DAY_ENTRIES}!A:Z`);
    const riderRows = await getValues(`${TAB_DAY_RIDERS}!A:Z`);

    const entries = [];
    if (entryRows.length > 1) {
      const h = entryRows[0];
      const idx = {};
      h.forEach((x, i) => (idx[x] = i));
      ensureCols(h, idx, ["entry_id","date","driver_id","day_type","day_total_used","total_amount","notes","created_at","group_id"]);

      for (const r of entryRows.slice(1)) {
        const date = String(r[idx["date"]] ?? "");
        const gid = String(r[idx["group_id"]] ?? "");
        if (!date.startsWith(month)) continue;
        if (gid !== req.group_id) continue;

        entries.push({
          entry_id: String(r[idx["entry_id"]] ?? ""),
          date,
          driver_id: String(r[idx["driver_id"]] ?? ""),
          day_type: String(r[idx["day_type"]] ?? ""),
          day_total_used: Number(r[idx["day_total_used"]] ?? 0),
          total_amount: Number(r[idx["total_amount"]] ?? 0),
          notes: String(r[idx["notes"]] ?? ""),
          created_at: String(r[idx["created_at"]] ?? ""),
          group_id: gid,
          riders: [],
        });
      }
    }

    const byId = new Map(entries.map((e) => [e.entry_id, e]));

    if (riderRows.length > 1) {
      const h = riderRows[0];
      const idx = {};
      h.forEach((x, i) => (idx[x] = i));
      ensureCols(h, idx, ["entry_id","member_id","trip_type","units","charge","group_id"]);

      for (const r of riderRows.slice(1)) {
        const gid = String(r[idx["group_id"]] ?? "");
        if (gid !== req.group_id) continue;

        const entry_id = String(r[idx["entry_id"]] ?? "");
        const e = byId.get(entry_id);
        if (!e) continue;

        e.riders.push({
          member_id: String(r[idx["member_id"]] ?? ""),
          trip_type: String(r[idx["trip_type"]] ?? ""),
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

// Upsert entry for a date (group scoped) + weighted split
app.post("/entries", requireGroup, async (req, res) => {
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

    // Load members and validate group membership
    const membersRows = await getValues(`${TAB_MEMBERS}!A:Z`);
    if (membersRows.length <= 1) return res.status(400).json({ error: "members sheet empty" });

    const mh = membersRows[0];
    const midx = {};
    mh.forEach((h, i) => (midx[h] = i));
    ensureCols(mh, midx, ["member_id","name","active","one_way_total","two_way_total","group_id"]);

    const memberMap = new Map();
    for (const r of membersRows.slice(1)) {
      const id = String(r[midx["member_id"]] ?? "");
      if (!id) continue;
      memberMap.set(id, r);
    }

    const driverRow = memberMap.get(String(driver_id));
    if (!driverRow) return res.status(400).json({ error: "Driver not found in members" });
    if (String(driverRow[midx["group_id"]] ?? "") !== req.group_id) {
      return res.status(403).json({ error: "Driver not in this group" });
    }

    for (const rr of riders) {
      const rid = String(rr.member_id ?? "");
      const row = memberMap.get(rid);
      if (!row) return res.status(400).json({ error: `Unknown rider member_id: ${rid}` });
      if (String(row[midx["group_id"]] ?? "") !== req.group_id) {
        return res.status(403).json({ error: `Rider not in this group: ${rid}` });
      }
      if (!["one_way", "two_way"].includes(String(rr.trip_type ?? ""))) {
        return res.status(400).json({ error: "riders.trip_type must be one_way or two_way" });
      }
    }

    const driverOne = Number(driverRow[midx["one_way_total"]] ?? 0);
    const driverTwo = Number(driverRow[midx["two_way_total"]] ?? 0);

    const day_total_used = day_type === "one_way" ? driverOne : driverTwo;
    if (!Number.isFinite(day_total_used) || day_total_used <= 0) {
      return res.status(400).json({ error: "Driver rates not set (one_way_total/two_way_total)" });
    }

    // Compute weighted split
    const riderUnits = riders.map((x) => ({
      entry_id: date, // we use date as entry_id (same as your existing design)
      member_id: String(x.member_id),
      trip_type: String(x.trip_type),
      units: unitsForTrip(String(x.trip_type)),
    }));

    const total_units = riderUnits.reduce((s, r) => s + r.units, 0);
    if (total_units <= 0) return res.status(400).json({ error: "No valid riders/units" });

    const computed = riderUnits.map((r) => ({
      ...r,
      charge: round2(day_total_used * (r.units / total_units)),
    }));

    // Fix rounding drift to driver
    const sumCharges = computed.reduce((s, r) => s + r.charge, 0);
    const drift = round2(day_total_used - sumCharges);
    if (Math.abs(drift) >= 0.01) {
      const i = computed.findIndex((x) => x.member_id === String(driver_id));
      if (i >= 0) computed[i].charge = round2(computed[i].charge + drift);
    }

    const total_amount = round2(computed.reduce((s, r) => s + r.charge, 0));
    const created_at = new Date().toISOString();

    // ---- Upsert day_entries ----
    const entryHeader = ["entry_id","date","driver_id","day_type","day_total_used","total_amount","notes","created_at","group_id"];
    const entryRows = await getValues(`${TAB_DAY_ENTRIES}!A:Z`);
    const entryData = entryRows.length ? entryRows : [entryHeader];

    // ensure header columns
    const eh = entryData[0];
    const eidx = {};
    eh.forEach((h, i) => (eidx[h] = i));
    const entryHeaderChanged = ensureCols(eh, eidx, entryHeader);

    if (entryHeaderChanged) {
      entryData[0] = eh;
      await setValues(`${TAB_DAY_ENTRIES}!A1:Z1`, [eh]);
    }

    // Find existing by date+group (safer than date only)
    const existingIdx = entryData.findIndex(
      (r, i) =>
        i > 0 &&
        String(r[eidx["date"]] ?? "") === String(date) &&
        String(r[eidx["group_id"]] ?? "") === req.group_id
    );

    // Build row aligned to header
    const entryRow = new Array(eh.length).fill("");
    entryRow[eidx["entry_id"]] = String(date);
    entryRow[eidx["date"]] = String(date);
    entryRow[eidx["driver_id"]] = String(driver_id);
    entryRow[eidx["day_type"]] = String(day_type);
    entryRow[eidx["day_total_used"]] = String(day_total_used);
    entryRow[eidx["total_amount"]] = String(total_amount);
    entryRow[eidx["notes"]] = String(notes ?? "");
    entryRow[eidx["created_at"]] = String(created_at);
    entryRow[eidx["group_id"]] = String(req.group_id);

    if (existingIdx > 0) {
      entryData[existingIdx] = entryRow;
      await setValues(`${TAB_DAY_ENTRIES}!A1:Z${entryData.length}`, entryData);
    } else {
      // appendValues expects just row values in order; easiest is append full row
      await appendValues(`${TAB_DAY_ENTRIES}!A:Z`, [entryRow]);
    }

    // ---- Upsert day_riders ----
    const riderHeader = ["entry_id","member_id","trip_type","units","charge","group_id"];
    const riderRows = await getValues(`${TAB_DAY_RIDERS}!A:Z`);
    const riderData = riderRows.length ? riderRows : [riderHeader];

    const rh = riderData[0];
    const ridx = {};
    rh.forEach((h, i) => (ridx[h] = i));
    const riderHeaderChanged = ensureCols(rh, ridx, riderHeader);

    if (riderHeaderChanged) {
      riderData[0] = rh;
      await setValues(`${TAB_DAY_RIDERS}!A1:Z1`, [rh]);
    }

    // Keep all rows not matching this (entry_id+group), then append new computed rows
    const kept = [rh, ...riderData.slice(1).filter((r) => {
      const eid = String(r[ridx["entry_id"]] ?? "");
      const gid = String(r[ridx["group_id"]] ?? "");
      return !(eid === String(date) && gid === req.group_id);
    })];

    for (const c of computed) {
      const row = new Array(rh.length).fill("");
      row[ridx["entry_id"]] = String(c.entry_id);
      row[ridx["member_id"]] = String(c.member_id);
      row[ridx["trip_type"]] = String(c.trip_type);
      row[ridx["units"]] = String(c.units);
      row[ridx["charge"]] = String(c.charge);
      row[ridx["group_id"]] = String(req.group_id);
      kept.push(row);
    }

    await setValues(`${TAB_DAY_RIDERS}!A1:Z${kept.length}`, kept);

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
        group_id: req.group_id,
        riders: computed.map(({ entry_id, ...rest }) => rest),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});