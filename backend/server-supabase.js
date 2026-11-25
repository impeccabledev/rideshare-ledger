import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import twilio from "twilio";
import cron from "node-cron";
import { createSupabaseBackend } from "./supabase.js";

dotenv.config({ path: new URL("./.env", import.meta.url) });

const app = express();
app.use(cors());
app.use(express.json());

const {
  PORT = 4000,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  APP_URL,
} = process.env;

const db = createSupabaseBackend();

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const normalizeGroupId = (value) => String(value || "").trim().toLowerCase();
const normalizePhone = (value) => String(value || "").trim().replace(/[^\d+]/g, "");
const unitsForTrip = (tripType) => tripType === "one_way" ? 1 : tripType === "two_way" ? 2 : 0;
const internalEntryId = (groupId, date) => `${normalizeGroupId(groupId)}:${date}`;

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

function observedHoliday(year, month, day) {
  const date = new Date(year, month, day);
  if (date.getDay() === 6) date.setDate(date.getDate() - 1);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date;
}

function fmtDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function federalHolidays(year) {
  const holidays = [
    { date: observedHoliday(year, 0, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 0, 1, 3), name: "MLK Day" },
    { date: nthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents' Day" },
    { date: lastWeekdayOfMonth(year, 4, 1), name: "Memorial Day" },
    { date: observedHoliday(year, 5, 19), name: "Juneteenth Day" },
    { date: observedHoliday(year, 6, 4), name: "Independence Day" },
    { date: nthWeekdayOfMonth(year, 8, 1, 1), name: "Labor Day" },
    { date: nthWeekdayOfMonth(year, 9, 1, 2), name: "Columbus Day" },
    { date: observedHoliday(year, 10, 11), name: "Veterans Day" },
    { date: nthWeekdayOfMonth(year, 10, 4, 4), name: "Thanksgiving Day" },
    { date: observedHoliday(year, 11, 25), name: "Christmas Day" },
  ];
  return holidays.map(({ date, name }) => ({ date: fmtDate(date), name }));
}

function throwDbError(error, message = "Database operation failed") {
  if (error) {
    console.error(message, error);
    const result = new Error(message);
    result.statusCode = 500;
    throw result;
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), service: "rideshare-ledger" });
});

app.get("/group_check", async (req, res) => {
  try {
    const groupId = normalizeGroupId(req.headers["x-group-id"]);
    const joinCode = String(req.headers["x-join-code"] || "").trim();
    if (!groupId || !joinCode) {
      return res.status(400).json({ error: "Missing x-group-id or x-join-code headers" });
    }

    const { data, error } = await db.rpc("verify_group", {
      p_group_id: groupId,
      p_join_code: joinCode,
    });
    throwDbError(error, "Failed to verify group");

    if (!data) return res.status(401).json({ error: "Invalid group id or join code" });
    res.json({ ok: true, group_id: groupId });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || "Group check failed" });
  }
});

app.get("/members", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  const { data, error } = await db
    .from("members")
    .select("member_id,name,phone,active,one_way_total,two_way_total")
    .eq("group_id", groupId)
    .order("name");
  if (error) {
    console.error("[MEMBERS] Supabase query failed:", error.message);
    return res.status(500).json({ error: "Failed to read members" });
  }

  res.json({ members: (data || []).map((member) => ({
    ...member,
    phone: normalizePhone(member.phone),
    one_way_total: Number(member.one_way_total || 0),
    two_way_total: Number(member.two_way_total || 0),
  })) });
});

