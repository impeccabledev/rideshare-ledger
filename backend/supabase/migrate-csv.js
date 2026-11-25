import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import ws from "ws";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value !== "" || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, (cells[index] ?? "").trim().replace(/^'/, "")])
  ));
}

function readCsv(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Missing CSV file: ${fileName}`);
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function main() {
  const [groupIdArg, membersFile, entriesFile, ridersFile] = process.argv.slice(2);
  if (!groupIdArg || !membersFile || !entriesFile || !ridersFile) {
    console.error("Usage: node supabase/migrate-csv.js <group-id> <members.csv> <day_entries.csv> <day_riders.csv>");
    process.exit(1);
  }

  const groupId = groupIdArg.trim().toLowerCase();
  if (!groupId) throw new Error("Group ID is required");

  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const memberRows = readCsv(membersFile);
  const entryRows = readCsv(entriesFile);
  const riderRows = readCsv(ridersFile);

  const members = memberRows
    .filter((row) => !row.group_id || row.group_id.trim().toLowerCase() === groupId)
    .filter((row) => row.member_id && row.name)
    .map((row) => ({
      member_id: row.member_id,
      group_id: groupId,
      name: row.name,
      phone: normalizePhone(row.phone),
      active: String(row.active ?? "TRUE").trim().toUpperCase() === "TRUE",
      one_way_total: Number(row.one_way_total || 0),
      two_way_total: Number(row.two_way_total || 0),
    }));

  const entries = entryRows
    .filter((row) => !row.group_id || row.group_id.trim().toLowerCase() === groupId)
    .filter((row) => row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map((row) => {
      const entryId = `${groupId}:${row.date}`;
      return {
        entry_id: entryId,
        group_id: groupId,
        date: row.date,
        driver_id: row.driver_id,
        day_type: row.day_type,
        day_total_used: Number(row.day_total_used || 0),
        total_amount: Number(row.total_amount || 0),
        notes: row.notes || "",
        created_at: row.created_at || new Date().toISOString(),
      };
    });

  const deduplicatedEntries = new Map();
  for (const entry of entries) {
    deduplicatedEntries.set(`${entry.group_id}:${entry.date}`, entry);
  }
  const entriesForUpsert = [...deduplicatedEntries.values()];

  const entryIds = new Set(entriesForUpsert.map((entry) => entry.entry_id));
  const entryRiders = riderRows
    .filter((row) => !row.group_id || row.group_id.trim().toLowerCase() === groupId)
    .filter((row) => row.entry_id && entryIds.has(`${groupId}:${row.entry_id}`))
    .map((row) => ({
      entry_id: `${groupId}:${row.entry_id}`,
      group_id: groupId,
      member_id: row.member_id,
      trip_type: row.trip_type,
      units: Number(row.units || 0),
      charge: Number(row.charge || 0),
    }));

  const deduplicatedMembers = new Map();
  for (const member of members) deduplicatedMembers.set(member.member_id, member);
  const membersForUpsert = [...deduplicatedMembers.values()];

  const deduplicatedRiders = new Map();
  for (const rider of entryRiders) {
    deduplicatedRiders.set(`${rider.entry_id}:${rider.member_id}`, rider);
  }
  const ridersForInsert = [...deduplicatedRiders.values()];

  if (!membersForUpsert.length && !entriesForUpsert.length && !ridersForInsert.length) {
    throw new Error("No matching rows found. Check CSV headers and the group ID.");
  }

  if (membersForUpsert.length) {
    const { error } = await db.from("members").upsert(membersForUpsert, { onConflict: "member_id" });
    if (error) throw new Error(`Member migration failed: ${error.message}`);
  }

  if (entriesForUpsert.length) {
    const { error } = await db.from("entries").upsert(entriesForUpsert, { onConflict: "group_id,date" });
    if (error) throw new Error(`Entry migration failed: ${error.message}`);
  }

  if (ridersForInsert.length) {
    const { error: deleteError } = await db
      .from("entry_riders")
      .delete()
      .eq("group_id", groupId)
      .in("entry_id", ridersForInsert.map((rider) => rider.entry_id));
    if (deleteError) throw new Error(`Rider cleanup failed: ${deleteError.message}`);

    const { error } = await db.from("entry_riders").insert(ridersForInsert);
    if (error) throw new Error(`Rider migration failed: ${error.message}`);
  }

  console.log(`Migrated ${membersForUpsert.length} members, ${entriesForUpsert.length} entries, and ${ridersForInsert.length} rider records for ${groupId}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
