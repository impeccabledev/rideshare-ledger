import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  groupCheck,
  getMembers,
  getEntries,
  getHolidays,
  saveEntry,
  updateMemberRates,
  createMember,
} from "./api";

// ---------- date helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");
const fmtMonthApi = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const fmtMonthDisplay = (d) => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]}'${String(d.getFullYear()).slice(-2)}`;
};
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const round2 = (x) => Math.round(Number(x) * 100) / 100;

/**
 * Mon–Fri only grid for a month.
 * Returns array of weeks; each week is [Mon..Fri] and can contain null cells.
 */
function weekdayGrid(year, monthIdx0) {
  const first = new Date(year, monthIdx0, 1);
  const last = new Date(year, monthIdx0 + 1, 0);

  // Start at first non-weekend day in month
  let cur = new Date(first);
  while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() + 1);

  const weeks = [];
  while (cur <= last) {
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
  // ------- Auth state (JOIN screen) -------
  const [groupOk, setGroupOk] = useState(false);
  const [groupId, setGroupId] = useState(() => localStorage.getItem("group_id") || "");
  const [joinCode, setJoinCode] = useState(() => localStorage.getItem("join_code") || "");
  const [authErr, setAuthErr] = useState("");

  // ------- App data state -------
  const [showSplash, setShowSplash] = useState(true);

  const [monthDate, setMonthDate] = useState(() => new Date());
  const [transitionDirection, setTransitionDirection] = useState("none");
  const month = useMemo(() => fmtMonthApi(monthDate), [monthDate]);
  const monthDisplay = useMemo(() => fmtMonthDisplay(monthDate), [monthDate]);

  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [holidays, setHolidays] = useState([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // ------- Day modal state -------
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

  // ------- Add member modal state -------
  const [memberOpen, setMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberCountryCode, setNewMemberCountryCode] = useState("+1");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [memberErr, setMemberErr] = useState("");

  // Country codes with flags
  const countryCodes = [
    { code: "+1", country: "US", flag: "🇺🇸" },
    { code: "+44", country: "GB", flag: "🇬🇧" },
    { code: "+91", country: "IN", flag: "🇮🇳" },
    { code: "+86", country: "CN", flag: "🇨🇳" },
    { code: "+81", country: "JP", flag: "🇯🇵" },
    { code: "+49", country: "DE", flag: "🇩🇪" },
    { code: "+33", country: "FR", flag: "🇫🇷" },
    { code: "+55", country: "BR", flag: "🇧🇷" },
    { code: "+61", country: "AU", flag: "🇦🇺" },
    { code: "+82", country: "KR", flag: "🇰🇷" },
    { code: "+55", country: "BR", flag: "🇧🇷" },
    { code: "+31", country: "NL", flag: "🇳🇱" },
    { code: "+34", country: "ES", flag: "🇪🇸" },
    { code: "+39", country: "IT", flag: "🇮🇹" },
    { code: "+7", country: "RU", flag: "🇷🇺" },
    { code: "+55", country: "BR", flag: "🇧🇷" },
    { code: "+27", country: "ZA", flag: "🇿🇦" },
    { code: "+82", country: "KR", flag: "🇰🇷" },
    { code: "+90", country: "TR", flag: "🇹🇷" },
    { code: "+52", country: "MX", flag: "🇲🇽" },
    { code: "+351", country: "PT", flag: "🇵🇹" },
    { code: "+55", country: "BR", flag: "🇧🇷" },
  ];

  // ---- Boot: splash + auto-check stored creds ----
  useEffect(() => {
    // splash hides by default after 2s; but we re-trigger on join too
    const t = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    async function bootAuth() {
      const gid = (localStorage.getItem("group_id") || "").trim();
      const jcode = (localStorage.getItem("join_code") || "").trim();

      if (!gid || !jcode) {
        setGroupOk(false);
        return;
      }

      try {
        await groupCheck();
        setGroupOk(true);
      } catch (e) {
        localStorage.removeItem("group_id");
        localStorage.removeItem("join_code");
        setGroupId("");
        setJoinCode("");
        setGroupOk(false);
        setAuthErr(e.message || "Invalid group");
      }
    }
    bootAuth();
  }, []);

  async function loadAll() {
    setLoading(true);
    setErr("");
    try {
      const [m, e, h] = await Promise.all([getMembers(), getEntries(month), getHolidays(month)]);
      const active = (m || []).filter((x) => x.active);
      setMembers(active);
      setEntries(e || []);
      setHolidays(h || []);
      if (!driverId && active.length) setDriverId(active[0].member_id);
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // load data only when groupOk is true
  useEffect(() => {
    if (!groupOk) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupOk, month]);

  function logout() {
    localStorage.removeItem("group_id");
    localStorage.removeItem("join_code");
    setGroupId("");
    setJoinCode("");
    setAuthErr("");
    setErr("");
    setGroupOk(false);
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

    localStorage.setItem("group_id", gid);
    localStorage.setItem("join_code", jcode);

    // show splash after join too
    setShowSplash(true);

    try {
      await groupCheck();
      setGroupOk(true);
      await loadAll();
      setTimeout(() => setShowSplash(false), 1200);
    } catch (e2) {
      setGroupOk(false);
      setAuthErr(e2.message || "Invalid group");
      setShowSplash(false);
    }
  }

  // ---------- Derived maps ----------
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

  const entryByDate = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(e.date, e);
    return map;
  }, [entries]);

  // ---------- Month grid ----------
  const weeks = useMemo(
    () => weekdayGrid(monthDate.getFullYear(), monthDate.getMonth()),
    [monthDate]
  );

  function prevMonth() {
    setTransitionDirection("prev");
    const d = new Date(monthDate);
    d.setMonth(d.getMonth() - 1);
    setMonthDate(d);
    setTimeout(() => setTransitionDirection("none"), 300);
  }

  function nextMonth() {
    setTransitionDirection("next");
    const d = new Date(monthDate);
    d.setMonth(d.getMonth() + 1);
    setMonthDate(d);
    setTimeout(() => setTransitionDirection("none"), 300);
  }

  // ---------- Open day modal ----------
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

  // ---------- Split preview ----------
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
    if (!riders.some((r) => r.member_id === driverId)) return setErr("Driver must be included as a rider.");

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

  async function onUpdateRates() {
    setErr("");
    if (!driverId) return;
    try {
      await updateMemberRates({
        member_id: driverId,
        one_way_total: Number(driverRatesForm.one_way_total),
        two_way_total: Number(driverRatesForm.two_way_total),
      });
      await loadAll();
    } catch (e) {
      setErr(e.message || "Failed to update rates");
    }
  }

  async function onCreateMember() {
    setMemberErr("");
    const name = newMemberName.trim();
    const phone = newMemberPhone.trim();
    if (!name) return setMemberErr("Name is required.");
    if (!phone) return setMemberErr("Phone is required.");

    // Combine country code with phone number
    const fullPhone = `${newMemberCountryCode}${phone}`;

    try {
      await createMember({ name, phone: fullPhone, active: true });
      setNewMemberName("");
      setNewMemberPhone("");
      setMemberOpen(false);
      await loadAll();
    } catch (e) {
      setMemberErr(e.message || "Failed to create member");
    }
  }


  // ---------- Balances ----------
  const balances = useMemo(() => computeMonthBalances(members, entries), [members, entries]);
  const transfers = useMemo(() => suggestTransfers(balances), [balances]);

  const todayStr = fmtDate(new Date());

  // =========================
  // JOIN SCREEN
  // =========================
  if (!groupOk) {
    return (
      <div style={styles.joinWrap}>
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
              <div className="splashSub">Loading…</div>
            </div>
          </div>
        )}

        

        <form onSubmit={handleJoin} style={styles.joinCard}>
          <div className="appHeader" style={{ marginBottom: 5 }}>
            <div className="appBrand">
              <div className="appIcon">🚘</div>
              <div className="appTitle">RideShare</div>
            </div>
          </div>
          <div style={styles.joinTitle}>Welcome back</div>
          <div style={styles.joinSubtitle}>Enter your group credentials to continue</div>

          {authErr && <div style={styles.error}>{authErr}</div>}

          <div style={styles.inputGroup}>
            <input
              style={styles.input}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="Group ID"
              autoComplete="off"
            />
          </div>

          <div style={styles.inputGroup}>
            <input
              style={styles.input}
              type="password"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Join Code"
              autoComplete="off"
              maxLength={8}
            />
          </div>

          <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary, width: "100%", marginTop: 8 }}>
            Continue
          </button>
        </form>
      </div>
    );
  }

  // =========================
  // MAIN APP UI
  // =========================
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
            <div className="splashSub">Buckle Up…</div>
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
          <button 
            style={{ 
              ...styles.btn, 
              minWidth: "50px", 
              padding: "10px 16px",
              background: "linear-gradient(135deg, #a5b4fc 0%, #818cf8 100%)", 
              color: "white", 
              borderColor: "#818cf8",
              borderRadius: "20px 8px 8px 20px",
              clipPath: "polygon(0% 50%, 15% 0%, 100% 0%, 100% 100%, 15% 100%)"
            }} 
            onClick={prevMonth}
          >
            Prev
          </button>
          <div style={styles.monthTitle}>{monthDisplay}</div>
          <button 
            style={{ 
              ...styles.btn, 
              minWidth: "50px", 
              padding: "10px 16px",
              background: "linear-gradient(135deg, #a5b4fc 0%, #818cf8 100%)", 
              color: "white", 
              borderColor: "#818cf8",
              borderRadius: "8px 20px 20px 8px",
              clipPath: "polygon(0% 0%, 85% 0%, 100% 50%, 85% 100%, 0% 100%)"
            }} 
            onClick={nextMonth}
          >
            Next
          </button>
        </div>

        <div className="topbarButtons" style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <button style={{ ...styles.btn, minWidth: "90px", background: "linear-gradient(135deg, #86efac 0%, #4ade80 100%)", color: "white", borderColor: "#4ade80" }} onClick={() => { setMemberErr(""); setMemberOpen(true); }}>
            + Member
          </button>

          <button style={{ ...styles.btn, minWidth: "100px", background: "linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)", color: "white", borderColor: "#60a5fa" }} onClick={loadAll} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>

          <button style={{ ...styles.btn, minWidth: "80px", background: "linear-gradient(135deg, #fca5a5 0%, #f87171 100%)", color: "white", borderColor: "#f87171" }} onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      {err && <div style={styles.error}>{err}</div>}

      <div style={{
        ...styles.calendarContainer,
        animation: transitionDirection === "prev" ? "fadeInRight 0.3s ease-out" : transitionDirection === "next" ? "fadeInLeft 0.3s ease-out" : "none",
      }}>
        <div style={styles.weekHeader}>
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
            <div key={label} style={styles.weekHeaderCell}>
              {label}
            </div>
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
                    <div className="dayNum" style={styles.dayNum}>
                      {d.getDate()}
                    </div>
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

      <div style={styles.bottomGrid}>
        <div style={styles.cardBalances}>
          <div style={styles.cardTitle}>Balances</div>
          <div style={{ marginTop: 10 }}>
            {members.map((m) => (
              <div key={m.member_id} style={styles.rowLine}>
                <div style={{ fontWeight: 800 }}>{m.name}</div>
                <div style={{ 
                  fontWeight: 900, 
                  color: (balances[m.member_id] ?? 0) >= 0 ? '#22c55e' : '#ef4444' 
                }}>${balances[m.member_id] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.cardSettleUp}>
          <div style={styles.cardTitle}>Settle Up</div>
          <div style={{ marginTop: 10 }}>
            {transfers.length === 0 ? (
              <div style={styles.small}>No transfers needed.</div>
            ) : (
              transfers.map((t, i) => (
                <div key={i} style={styles.rowLine}>
                  <div style={{ fontWeight: 800 }}>
                    {nameById[t.from] || t.from} → {nameById[t.to] || t.to}
                  </div>
                  <div style={{ fontWeight: 900 }}>${t.amount}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Day modal */}
      {open && (
        <div className="modalBackdrop" style={styles.modalBackdrop} onClick={() => setOpen(false)}>
          <div className="modal" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>{activeDay ? fmtDate(activeDay) : ""}</div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Driver</div>
              <select
                className="inputTight"
                style={styles.select}
                value={driverId}
                onChange={(e) => {
                  const id = e.target.value;
                  setDriverId(id);
                  const dObj = memberById.get(id);
                  setDriverRatesForm({
                    one_way_total: String(dObj?.one_way_total ?? ""),
                    two_way_total: String(dObj?.two_way_total ?? ""),
                  });
                }}
              >
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Day type</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  style={{ ...styles.btn, ...(dayType === "one_way" ? styles.btnOn : {}) }}
                  onClick={() => setDayType("one_way")}
                >
                  One-way total
                </button>
                <button
                  type="button"
                  style={{ ...styles.btn, ...(dayType === "two_way" ? styles.btnOn : {}) }}
                  onClick={() => setDayType("two_way")}
                >
                  Two-way total
                </button>
              </div>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Driver rates (used for split)</div>

              <div className="rateRow">
                <input
                  className="rateInput"
                  style={styles.input}
                  placeholder="One-way total ($)"
                  value={driverRatesForm.one_way_total}
                  onChange={(e) => setDriverRatesForm((p) => ({ ...p, one_way_total: e.target.value }))}
                />
                <input
                  className="rateInput"
                  style={styles.input}
                  placeholder="Two-way total ($)"
                  value={driverRatesForm.two_way_total}
                  onChange={(e) => setDriverRatesForm((p) => ({ ...p, two_way_total: e.target.value }))}
                />
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" style={styles.btn} onClick={onUpdateRates}>
                  Save driver rates
                </button>
                <div style={styles.small}>Set once per driver.</div>
              </div>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Riders (trip type per person)</div>

              <div className="ridersBoxTight" style={styles.ridersBox}>
                {members.map((m) => {
                  const v = riderTrip[m.member_id] || "none";
                  return (
                    <div key={m.member_id} style={styles.riderRow}>
                      <div style={{ fontWeight: 900, minWidth: 90 }}>{m.name}</div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button type="button" style={{ ...styles.pill, ...(v === "none" ? styles.pillOn : {}) }} onClick={() => setTrip(m.member_id, "none")}>
                          None
                        </button>
                        <button type="button" style={{ ...styles.pill, ...(v === "one_way" ? styles.pillOn : {}) }} onClick={() => setTrip(m.member_id, "one_way")}>
                          One-way
                        </button>
                        <button type="button" style={{ ...styles.pill, ...(v === "two_way" ? styles.pillOn : {}) }} onClick={() => setTrip(m.member_id, "two_way")}>
                          Two-way
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Notes</div>
              <input className="notesInput" style={styles.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Preview split</div>
              <div className="previewBoxTight" style={styles.previewBox}>
                {computedPreview.riders.length === 0 ? (
                  <div style={styles.small}>Select riders to see charges.</div>
                ) : (
                  computedPreview.riders.map((r) => (
                    <div key={r.member_id} style={styles.rowLine}>
                      <div style={{ fontWeight: 800 }}>
                        {r.name} ({r.trip_type})
                      </div>
                      <div style={{ fontWeight: 900 }}>{r.charge}</div>
                    </div>
                  ))
                )}
                <div style={{ ...styles.rowLine, marginTop: 8 }}>
                  <div style={{ fontWeight: 900 }}>Total</div>
                  <div style={{ fontWeight: 950 }}>${computedPreview.total}</div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button type="button" style={styles.btn} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={onSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {memberOpen && (
        <div className="modalBackdrop" style={styles.modalBackdrop} onClick={() => setMemberOpen(false)}>
          <div className="modal" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Add member</div>

            {memberErr && <div style={styles.error}>{memberErr}</div>}

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Name</div>
              <input style={styles.input} value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="e.g., Arun" />
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Mobile number</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  style={{ ...styles.select, width: 80 }}
                  value={newMemberCountryCode}
                  onChange={(e) => setNewMemberCountryCode(e.target.value)}
                >
                  {countryCodes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.code}
                    </option>
                  ))}
                </select>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  value={newMemberPhone}
                  onChange={(e) => setNewMemberPhone(e.target.value)}
                  placeholder="Phone number"
                />
              </div>
              <div style={styles.small}>Select country code, then enter number.</div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button type="button" style={styles.btn} onClick={() => setMemberOpen(false)}>
                Cancel
              </button>
              <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={onCreateMember}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 1000,
    margin: "0 auto",
    padding: 16,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans"',
  },
  joinWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    padding: 16,
  },
  joinCard: {
    width: "min(420px, 92vw)",
    border: "1px solid #e4e7ec",
    background: "#fff",
    borderRadius: 16,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  joinTitle: { fontWeight: 600, fontSize: 16, color: "#101828", fontFamily:"tahoma, sans-serif", textAlign:"center", marginBottom:4 },
  joinSubtitle: { fontSize: 13, color: "#667085", textAlign: "center", marginBottom: 16, fontFamily:"tahoma, sans-serif" },
  joinHint: { fontSize: 12, color: "#667085", fontWeight: 700, marginTop: 6 },
  inputGroup: { marginBottom: 12 },
  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  monthTitle: { fontSize: 16, fontWeight: 950, color: "#101828" },
  btn: {
    border: "1px solid #e4e7ec",
    background: "#fff",
    padding: "10px 12px",
    borderRadius: 12,
    fontWeight: 850,
    cursor: "pointer",
    fontSize: 16,
  },
  btnOn: { borderColor: "#155eef", background: "#eff4ff" },
  btnPrimary: { background: "#155eef", color: "white", borderColor: "#155eef" },
  error: {
    background: "#fff1f3",
    border: "1px solid #fecdd3",
    color: "#881337",
    padding: 10,
    borderRadius: 12,
    marginBottom: 12,
    fontWeight: 800,
  },
  calendarContainer: {
    overflow: "hidden",
  },
  calendar: { display: "flex", flexDirection: "column", gap: 8 },
  weekHeader: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2 },
  weekHeaderCell: {
    textAlign: "center",
    fontWeight: 900,
    color: "#475467",
    fontSize: 12,
  },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2 },
  dayCell: {
    border: "1px solid #e4e7ec",
    borderRadius: 14,
    background: "#ffffff",
    padding: 8,
    minHeight: 92,
    maxHeight: 92,
    height: 92,
    cursor: "pointer",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  dayCellHasEntry: { borderColor: "#c7d7fe", background: "#f5f8ff" },
  dayCellHoliday: { borderColor: "#fed7aa", background: "#fff7ed" },
  dayCellToday: { borderColor: "#155eef", boxShadow: "0 0 0 2px rgba(21,94,239,0.12) inset" },
  dayTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  dayNum: { fontWeight: 950, color: "#101828", fontSize: 13 },
  holidayTag: {
    position: "absolute",
    left: 10,
    bottom: 10,
    fontSize: 11,
    fontWeight: 900,
    color: "#9a3412",
    background: "#ffedd5",
    border: "1px solid #fed7aa",
    padding: "3px 8px",
    borderRadius: 999,
    maxWidth: "calc(100% - 20px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  bottomGrid: { marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  card: { border: "1px solid #e4e7ec", borderRadius: 16, padding: 12 },
  cardBalances: { 
    border: "1px solid #e4e7ec", 
    borderRadius: 16, 
    padding: 12,
    background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #bae6fd 100%)",
  },
  cardSettleUp: { 
    border: "1px solid #e4e7ec", 
    borderRadius: 16, 
    padding: 12,
    background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #e9d5ff 100%)",
  },
  cardTitle: { fontWeight: 950, color: "#101828", marginBottom: 6, textAlign: "center" },
  small: { fontSize: 12, color: "#667085", fontWeight: 700 },
  rowLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px dashed #eef2f6",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(16,24,40,0.45)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  },
  modal: {
    width: "min(520px, 92vw)",
    maxHeight: "80vh",
    overflow: "auto",
    borderRadius: 18,
    background: "#fff",
    border: "1px solid #e4e7ec",
    padding: 14,
  },
  modalTitle: { fontWeight: 950, fontSize: 16, color: "#101828", marginBottom: 10 },
  formRow: { marginTop: 10 },
  label: { fontWeight: 900, color: "#344054", fontSize: 12, marginBottom: 6 },
  input: {
    width: "100%",
    border: "1px solid #e4e7ec",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 800,
    color: "#101828",
    outline: "none",
    fontSize: 16,
  },
  select: {
    width: "100%",
    border: "1px solid #e4e7ec",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 800,
    color: "#101828",
    outline: "none",
    background: "#fff",
  },
  ridersBox: { border: "1px solid #e4e7ec", borderRadius: 12, padding: 8 },
  riderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px",
    borderBottom: "1px dashed #eef2f6",
  },
  pill: { 
    border: "1px solid #e4e7ec",
    background: "#fff",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 850,
    cursor: "pointer",
  },
  pillOn: { borderColor: "#155eef", background: "#eff4ff" },
  previewBox: { border: "1px solid #e4e7ec", borderRadius: 12, padding: 10, background: "#fafbff" },
};