app.post("/members", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { name, phone, active = true, member_id } = req.body || {};
    const normalizedName = String(name || "").trim();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName) return res.status(400).json({ error: "name is required" });

    const id = String(member_id || "").trim() || `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const { data: existing } = await db
      .from("members")
      .select("member_id,name,phone")
      .eq("group_id", groupId)
      .or(`member_id.eq.${id},phone.eq.${normalizedPhone}`);

    if ((existing || []).length) return res.status(409).json({ error: "Member already exists" });

    const { data, error } = await db.from("members").insert({
      member_id: id,
      group_id: groupId,
      name: normalizedName,
      phone: normalizedPhone,
      active: !!active,
      one_way_total: 0,
      two_way_total: 0,
    }).select("member_id,name,phone,active,one_way_total,two_way_total").single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Failed to create member" });
    }

    res.status(201).json({ member: {
      ...data,
      phone: normalizePhone(data.phone),
      one_way_total: Number(data.one_way_total || 0),
      two_way_total: Number(data.two_way_total || 0),
    } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create member" });
  }
});

app.post("/member_rates", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  const { member_id, one_way_total, two_way_total } = req.body || {};
  const one = Number(one_way_total);
  const two = Number(two_way_total);
  if (!member_id) return res.status(400).json({ error: "member_id required" });
  if (!Number.isFinite(one) || one <= 0) return res.status(400).json({ error: "one_way_total must be positive" });
  if (!Number.isFinite(two) || two <= 0) return res.status(400).json({ error: "two_way_total must be positive" });
  if (two < one) return res.status(400).json({ error: "two_way_total should be >= one_way_total" });

  const { data, error } = await db
    .from("members")
    .update({ one_way_total: one, two_way_total: two })
    .eq("group_id", groupId)
    .eq("member_id", member_id)
    .select("member_id")
    .maybeSingle();

  if (error) return res.status(500).json({ error: "Failed to update member rates" });
  if (!data) return res.status(404).json({ error: "member not found" });
  res.json({ ok: true });
});

app.get("/holidays", (req, res) => {
  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month required as YYYY-MM" });
  const year = Number(month.slice(0, 4));
  res.json({ holidays: federalHolidays(year).filter((holiday) => holiday.date.startsWith(month)) });
});

app.get("/entries", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month required as YYYY-MM" });

  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;

  const { data: entryRows, error: entryError } = await db
    .from("entries")
    .select("entry_id,date,driver_id,day_type,day_total_used,total_amount,notes,created_at")
    .eq("group_id", groupId)
    .gte("date", `${month}-01`)
    .lt("date", nextMonth)
    .order("date");
  if (entryError) return res.status(500).json({ error: "Failed to read entries" });

  const internalIds = (entryRows || []).map((entry) => entry.entry_id);
  const { data: riderRows, error: riderError } = internalIds.length
    ? await db
        .from("entry_riders")
        .select("entry_id,member_id,trip_type,units,charge")
        .eq("group_id", groupId)
        .in("entry_id", internalIds)
    : { data: [], error: null };
  if (riderError) return res.status(500).json({ error: "Failed to read entries" });

  const ridersByEntry = new Map();
  for (const rider of riderRows || []) {
    if (!ridersByEntry.has(rider.entry_id)) ridersByEntry.set(rider.entry_id, []);
    ridersByEntry.get(rider.entry_id).push({
      member_id: rider.member_id,
      trip_type: rider.trip_type,
      units: Number(rider.units),
      charge: Number(rider.charge),
    });
  }

  res.json({ entries: (entryRows || []).map((entry) => ({
    entry_id: entry.date,
    date: entry.date,
    driver_id: entry.driver_id,
    day_type: entry.day_type,
    day_total_used: Number(entry.day_total_used),
    total_amount: Number(entry.total_amount),
    notes: entry.notes,
    created_at: entry.created_at,
    riders: ridersByEntry.get(entry.entry_id) || [],
  })) });
});

app.post("/entries", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  try {
    const { date, driver_id, day_type, riders = [], notes = "" } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return res.status(400).json({ error: "date required as YYYY-MM-DD" });
    if (!driver_id) return res.status(400).json({ error: "driver_id required" });
    if (!["one_way", "two_way"].includes(day_type)) return res.status(400).json({ error: "day_type must be one_way or two_way" });
    if (!Array.isArray(riders)) return res.status(400).json({ error: "riders must be an array" });

    const { data: driver, error: driverError } = await db
      .from("members")
      .select("member_id,one_way_total,two_way_total")
      .eq("group_id", groupId)
      .eq("member_id", driver_id)
      .maybeSingle();
    if (driverError) return res.status(500).json({ error: "Failed to load driver" });
    if (!driver) return res.status(400).json({ error: "Driver not found in members" });

    const dayTotalUsed = day_type === "one_way" ? Number(driver.one_way_total) : Number(driver.two_way_total);
    const entryId = internalEntryId(groupId, date);
    let totalAmount = 0;
    let computedRiders = [];

    if (riders.length) {
      if (!riders.some((rider) => rider.member_id === driver_id)) return res.status(400).json({ error: "Driver must be included in riders" });
      if (!Number.isFinite(dayTotalUsed) || dayTotalUsed <= 0) return res.status(400).json({ error: "Driver rates not set (one_way_total/two_way_total)" });

      const units = riders.map((rider) => {
        if (!rider.member_id) throw new Error("Missing member_id in riders");
        if (!["one_way", "two_way"].includes(rider.trip_type)) throw new Error("Invalid trip_type in riders");
        return {
          entry_id: entryId,
          member_id: rider.member_id,
          trip_type: rider.trip_type,
          units: unitsForTrip(rider.trip_type),
          group_id: groupId,
        };
      });
      const totalUnits = units.reduce((sum, rider) => sum + rider.units, 0);
      if (totalUnits <= 0) return res.status(400).json({ error: "No valid riders/units" });

      computedRiders = units.map((rider) => ({
        ...rider,
        charge: round2(dayTotalUsed * (rider.units / totalUnits)),
      }));

      const chargeSum = computedRiders.reduce((sum, rider) => sum + rider.charge, 0);
      const drift = round2(dayTotalUsed - chargeSum);
      if (Math.abs(drift) >= 0.01) {
        const driverRider = computedRiders.find((rider) => rider.member_id === driver_id);
        if (driverRider) driverRider.charge = round2(driverRider.charge + drift);
      }
      totalAmount = round2(computedRiders.reduce((sum, rider) => sum + rider.charge, 0));
    }

    const createdAt = new Date().toISOString();
    const { error: entryError } = await db.from("entries").upsert({
      entry_id: entryId,
      group_id: groupId,
      date,
      driver_id,
      day_type,
      day_total_used: dayTotalUsed,
      total_amount: totalAmount,
      notes: String(notes || ""),
      created_at: createdAt,
    }, { onConflict: "group_id,date" });
    if (entryError) {
      console.error(entryError);
      return res.status(500).json({ error: "Failed to save entry" });
    }

    await db.from("entry_riders").delete().eq("group_id", groupId).eq("entry_id", entryId);
    if (computedRiders.length) {
      const { error: riderError } = await db.from("entry_riders").insert(computedRiders);
      if (riderError) {
        console.error(riderError);
        return res.status(500).json({ error: "Failed to save entry riders" });
      }
    }

    res.status(201).json({ entry: {
      entry_id: date,
      date,
      driver_id,
      day_type,
      day_total_used: dayTotalUsed,
      total_amount: totalAmount,
      notes: String(notes || ""),
      created_at: createdAt,
      riders: computedRiders.map(({ entry_id, group_id, ...rider }) => rider),
    } });
  } catch (error) {
    console.error(error);
    if (String(error.message).includes("Invalid trip_type")) {
      return res.status(400).json({ error: "riders.trip_type must be one_way or two_way" });
    }
    res.status(500).json({ error: "Failed to save entry" });
  }
});

app.delete("/entries/:date", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date required as YYYY-MM-DD" });

  const entryId = internalEntryId(groupId, date);
  await db.from("entry_riders").delete().eq("group_id", groupId).eq("entry_id", entryId);
  const { error } = await db.from("entries").delete().eq("group_id", groupId).eq("date", date);
  if (error) return res.status(500).json({ error: "Failed to delete entry" });
  res.json({ ok: true, deleted: date });
});

app.post("/notify", async (req, res) => {
  const groupId = normalizeGroupId(req.headers["x-group-id"]);
  if (!groupId) return res.status(400).json({ error: "Missing x-group-id header" });

  const { message = "Reminder: please add today's ride details." } = req.body || {};
  const { data: members, error } = await db
    .from("members")
    .select("member_id,name,phone,active")
    .eq("group_id", groupId)
    .eq("active", true);
  if (error) return res.status(500).json({ error: "Failed to notify" });

  const appUrl = APP_URL || "https://your-app-url.com";
  const fullMessage = `Hi! ${message}\n\nAdd your ride details here: ${appUrl}`;
  const results = [];

  for (const member of members || []) {
    const phone = normalizePhone(member.phone);
    if (!phone) continue;
    if (twilioClient && TWILIO_PHONE_NUMBER) {
      try {
        await twilioClient.messages.create({ body: fullMessage, from: TWILIO_PHONE_NUMBER, to: phone });
        results.push({ member_id: member.member_id, name: member.name, phone, status: "sent" });
      } catch (smsError) {
        results.push({ member_id: member.member_id, name: member.name, phone, status: "failed", error: smsError.message });
      }
    } else {
      results.push({ member_id: member.member_id, name: member.name, phone, status: "pending", message: fullMessage });
    }
  }

  res.json({
    ok: true,
    message,
    appUrl,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed").length,
    recipients: results,
  });
});

if (process.env.NODE_ENV !== "test") {
  const keepaliveSchedule = process.env.KEEPALIVE_TEST === "1" ? "*/1 * * * *" : (process.env.KEEPALIVE_SCHEDULE || "*/14 * * * *");
  cron.schedule(keepaliveSchedule, async () => {
    try {
      await fetch(`http://localhost:${PORT}/health`);
    } catch (error) {
      console.error("[KEEPALIVE] Local ping failed:", error.message);
    }
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
