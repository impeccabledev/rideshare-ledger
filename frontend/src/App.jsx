import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  groupCheck,
  getEntries,
  getMembers,
  getHolidays,
  saveEntry,
  updateMemberRates,
  createMember,
} from "./api";

// ---------- date helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");
const fmtMonth = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const fmtDate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const round2 = (x) => Math.round(Number(x) * 100) / 100;

/**
 * Build a Mon–Fri month grid.
 * Each week row has 5 cells. Cells can be null at the month edges.
 */
function weekdayGrid(year, monthIdx0) {
  const first = new Date(year, monthIdx0, 1);
  const last = new Date(year, monthIdx0 + 1, 0);

  // Move to first weekday if month starts on weekend
  let cur = new Date(first);
  while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() + 1);

  const weeks = [];
  while (cur <= last) {
    // Row base = Monday of this week
    const rowBase = new Date(cur);
    const jsDay = rowBase.getDay(); // Mon=1..Fri=5
    const deltaToMon = jsDay - 1;
    rowBase.setDate(rowBase.getDate() - deltaToMon);

    const row = new Array(5).fill(null);
    for (let i = 0; i < 5; i++) {
      const d = new Date(rowBase);
      d.setDate(rowBase.getDate() + i);
      if (d.getMonth() === monthIdx0) row[i] = d;
    }

    weeks.push(row);

    // Next week
    cur = new Date(rowBase);
    cur.setDate(rowBase.getDate() + 7);
    while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() + 1);
  }
  return weeks;
}

// ---------- settlement helpers ----------
function computeMonthBalances(members, entries) {
  const balances = {};
  for (const m of members) balances[m.member_id] = 0;

  for (const e of entries) {
    const total = Number(e.total_amount || 0);
    if (!total) continue;

    const driverId = e.driver_id;
    balances[driverId] = (balances[driverId] || 0) + total;

    for (const r of e.riders || []) {
      const charge = Number(r.charge || 0);
      balances[r.member_id] = (balances[r.member_id] || 0) - charge;
    }
  }

  for (const k of Object.keys(balances)) balances[k] = round2(balances[k]);
  return balances;
}

function suggestTransfers(balances) {
  const creditors = [];
  const debtors = [];
  for (const [id, bal] of Object.entries(balances)) {
    const v = round2(bal);
    if (v > 0.01) creditors.push([id, v]);
    else if (v < -0.01) debtors.push([id, -v]);
  }
  creditors.sort((a, b) => b[1] - a[1]);
  debtors.sort((a, b) => b[1] - a[1]);

  const transfers = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const [debId, debAmt] = debtors[i];
    const [creId, creAmt] = creditors[j];
    const x = Math.min(debAmt, creAmt);
    transfers.push({ from: debId, to: creId, amount: round2(x) });

    debtors[i][1] = round2(debAmt - x);
    creditors[j][1] = round2(creAmt - x);

    if (debtors[i][1] <= 0.01) i++;
    if (creditors[j][1] <= 0.01) j++;
  }
  return transfers;
}

