import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(cors()); // tighten later to your deployed frontend domain
app.use(express.json());

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

function pad2(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
    const groupId = req.headers["x-group-id"];
    const joinCode = req.headers["x-join-code"];

    if (!groupId || !joinCode) {
      return res.status(400).json({ error: "Missing x-group-id or x-join-code headers" });
    }

    // For now, just validate that the headers are present
    // In a more complete implementation, you could validate against stored groups
    res.json({ ok: true, group_id: groupId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Group check failed" });
  }
});

/** Ensure members header has required columns. Returns {rows, idx}. */
async function loadMembersSheetEnsuringColumns() {
  const rows = await getValues(`${TAB_MEMBERS}!A:Z`);
  if (!rows.length) {
    // Create a default header row if sheet is empty
    const header = ["member_id", "name", "phone", "active", "one_way_total", "two_way_total"];
    await setValues(`${TAB_MEMBERS}!A1:F1`, [header]);
    return { rows: [header], idx: header.reduce((a, h, i) => ((a[h] = i), a), {}) };
  }

  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => (idx[h] = i));

  const ensureCol = async (col) => {
    if (idx[col] == null) {
      header.push(col);
      idx[col] = header.length - 1;
      await setValues(`${TAB_MEMBERS}!A1:${String.fromCharCode(65 + header.length - 1)}1`, [header]);
    }
  };

  await ensureCol("member_id");
  await ensureCol("name");
  await ensureCol("phone");
  await ensureCol("active");
  await ensureCol("one_way_total");
  await ensureCol("two_way_total");

  // Reload full range after header change (simple + safe)
  const rows2 = await getValues(`${TAB_MEMBERS}!A:Z`);
  const header2 = rows2[0] || header;
  const idx2 = {};
  header2.forEach((h, i) => (idx2[h] = i));
  return { rows: rows2, idx: idx2 };
}

// ---- MEMBERS ----
app.get("/members", async (_req, res) => {
  try {
    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    if (rows.length <= 1) return res.json({ members: [] });

    const members = rows
      .slice(1)
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
  try {
    const { name, phone, active = true, member_id } = req.body || {};
    const n = String(name || "").trim();
    if (!n) return res.status(400).json({ error: "name is required" });

    const p = normalizePhone(phone);
    const id = String(member_id || "").trim() || genMemberId();

    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    const existing = rows
      .slice(1)
      .some((r) => String(r[idx["member_id"]] ?? "") === id);
    if (existing) return res.status(409).json({ error: "member_id already exists" });

    // Also prevent exact duplicate name+phone collisions (optional sanity)
    const dup = rows
      .slice(1)
      .some(
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

    const rowIndex = rows.findIndex((r, i) => i > 0 && String(r[idx["member_id"]] ?? "") === member_id);
    if (rowIndex < 0) return res.status(404).json({ error: "member not found" });

    while (rows[rowIndex].length < rows[0].length) rows[rowIndex].push("");

    rows[rowIndex][idx["one_way_total"]] = String(one);
    rows[rowIndex][idx["two_way_total"]] = String(two);

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
        if (!String(date).startsWith(month)) continue;

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

// ---- UPSERT ENTRY (per-driver total + weighted split) ----
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

    // Load driver totals from members tab
    const { rows: membersRows, idx: midx } = await loadMembersSheetEnsuringColumns();
    if (membersRows.length <= 1) return res.status(400).json({ error: "members sheet empty" });

    const driverRow = membersRows.find(
      (r, i) => i > 0 && String(r[midx["member_id"]] ?? "") === driver_id
    );
    if (!driverRow) return res.status(400).json({ error: "Driver not found in members" });

    const driverOne = Number(driverRow[midx["one_way_total"]] ?? 0);
    const driverTwo = Number(driverRow[midx["two_way_total"]] ?? 0);

    const day_total_used = day_type === "one_way" ? driverOne : driverTwo;
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

    const entryHeader = ["entry_id","date","driver_id","day_type","day_total_used","total_amount","notes","created_at"];
    const entryRows = await getValues(`${TAB_DAY_ENTRIES}!A:H`);
    const entryData = entryRows.length ? entryRows : [entryHeader];

    const existingIdx = entryData.findIndex((r, i) => i > 0 && String(r[1] ?? "") === date);
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

    const kept = [riderHeader, ...riderData.slice(1).filter((r) => String(r[0] ?? "") !== date)];
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

// ---- NOTIFY (SMS) ----
app.post("/notify", async (req, res) => {
  try {
    const { message = "Reminder: please add today's ride details." } = req.body || {};

    const { rows, idx } = await loadMembersSheetEnsuringColumns();
    const members = rows
      .slice(1)
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});

