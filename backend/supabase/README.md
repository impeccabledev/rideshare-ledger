# Google Sheets to Supabase migration

This migration imports CSV exports from the existing Google Sheet without accessing Google APIs or using Google credentials.

## Group credentials

There is no separate tab migration for login credentials. Previous deployments used `GROUP_CREDENTIALS`, `GROUP_JOIN_CODES`, or a legacy `members` sheet. Recreate each group in Supabase using `public.create_group()` so only a join-code hash is stored:

```sql
select public.create_group('your-group-id', 'your-private-join-code');
```

Do not create a public `groups.csv` or store plain join codes in a migration export.

## 1. Export the Sheet tabs

In Google Sheets, export three tabs as CSV:

- `members` → `members.csv`
- `day_entries` → `day_entries.csv`
- `day_riders` → `day_riders.csv`

Ensure the first row contains the exact headers used by the existing sheet.

For each tab:

1. Open the tab.
2. Select **File → Download → Comma-separated values (.csv)**.
3. Save the file in `backend/supabase/imports/`.

Do not upload CSV files containing phone numbers or private ledger data to public Git repositories.

## 2. Back up Supabase

Create a Supabase backup or retain an exported copy before importing.

## 3. Run the migration

```sh
cd backend
mkdir -p supabase/imports
node supabase/migrate-csv.js testgroup \
  supabase/imports/members.csv \
  supabase/imports/day_entries.csv \
  supabase/imports/day_riders.csv
```

Replace `testgroup` with the destination Supabase group ID. The script:

- Filters each CSV to the selected group when `group_id` is present.
- Uses `entry_id` values as `testgroup:<date>` internally.
- Upserts members and entries.
- Replaces rider rows for the imported entries.

## 4. Verify

Use Supabase Table Editor or run:

```sql
select count(*) from public.members where group_id = 'testgroup';
select count(*) from public.entries where group_id = 'testgroup';
select count(*) from public.entry_riders where group_id = 'testgroup';
```

Before deploying, compare row counts and spot-check one entry through the app.

## Migrate the g1 group

Do not rename or alter `g1`. Create it with the existing private join code:

```sql
select public.create_group('g1', 'your-existing-private-join-code');
```

Then run:

```sh
cd backend
npm run migrate:sheets-csv -- g1 \
  supabase/imports/members.csv \
  supabase/imports/day_entries.csv \
  supabase/imports/day_riders.csv
```

The importer normalizes legacy `G1` and `g1` values to lowercase `g1`. Rows marked `G2` are excluded.