export default function App() {
  // ---- group auth (localStorage) ----
  const [groupId, setGroupId] = useState(localStorage.getItem("group_id") || "");
  const [joinCode, setJoinCode] = useState(localStorage.getItem("join_code") || "");
  const [groupOk, setGroupOk] = useState(false);
  const [authErr, setAuthErr] = useState("");

  const [showSplash, setShowSplash] = useState(true);
  const [monthDate, setMonthDate] = useState(() => new Date());
  const month = useMemo(() => fmtMonth(monthDate), [monthDate]);

  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [holidays, setHolidays] = useState([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // day modal state
  const [open, setOpen] = useState(false);
  const [activeDay, setActiveDay] = useState(null);
  const [driverId, setDriverId] = useState("");
  const [dayType, setDayType] = useState("two_way");
  const [riderTrip, setRiderTrip] = useState({});
  const [notes, setNotes] = useState("");

  // driver rates form (per-driver)
  const [driverRatesForm, setDriverRatesForm] = useState({
    one_way_total: "",
    two_way_total: "",
  });

  // add member
  const [newMemberName, setNewMemberName] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const nameById = useMemo(() => {
    const m = {};
    for (const x of members) m[x.member_id] = x.name;
    return m;
  }, [members]);

  const memberById = useMemo(() => {
    const m = new Map();
    for (const x of members) m.set(x.member_id, x);
    return m;
  }, [members]);

  const holidayByDate = useMemo(() => {
    const map = new Map();
    for (const h of holidays) map.set(h.date, h.name || "");
    return map;
  }, [holidays]);

  async function verifyGroupOrShowJoin() {
    const gid = (localStorage.getItem("group_id") || "").trim();
    const jcode = (localStorage.getItem("join_code") || "").trim();
    if (!gid || !jcode) {
      setGroupOk(false);
      return;
    }
    try {
      setAuthErr("");
      await groupCheck();
      setGroupOk(true);
    } catch (e) {
      setGroupOk(false);
      setAuthErr(e.message || "Invalid group");
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setAuthErr("");
  
    const gid = groupId.trim();
    const jcode = joinCode.trim();
  
    if (!gid || !jcode) {
      setAuthErr("Enter group id + join code");
      return;
    }
  
    // save credentials
    localStorage.setItem("group_id", gid);
    localStorage.setItem("join_code", jcode);
  
    // ✅ show splash every time user joins
    setShowSplash(true);
  
    try {
      await groupCheck();
      setGroupOk(true);
  
      await loadAll();
  
      // ✅ hide splash after a short delay (so it feels intentional)
      setTimeout(() => setShowSplash(false), 1200);
    } catch (err) {
      setGroupOk(false);
      setAuthErr(err.message || "Invalid group");
  
      // ✅ don’t keep splash stuck if join fails
      setShowSplash(false);
    }
  }  

  function logoutGroup() {
    localStorage.removeItem("group_id");
    localStorage.removeItem("join_code");
    setGroupId("");
    setJoinCode("");
    setGroupOk(false);
    setMembers([]);
    setEntries([]);
    setHolidays([]);
    setErr("");
    setAuthErr("");
  }

  async function loadAll() {
    if (!groupOk) return;
    setLoading(true);
    setErr("");
    try {
      const [m, e, h] = await Promise.all([
        getMembers(),
        getEntries(month),
        getHolidays(month),
      ]);
      const active = m.filter((x) => x.active);
      setMembers(active);
      setEntries(e);
      setHolidays(h);
      if (!driverId && active.length) setDriverId(active[0].member_id);
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!showSplash) return;
    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, [showSplash]);
  

  useEffect(() => {
    // on mount, verify group from localStorage
    verifyGroupOrShowJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, groupOk]);

  const entryByDate = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(e.date, e);
    return map;
  }, [entries]);

  const balances = useMemo(() => computeMonthBalances(members, entries), [members, entries]);
  const transfers = useMemo(() => suggestTransfers(balances), [balances]);

  const weeks = useMemo(
    () => weekdayGrid(monthDate.getFullYear(), monthDate.getMonth()),
    [monthDate]
  );

  function prevMonth() {
    const d = new Date(monthDate);
    d.setMonth(d.getMonth() - 1);
    setMonthDate(d);
  }

  function nextMonth() {
    const d = new Date(monthDate);
    d.setMonth(d.getMonth() + 1);
    setMonthDate(d);
  }

  function openDay(d) {
    const dateStr = fmtDate(d);
    const existing = entryByDate.get(dateStr);

    setActiveDay(d);
    setNotes(existing?.notes || "");

    const defaultDriver = existing?.driver_id || members[0]?.member_id || "";
    setDriverId(defaultDriver);
    setDayType(existing?.day_type || "two_way");

    const next = {};
    for (const m of members) next[m.member_id] = "none";

    if (existing?.riders?.length) {
      for (const r of existing.riders) next[r.member_id] = r.trip_type;
    } else if (defaultDriver) {
      next[defaultDriver] = "two_way";
    }

    setRiderTrip(next);

    const dObj = memberById.get(defaultDriver);
    setDriverRatesForm({
      one_way_total: String(dObj?.one_way_total ?? ""),
      two_way_total: String(dObj?.two_way_total ?? ""),
    });

    setOpen(true);
  }

  function setTrip(member_id, trip_type) {
    setRiderTrip((p) => ({ ...p, [member_id]: trip_type }));
  }

  const driverObj = memberById.get(driverId);
  const driverOne = Number(driverObj?.one_way_total || 0);
  const driverTwo = Number(driverObj?.two_way_total || 0);

  const computedPreview = useMemo(() => {
    const dayTotal = dayType === "one_way" ? driverOne : driverTwo;

    const riders = [];
    for (const m of members) {
      const t = riderTrip[m.member_id] || "none";
      if (t === "none") continue;
      const units = t === "one_way" ? 1 : 2;
      riders.push({
        member_id: m.member_id,
        name: m.name,
        trip_type: t,
        units,
        charge: 0,
      });
    }

    const totalUnits = riders.reduce((s, r) => s + r.units, 0);
    if (!dayTotal || totalUnits === 0) return { riders: [], total: 0 };

    const computed = riders.map((r) => ({
      ...r,
      charge: round2(dayTotal * (r.units / totalUnits)),
    }));

    const sum = computed.reduce((s, r) => s + r.charge, 0);
    const drift = round2(dayTotal - sum);
    if (Math.abs(drift) >= 0.01) {
      const i = computed.findIndex((x) => x.member_id === driverId);
      if (i >= 0) computed[i].charge = round2(computed[i].charge + drift);
    }

    return {
      riders: computed,
      total: round2(computed.reduce((s, r) => s + r.charge, 0)),
    };
  }, [dayType, driverOne, driverTwo, members, riderTrip, driverId]);

  async function onSave() {
    setErr("");
    if (!activeDay) return;

    const date = fmtDate(activeDay);
    if (!driverId) return setErr("Pick a driver.");

    const riders = computedPreview.riders.map((r) => ({
      member_id: r.member_id,
      trip_type: r.trip_type,
    }));

    if (riders.length === 0) return setErr("Select at least 1 rider.");
    if (!riders.some((r) => r.member_id === driverId))
      return setErr("Driver must be included as a rider.");

    try {
      const entry = await saveEntry({
        date,
        driver_id: driverId,
        day_type: dayType,
        riders,
        notes,
      });
      setEntries((prev) => {
        const rest = prev.filter((e) => e.date !== date);
        return [...rest, entry].sort((a, b) => a.date.localeCompare(b.date));
      });
      setOpen(false);
    } catch (e) {
      setErr(e.message || "Failed to save entry");
    }
  }

  async function onAddMember() {
    const name = newMemberName.trim();
    if (!name) return;

    setAddingMember(true);
    setErr("");
    try {
      await createMember(name);
      setNewMemberName("");
      await loadAll();
    } catch (e) {
      setErr(e.message || "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  }

  const todayStr = fmtDate(new Date());

  // ---- Join screen gate ----
  if (!groupOk) {
    return (
      <div className="joinPage">
        <div className="joinCard">
          <div className="appHeader">
            <div className="appBrand">
              <div className="appIcon">🚘</div>
              <div className="appTitle">RideShare</div>
            </div>
          </div>

          <div className="joinTitle">Join your group</div>
          <div className="joinSub">
            Enter the group id + join code shared by your friends.
          </div>

          {authErr && <div className="joinError">{authErr}</div>}

          <form onSubmit={handleJoin} className="joinForm">
            <input
              className="joinInput"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="Group ID (ex: g1)"
              autoComplete="off"
            />
            <input
              className="joinInput"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Join code"
              autoComplete="off"
            />
            <button className="joinBtn" type="submit">
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {showSplash && (
        <div className="splashOverlay">
          <div className="splashCard">
            <div className="splashHeader">
              <div className="splashIcon">🚘</div>
              <div className="splashTitle">RideShare</div>
            </div>
            <div className="road">
              <div className="car">🚗</div>
            </div>
            <div className="splashSub">Getting things ready…</div>
          </div>
        </div>
      )}

      <div className="appHeader">
        <div className="appBrand">
          <div className="appIcon">🚘</div>
          <div className="appTitle">RideShare</div>
        </div>
      </div>

      <div className="topbar" style={styles.topbar}>
        <div className="topbarRow" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={styles.btn} onClick={prevMonth}>Prev</button>
          <div style={styles.monthTitle}>{month}</div>
          <button style={styles.btn} onClick={nextMonth}>Next</button>
        </div>

        <div className="topbarButtons" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="ratesPill" style={styles.rates}>Office view: Mon–Fri only</div>
          <button style={styles.btn} onClick={loadAll} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button style={styles.btn} onClick={logoutGroup} title="Switch group">
            Logout
          </button>
        </div>
      </div>

      {err && <div style={styles.error}>{err}</div>}

      {/* Add Member */}
      <div style={{ ...styles.card, marginTop: 12 }}>
        <div style={styles.cardTitle}>Members</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input
            value={newMemberName}
            onChange={(e) => setNewMemberName(e.target.value)}
            placeholder="Add member name (ex: Arun)"
            style={{ ...styles.input, marginBottom: 0 }}
          />
          <button
            style={styles.primary}
            onClick={onAddMember}
            disabled={addingMember || !newMemberName.trim()}
          >
            {addingMember ? "Adding…" : "Add"}
          </button>
        </div>
        <div style={styles.help}>
          Everyone in this group will see members added here.
        </div>
      </div>

      <div style={styles.calendar}>
        <div style={styles.weekHeader}>
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
            <div key={label} style={styles.weekHeaderCell}>{label}</div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} style={styles.weekRow}>
            {week.map((d, idx) => {
              if (!d) {
                return (
                  <div
                    key={`empty-${wi}-${idx}`}
                    className="calendarCell"
                    style={{ ...styles.dayCell, background: "#ffffff" }}
                  />
                );
              }

              const dateStr = fmtDate(d);
              const e = entryByDate.get(dateStr);

              const holidayName = holidayByDate.get(dateStr);
              const isHoliday = !!holidayName;
              const isToday = dateStr === todayStr;

              return (
                <div
                  key={dateStr}
                  className="calendarCell"
                  style={{
                    ...styles.dayCell,
                    ...(e ? styles.dayCellHasEntry : {}),
                    ...(isHoliday ? styles.dayCellHoliday : {}),
                    ...(isToday ? styles.dayCellToday : {}),
                  }}
                  onClick={() => openDay(d)}
                >
                  <div className="dayTop" style={styles.dayTop}>
                    <div className="dayNum" style={styles.dayNum}>{d.getDate()}</div>
                  </div>

                  {e ? (
                    <>
                      <div className="cellDetails">
                        <div className="pcDriver">
                          <span className="icon">🚗</span>
                          {nameById[e.driver_id] || e.driver_id}
                        </div>
                        <div className="pcRiders">
                          <span className="icon">👥</span>
                          {e.riders?.length || 0}
                        </div>
                      </div>

                      <div className="mobileSummary">
                        <div className="mobileDriver">
                          <span className="icon">🚗</span>
                          {nameById[e.driver_id] || e.driver_id}
                        </div>
                        <div className="mobileRiders">
                          <span className="icon">👥</span>
                          {e.riders?.length || 0}
                        </div>
                      </div>
                    </>
                  ) : null}

                  {isHoliday && (
                    <div className="holidayTag" style={styles.holidayTag}>
                      {holidayName}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="bottomGrid" style={styles.bottomGrid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Balances ({month})</div>
          {members.map((m) => {
            const b = balances[m.member_id] || 0;
            return (
              <div key={m.member_id} style={styles.rowBetween}>
                <div>{m.name}</div>
                <div style={b >= 0 ? styles.pillPos : styles.pillNeg}>
                  {b > 0 ? `+${b.toFixed(2)}` : b.toFixed(2)}
                </div>
              </div>
            );
          })}
          <div style={styles.help}>
            Positive = should receive. Negative = should pay.
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Suggested transfers</div>
          {transfers.length === 0 ? (
            <div style={styles.muted}>Nothing to settle.</div>
          ) : (
            transfers.map((t, i) => (
              <div key={i} style={styles.rowBetween}>
                <div>
                  {nameById[t.from]} → {nameById[t.to]}
                </div>
                <div style={{ fontWeight: 900 }}>${t.amount.toFixed(2)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {open && (
        <div
          className="modalBackdrop"
          style={styles.modalBackdrop}
          onClick={() => setOpen(false)}
        >
          <div
            className="modal"
            style={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalTitle}>
              {activeDay ? fmtDate(activeDay) : ""}
            </div>

            {/* Driver */}
            <div className="formRowTight" style={styles.formRow}>
              <label className="labelTight" style={styles.label}>Driver</label>
              <select
                className="inputTight"
                style={styles.input}
                value={driverId}
                onChange={(e) => {
                  const v = e.target.value;
                  setDriverId(v);

                  const dObj = memberById.get(v);
                  setDriverRatesForm({
                    one_way_total: String(dObj?.one_way_total ?? ""),
                    two_way_total: String(dObj?.two_way_total ?? ""),
                  });

                  setRiderTrip((p) => ({
                    ...p,
                    [v]: p[v] && p[v] !== "none" ? p[v] : "two_way",
                  }));
                }}
              >
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name}
                  </option>
                ))}
              </select>

              {/* Driver rates */}
              <div style={{ marginTop: 10 }}>
                <label className="labelTight" style={styles.label}>
                  Driver rates (used for split)
                </label>
                <div className="rateRow">
                  <input
                    className="rateInput"
                    style={styles.input}
                    type="number"
                    step="0.01"
                    placeholder="one_way_total"
                    value={driverRatesForm.one_way_total}
                    onChange={(e) =>
                      setDriverRatesForm((p) => ({
                        ...p,
                        one_way_total: e.target.value,
                      }))
                    }
                  />
                  <input
                    className="rateInput"
                    style={styles.input}
                    type="number"
                    step="0.01"
                    placeholder="two_way_total"
                    value={driverRatesForm.two_way_total}
                    onChange={(e) =>
                      setDriverRatesForm((p) => ({
                        ...p,
                        two_way_total: e.target.value,
                      }))
                    }
                  />
                </div>

                <div style={{ marginTop: 10 }}>
                  <button
                    style={styles.btn}
                    onClick={async () => {
                      await updateMemberRates({
                        member_id: driverId,
                        one_way_total: Number(driverRatesForm.one_way_total),
                        two_way_total: Number(driverRatesForm.two_way_total),
                      });
                      await loadAll();
                    }}
                  >
                    Save driver rates
                  </button>
                </div>

                <div style={styles.help}>
                  Current: 1-way ${driverOne || 0} | 2-way ${driverTwo || 0}
                </div>
              </div>
            </div>

            {/* Day type */}
            <div className="formRowTight" style={styles.formRow}>
              <label className="labelTight" style={styles.label}>Day type</label>
              <select
                className="inputTight"
                style={styles.input}
                value={dayType}
                onChange={(e) => setDayType(e.target.value)}
              >
                <option value="one_way">Use driver's one_way_total</option>
                <option value="two_way">Use driver's two_way_total</option>
              </select>
            </div>

            {/* Riders */}
            <div className="formRowTight" style={styles.formRow}>
              <label className="labelTight" style={styles.label}>Who rode today?</label>
              <div className="ridersBoxTight" style={styles.ridersBox}>
                {members.map((m) => {
                  const t = riderTrip[m.member_id] || "none";
                  return (
                    <div key={m.member_id} style={styles.riderRow}>
                      <div style={{ fontWeight: 800 }}>{m.name}</div>
                      <select
                        className="inputTight"
                        style={styles.riderSelect}
                        value={t}
                        onChange={(e) => setTrip(m.member_id, e.target.value)}
                      >
                        <option value="none">Not riding</option>
                        <option value="one_way">One-way</option>
                        <option value="two_way">Two-way</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div className="formRowTight" style={styles.formRow}>
              <label className="labelTight" style={styles.label}>Preview</label>
              <div className="previewBoxTight" style={styles.previewBox}>
                {computedPreview.riders.length === 0 ? (
                  <div style={styles.muted}>
                    No riders selected (or driver rate is 0).
                  </div>
                ) : (
                  computedPreview.riders.map((r) => (
                    <div key={r.member_id} style={styles.rowBetween}>
                      <div>
                        {r.name} ({r.trip_type === "one_way" ? "1-way" : "2-way"})
                      </div>
                      <div style={{ fontWeight: 900 }}>${r.charge.toFixed(2)}</div>
                    </div>
                  ))
                )}
                <div style={{ ...styles.rowBetween, paddingTop: 10 }}>
                  <div style={{ fontWeight: 950 }}>Total</div>
                  <div style={{ fontWeight: 950 }}>${computedPreview.total.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="formRowTight" style={styles.formRow}>
              <label className="labelTight" style={styles.label}>Notes</label>
              <input
                className="notesInput"
                style={styles.input}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button style={styles.primary} onClick={onSave}>Save day</button>
              <button style={styles.btn} onClick={() => setOpen(false)}>Cancel</button>
            </div>

            <div style={styles.help}>
              Split uses units: one-way=1, two-way=2. Rounding drift goes to driver.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 1100,
    margin: "24px auto",
    padding: 16,
    fontFamily: "system-ui, sans-serif",
    background: "linear-gradient(180deg, #f7f9ff 0%, #ffffff 60%)",
    borderRadius: 16,
  },

  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    background: "#ffffff",
    border: "1px solid #eef0f6",
    boxShadow: "0 6px 18px rgba(20, 20, 40, 0.05)",
  },

  monthTitle: {
    fontSize: 18,
    fontWeight: 900,
    padding: "0 6px",
    color: "#101828",
  },

  rates: {
    fontSize: 12,
    color: "#344054",
    padding: "6px 10px",
    border: "1px solid #e6eaf2",
    borderRadius: 999,
    background: "#f8fafc",
  },

  btn: {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #d0d5dd",
    background: "#ffffff",
    cursor: "pointer",
    color: "#101828",
    fontWeight: 650,
  },

  primary: {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #155eef",
    background: "#155eef",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 750,
    whiteSpace: "nowrap",
  },

  error: {
    marginTop: 14,
    padding: 10,
    borderRadius: 12,
    background: "#fff1f1",
    border: "1px solid #ffd2d2",
    color: "#8a0000",
  },

  muted: { color: "#667085", fontSize: 13 },

  calendar: {
    marginTop: 16,
    border: "1px solid #eef0f6",
    borderRadius: 16,
    overflow: "hidden",
    background: "#ffffff",
    boxShadow: "0 10px 24px rgba(20, 20, 40, 0.06)",
    paddingBottom: 6,
  },

  weekHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    background: "#f8fafc",
    borderBottom: "1px solid #eef0f6",
  },

  weekHeaderCell: {
    padding: 6,
    fontSize: 12,
    color: "#344054",
    fontWeight: 800,
    textAlign: "center",
  },

  weekRow: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 4,
    padding: 4,
  },

  dayCell: {
    minHeight: 110,
    padding: 10,
    cursor: "pointer",
    background: "#ffffff",
    position: "relative",
    border: "1px solid #eef0f6",
  },

  dayCellHasEntry: {
    background: "linear-gradient(180deg, #eef6ff 0%, #ffffff 70%)",
  },

  dayCellHoliday: {
    background: "linear-gradient(180deg, #f0f9ff 0%, #ffffff 70%)",
    outline: "2px dashed #0ea5e9",
    outlineOffset: "-2px",
  },

  dayCellToday: {
    outline: "2px solid #155eef",
    outlineOffset: "-2px",
    background: "linear-gradient(180deg, #e8efff 0%, #ffffff 70%)",
  },

  holidayTag: {
    position: "absolute",
    left: 10,
    bottom: 10,
    fontSize: 11,
    color: "#0b74b5",
    fontWeight: 850,
    background: "#e0f2fe",
    border: "1px solid #bae6fd",
    padding: "2px 8px",
    borderRadius: 999,
    maxWidth: "calc(100% - 20px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  dayTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  dayNum: { fontWeight: 900, color: "#101828" },

  bottomGrid: {
    marginTop: 16,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },

  card: {
    padding: 14,
    border: "1px solid #eef0f6",
    borderRadius: 16,
    background: "#ffffff",
    boxShadow: "0 10px 24px rgba(20, 20, 40, 0.06)",
  },

  cardTitle: { fontWeight: 900, marginBottom: 10, color: "#101828" },

  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid #f2f4f7",
  },

  help: { marginTop: 10, fontSize: 12, color: "#667085" },

  pillPos: {
    padding: "2px 8px",
    borderRadius: 999,
    background: "#ecfdf3",
    color: "#027a48",
    fontWeight: 900,
    fontSize: 12,
  },

  pillNeg: {
    padding: "2px 8px",
    borderRadius: 999,
    background: "#fef3f2",
    color: "#b42318",
    fontWeight: 900,
    fontSize: 12,
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(16,24,40,0.45)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },

  modal: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 16,
    border: "1px solid #eef0f6",
    boxShadow: "0 20px 50px rgba(16,24,40,0.25)",
  },

  modalTitle: {
    fontWeight: 950,
    fontSize: 16,
    marginBottom: 10,
    color: "#101828",
  },
  formRow: { marginTop: 10 },

  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 6,
    color: "#344054",
  },

  input: {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: "1px solid #d0d5dd",
    outline: "none",
    background: "#ffffff",
  },

  ridersBox: {
    border: "1px solid #eef0f6",
    borderRadius: 12,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "#fbfcfe",
  },

  riderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  riderSelect: {
    padding: 8,
    borderRadius: 12,
    border: "1px solid #d0d5dd",
    background: "#ffffff",
  },
  previewBox: {
    border: "1px solid #eef0f6",
    borderRadius: 12,
    padding: 10,
    background: "#ffffff",
  },
};
