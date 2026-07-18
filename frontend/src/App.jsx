import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import {
  groupCheck,
  getMembers,
  getEntries,
  getHolidays,
  saveEntry,
  deleteEntry,
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
  const swipeStartRef = useRef(null);
  const swipeHandledRef = useRef(false);
  const month = useMemo(() => fmtMonthApi(monthDate), [monthDate]);
  const monthDisplay = useMemo(() => fmtMonthDisplay(monthDate), [monthDate]);

  const [allMembers, setAllMembers] = useState([]);
  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [holidays, setHolidays] = useState([]);
  
  // Force re-render counter
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // ------- Day modal state -------
  const [open, setOpen] = useState(false);
  const [activeDay, setActiveDay] = useState(null);
  const [driverId, setDriverId] = useState("");
  const [riderTrip, setRiderTrip] = useState({});
  const [notes, setNotes] = useState("");
  const [shouldClear, setShouldClear] = useState(false);  // Flag to track if entry should be cleared

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

  async function loadAll(skipDriverReset = false) {
    setLoading(true);
    setErr("");
    try {
      const [m, e, h] = await Promise.all([getMembers(), getEntries(month), getHolidays(month)]);
      setAllMembers(m || []);
      const active = (m || []).filter((x) => x.active);
      setMembers(active);
      setEntries(e || []);
      setHolidays(h || []);
      // Only auto-select first driver if driverId is truly empty (not __none__)
      if (!skipDriverReset && !driverId && !driverId.startsWith("__") && active.length) {
        setDriverId(active[0].member_id);
      }
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
    for (const x of allMembers) m[x.member_id] = x.name;
    return m;
  }, [allMembers]);

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

  function handleSwipeStart(e) {
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handleSwipeEnd(e) {
    if (!swipeStartRef.current) return;
    const dx = e.clientX - swipeStartRef.current.x;
    const dy = e.clientY - swipeStartRef.current.y;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) nextMonth();
      else prevMonth();
      swipeHandledRef.current = true;
    }

    swipeStartRef.current = null;
  }

  function handleCalendarClick(e) {
    if (swipeHandledRef.current) {
      swipeHandledRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ---------- Open day modal ----------
  function openDay(d) {
    const dateStr = fmtDate(d);
    const existing = entryByDate.get(dateStr);

    // Reset the clear flag when opening a new day
    setShouldClear(false);
    
    setActiveDay(d);
    setNotes(existing?.notes || "");

    // If we're in clear mode, keep the driver as "none", otherwise use existing or first member
    let defaultDriver;
    if (shouldClear) {
      // Preserve the "None" state after clearing
      defaultDriver = "__none__";
    } else {
      defaultDriver = existing?.driver_id || members[0]?.member_id || "";
    }
    
    setDriverId(defaultDriver);

    const next = {};
    for (const m of members) next[m.member_id] = "none";

    if (existing?.riders?.length) {
      for (const r of existing.riders) next[r.member_id] = r.trip_type;
    } else if (defaultDriver && defaultDriver !== "__none__") {
      next[defaultDriver] = "two_way";
    }

    setRiderTrip(next);

    const dObj = memberById.get(defaultDriver === "__none__" ? "" : defaultDriver);
    setDriverRatesForm({
      one_way_total: String(dObj?.one_way_total ?? ""),
      two_way_total: String(dObj?.two_way_total ?? ""),
    });

    setOpen(true);
  }

  function setTrip(member_id, trip_type) {
    setRiderTrip((p) => ({ ...p, [member_id]: trip_type }));
  }

  function clearForm() {
    // Reset all form fields to defaults (empty state)
    console.log("clearForm called, members:", members.map(m => m.name));
    
    setDriverId("__none__");  // Use special value to indicate no driver selected
    setDriverRatesForm({
      one_way_total: "",
      two_way_total: "",
    });

    // Reset all riders to none
    const next = {};
    for (const m of members) next[m.member_id] = "none";
    setRiderTrip(next);
    console.log("Rider trip reset:", next);

    setNotes("");
  }

  async function onClear() {
    setErr("");
    
    // Set flag to indicate entry should be cleared on save
    setShouldClear(true);
    
    // Clear the form fields (resets to defaults without closing modal)
    clearForm();
    
    // Force re-render to ensure UI updates
    forceUpdate();
    
    console.log("onClear: shouldClear set to true, driverId:", driverId);
  }

  // ---------- Split preview ----------
  const driverObj = memberById.get(driverId);
  const driverOne = Number(driverObj?.one_way_total || 0);
  const driverTwo = Number(driverObj?.two_way_total || 0);

  const computedPreview = useMemo(() => {
    // Auto-detect day type from rider selections
    let oneWayCount = 0, twoWayCount = 0;
    for (const t of Object.values(riderTrip)) {
      if (t === "one_way") oneWayCount++;
      else if (t === "two_way") twoWayCount++;
    }
    // If any riders selected two-way, use two-way total; otherwise use one-way
    const dayType = twoWayCount > 0 ? "two_way" : "one_way";
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
  }, [driverOne, driverTwo, members, riderTrip, driverId]);

  async function onSave() {
    setErr("");
    if (!activeDay) return;

    const date = fmtDate(activeDay);
    console.log("onSave called, shouldClear:", shouldClear, "driverId:", driverId);

    // Check if this is a clear operation
    if (shouldClear) {
      try {
        console.log("Deleting entry for date:", date);
        console.log("Current entries before delete:", entries.map(e => ({ date: e.date, driver: e.driver_id })));
        
        // Delete the existing entry from Google Sheets
        console.log("Delete: date parameter type:", typeof date, "value:", date);
        const result = await deleteEntry(date);
        console.log("Delete API result:", result);
        console.log("Delete API result.ok:", result?.ok, "deleted:", result?.deleted);
        
        // Update local state to remove the entry immediately (optimistic update)
        const filteredEntries = entries.filter((e) => e.date !== date);
        console.log("Filtered entries after delete:", filteredEntries.map(e => e.date));
        setEntries(filteredEntries);
        
        // Reset the clear flag
        setShouldClear(false);
        
        // Close the modal
        setOpen(false);
        
        console.log("Clear complete - entry removed from UI");
      } catch (e) {
        console.error("Clear error:", e);
        setErr(e.message || "Failed to clear entry");
      }
      return;
    }

    // Build riders array from form data - can be empty
    const riders = computedPreview.riders.map((r) => ({
      member_id: r.member_id,
      trip_type: r.trip_type,
    }));

    // Auto-detect day type from rider selections
    let oneWayCount = 0, twoWayCount = 0;
    for (const r of riders) {
      if (r.trip_type === "one_way") oneWayCount++;
      else if (r.trip_type === "two_way") twoWayCount++;
    }
    const dayType = twoWayCount > 0 ? "two_way" : "one_way";

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
      
      // Reload all data to refresh the memoized entryByDate map
      await loadAll();
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
  const balances = useMemo(() => computeMonthBalances(allMembers, entries), [allMembers, entries]);
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
              <div className="splashSub">Preparing your trip</div>
              <div className="splashProgress" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        

        <form onSubmit={handleJoin} style={styles.joinCard}>
          <div style={styles.authBrand}>
            <div className="appIcon" style={styles.authIcon}>🚘</div>
            <div style={styles.authBrandTitle}>RideShare</div>
          </div>

          <div style={styles.authHeaderWrap}>
            <div style={styles.joinTitle}>Welcome!</div>
            <div style={styles.joinSubtitle}>Enter your group credentials to login</div>
          </div>

          {authErr && <div style={styles.error}>{authErr}</div>}

          <div style={styles.inputGroup}>
            <input
              style={styles.input}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              autoComplete="off"
              placeholder="GROUP ID"
            />
          </div>

          <div style={styles.inputGroup}>
            <input
              style={styles.input}
              type="password"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              autoComplete="off"
              maxLength={8}
              placeholder="JOIN CODE"
            />
          </div>

          <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary, width: "100%", marginTop: 8, padding: "12px 14px" }}>
            Login
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
            <div className="splashSub">Buckle up</div>
            <div className="splashProgress" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
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
              borderRadius: "12px",
              clipPath: "polygon(0% 50%, 20% 0%, 100% 0%, 100% 100%, 20% 100%, 0% 50%)"
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
              borderRadius: "12px",
              clipPath: "polygon(0% 0%, 80% 0%, 100% 50%, 80% 100%, 0% 100%)"
            }} 
            onClick={nextMonth}
          >
            Next
          </button>
        </div>

        <div className="topbarButtons" style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <button style={{ ...styles.btn, minWidth: "92px", background: "linear-gradient(135deg, #86efac 0%, #4ade80 100%)", color: "white", borderColor: "#4ade80", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => { setMemberErr(""); setMemberOpen(true); }}>
            <span aria-hidden="true">＋</span>
            <span>Member</span>
          </button>

          <button style={{ ...styles.btn, minWidth: "92px", background: "linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)", color: "white", borderColor: "#60a5fa", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={loadAll} disabled={loading}>
            <span aria-hidden="true">↻</span>
            <span>{loading ? "Refreshing" : "Refresh"}</span>
          </button>

          <button style={{ ...styles.btn, minWidth: "92px", background: "linear-gradient(135deg, #fca5a5 0%, #f87171 100%)", color: "white", borderColor: "#f87171", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={logout}>
            <span aria-hidden="true">⎋</span>
            <span>Logout</span>
          </button>
        </div>
      </div>

      {err && <div style={styles.error}>{err}</div>}

      <div
        style={{
          ...styles.calendarContainer,
          animation: transitionDirection === "prev" ? "fadeInRight 0.3s ease-out" : transitionDirection === "next" ? "fadeInLeft 0.3s ease-out" : "none",
          touchAction: "pan-y",
        }}
        onPointerDown={handleSwipeStart}
        onPointerUp={handleSwipeEnd}
        onClickCapture={handleCalendarClick}
      >
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
                    style={{ ...styles.dayCell, background: "linear-gradient(135deg, rgba(8, 12, 10, 0.96), rgba(10, 16, 12, 0.98))", border: "1px solid rgba(47, 191, 113, 0.16)" }}
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
            {allMembers
              .slice()
              .sort((a, b) => Number(b.active) - Number(a.active))
              .filter((m) => m.active || Math.abs(balances[m.member_id] ?? 0) > 0.005)
              .map((m) => (
                <div key={m.member_id} style={styles.rowLine}>
                  <div style={{ fontWeight: 800, color: "#f8fafc", opacity: m.active ? 1 : 0.75 }}>
                    {m.name}{m.active ? '' : ' (Inactive)'}
                  </div>
                  <div
                    style={{
                      fontWeight: 900,
                      color: (balances[m.member_id] ?? 0) >= 0 ? '#22c55e' : '#ef4444',
                    }}
                  >
                    ${balances[m.member_id] ?? 0}
                  </div>
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
                  <div style={{ fontWeight: 800, color: "#f8fafc" }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={styles.modalTitle}>{activeDay ? fmtDate(activeDay) : ""}</div>
              <button
                type="button"
                style={{
                  ...styles.btn,
                  background: "linear-gradient(135deg, #fca5a5 0%, #f87171 100%)",
                  color: "white",
                  borderColor: "#f87171",
                  minWidth: "70px",
                }}
                onClick={onClear}
              >
                Clear
              </button>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Driver</div>
              <select
                className="inputTight"
                style={styles.select}
                value={driverId === "__none__" ? "" : driverId}
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
                <option value="">None</option>
                {members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Driver Rates (Used for split)</div>

              <div className="rateRow">
                <div className="rateInputWrapper">
                  <input
                    className="rateInput"
                    placeholder=" "
                    value={driverRatesForm.two_way_total}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDriverRatesForm((p) => ({
                        ...p,
                        two_way_total: val,
                        // Auto-calculate one-way as half of two-way
                        one_way_total: val ? String((Number(val) / 2).toFixed(2)) : "",
                      }));
                    }}
                  />
                  <span className="rateLabel">Two-way total ($)</span>
                </div>
                <div className="rateInputWrapper">
                  <input
                    className="rateInput"
                    placeholder=" "
                    value={driverRatesForm.one_way_total}
                    onChange={(e) => setDriverRatesForm((p) => ({ ...p, one_way_total: e.target.value }))}
                  />
                  <span className="rateLabel">One-way total ($)</span>
                </div>
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" style={{ ...styles.btn, background: "linear-gradient(135deg, #a5b4fc 0%, #818cf8 100%)", color: "white", borderColor: "#818cf8" }} onClick={onUpdateRates}>
                  Save Rates
                </button>
                <div style={styles.small}>Set once per driver.</div>
              </div>
            </div>

            <div className="formRowTight" style={styles.formRow}>
              <div className="labelTight" style={styles.label}>Riders (Trip type per person)</div>

              <div className="ridersBoxTight" style={styles.ridersBox}>
                {members.map((m) => {
                  const v = riderTrip[m.member_id] || "none";
                  return (
                    <div key={m.member_id} style={styles.riderRow}>
                      <div style={{ fontWeight: 900, minWidth: 60, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>

                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button type="button" style={{ ...styles.pill, ...(v === "none" ? styles.pillOn : {}), padding: "6px 8px", fontSize: 12, minWidth: "auto" }} onClick={() => setTrip(m.member_id, "none")}>
                          None
                        </button>
                        <button type="button" style={{ ...styles.pill, ...(v === "one_way" ? styles.pillOn : {}), padding: "6px 8px", fontSize: 12, minWidth: "auto" }} onClick={() => setTrip(m.member_id, "one_way")}>
                          One-way
                        </button>
                        <button type="button" style={{ ...styles.pill, ...(v === "two_way" ? styles.pillOn : {}), padding: "6px 8px", fontSize: 12, minWidth: "auto" }} onClick={() => setTrip(m.member_id, "two_way")}>
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
              <div className="labelTight" style={styles.label}>Preview Split</div>
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
              <button
                type="button"
                style={{
                  ...styles.btn,
                  background: "linear-gradient(135deg, #93c5fd 0%, #3b82f6 100%)",
                  color: "white",
                  borderColor: "#3b82f6",
                  boxShadow: "0 12px 24px rgba(59, 130, 246, 0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
                }}
                onClick={onSave}
              >
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
    paddingTop: "max(16px, env(safe-area-inset-top, 47px))",
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
    background: "radial-gradient(circle at top left, rgba(92,103,120,0.14), transparent 28%), linear-gradient(135deg, #02050a 0%, #070b12 100%)",
  },
  joinCard: {
    width: "min(430px, 92vw)",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.07))",
    backdropFilter: "blur(24px) saturate(150%)",
    WebkitBackdropFilter: "blur(24px) saturate(150%)",
    borderRadius: 22,
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxShadow: "0 22px 48px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
  },
  authBrand: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8, marginLeft: 4 },
  authIcon: { width: 48, height: 48, borderRadius: 14, fontSize: 24, background: "transparent" },
  authBrandTitle: { fontWeight: 800, fontSize: 22, color: "#f8fafc", letterSpacing: "0.2px", marginLeft: -6, fontFamily: "'Gill Sans', 'Gill Sans MT', Calibri, 'Trebuchet MS', sans-serif" },
  authHeaderWrap: { marginBottom: 8, textAlign: "center" },
  joinTitle: { fontWeight: 700, fontSize: 18, color: "#f8fafc", fontFamily:"tahoma, sans-serif", marginBottom:4 },
  joinSubtitle: { fontSize: 13, color: "#9aa4b2", marginBottom: 10, fontFamily:"tahoma, sans-serif" },
  joinHint: { fontSize: 12, color: "#9aa4b2", fontWeight: 700, marginTop: 6 },
  authLabel: { display: "block", fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 6, marginLeft: 6, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "left", alignSelf: "flex-start" },
  inputGroup: { marginBottom: 4, display: "flex", flexDirection: "column", width: "100%" },
  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  monthTitle: { fontSize: 16, fontWeight: 950, color: "#f8fafc" },
  btn: {
    border: "1px solid rgba(255, 255, 255, 0.14)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
    backdropFilter: "blur(18px) saturate(140%)",
    WebkitBackdropFilter: "blur(18px) saturate(140%)",
    color: "#f8fafc",
    padding: "10px 12px",
    borderRadius: 12,
    fontWeight: 850,
    cursor: "pointer",
    fontSize: 16,
    boxShadow: "0 10px 20px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.12)",
  },
  btnOn: { borderColor: "rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.16)", boxShadow: "0 8px 18px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.16)" },
  btnPrimary: { background: "linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))", color: "white", borderColor: "rgba(255,255,255,0.18)", boxShadow: "0 12px 24px rgba(34, 197, 94, 0.28), inset 0 1px 0 rgba(255,255,255,0.18)" },
  error: {
    background: "rgba(127, 29, 29, 0.24)",
    border: "1px solid rgba(248, 113, 113, 0.35)",
    color: "#fecaca",
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
    color: "#cbd5e1",
    fontSize: 12,
  },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2 },
  dayCell: {
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 14,
    background: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))",
    backdropFilter: "blur(16px) saturate(140%)",
    WebkitBackdropFilter: "blur(16px) saturate(140%)",
    padding: 8,
    minHeight: 92,
    maxHeight: 92,
    height: 92,
    cursor: "pointer",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 10px 22px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)",
  },
  dayCellHasEntry: { borderColor: "rgba(255,255,255,0.2)", background: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06))", boxShadow: "0 12px 26px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255,255,255,0.12)" },
  dayCellHoliday: { borderColor: "rgba(245, 158, 11, 0.35)", background: "linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(249, 115, 22, 0.1))", boxShadow: "0 10px 24px rgba(245, 158, 11, 0.12), inset 0 1px 0 rgba(255,255,255,0.1)" },
  dayCellToday: { borderColor: "rgba(255,255,255,0.24)", boxShadow: "0 0 0 1px rgba(255,255,255,0.16), 0 10px 24px rgba(0, 0, 0, 0.16) inset" },
  dayTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  dayNum: { fontWeight: 950, color: "#f8fafc", fontSize: 13 },
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
    border: "1px solid rgba(255, 255, 255, 0.14)", 
    borderRadius: 16, 
    padding: 12,
    background: "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
    backdropFilter: "blur(20px) saturate(140%)",
    WebkitBackdropFilter: "blur(20px) saturate(140%)",
    boxShadow: "0 16px 34px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.12)",
  },
  cardSettleUp: { 
    border: "1px solid rgba(255, 255, 255, 0.14)", 
    borderRadius: 16, 
    padding: 12,
    background: "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
    backdropFilter: "blur(20px) saturate(140%)",
    WebkitBackdropFilter: "blur(20px) saturate(140%)",
    boxShadow: "0 16px 34px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.12)",
  },
  cardTitle: { fontWeight: 950, color: "#f8fafc", marginBottom: 6, textAlign: "center" },
  small: { fontSize: 12, color: "#cbd5e1", fontWeight: 700 },
  rowLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0",
    borderBottom: "1px solid rgba(226, 232, 240, 0.22)",
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
    maxWidth: "92vw",
    maxHeight: "90vh",
    overflow: "auto",
    borderRadius: 18,
    background: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06))",
    backdropFilter: "blur(26px) saturate(140%)",
    WebkitBackdropFilter: "blur(26px) saturate(140%)",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    padding: 14,
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.16)",
  },
  modalTitle: { fontWeight: 950, fontSize: 16, color: "#f8fafc", marginBottom: 10 },
  formRow: { marginTop: 10 },
  label: { fontWeight: 900, color: "#e2e8f0", fontSize: 12, marginBottom: 6 },
  input: {
    width: "100%",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 800,
    color: "#f8fafc",
    outline: "none",
    fontSize: 15,
    background: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06))",
    backdropFilter: "blur(16px) saturate(140%)",
    WebkitBackdropFilter: "blur(16px) saturate(140%)",
    transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s ease",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
  },
  select: {
    width: "100%",
    border: "1px solid rgba(47, 191, 113, 0.85)",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 800,
    color: "#f8fafc",
    outline: "none",
    background: "linear-gradient(135deg, rgba(34, 197, 94, 0.95), rgba(22, 163, 74, 0.95))",
    boxShadow: "0 0 0 1px rgba(47, 191, 113, 0.2), inset 0 1px 0 rgba(255,255,255,0.16)",
  },
  ridersBox: { border: "1px solid #e4e7ec", borderRadius: 12, padding: 8 },
  riderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "6px 4px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
    minWidth: 0,
  },
  pill: { 
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))",
    color: "#f8fafc",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 850,
    cursor: "pointer",
    fontSize: 14,
    minWidth: "70px",
    textAlign: "center",
    boxShadow: "0 8px 16px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255,255,255,0.12)",
    transition: "all 0.2s ease",
  },
  pillOn: { borderColor: "rgba(255,255,255,0.34)", background: "linear-gradient(135deg, rgba(47, 191, 113, 0.95), rgba(34, 197, 94, 0.9))", color: "#fff", boxShadow: "0 10px 20px rgba(34, 197, 94, 0.28), inset 0 1px 0 rgba(255,255,255,0.24)", transform: "translateY(-1px)" },
  previewBox: { border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 12, padding: 10, background: "rgba(9, 10, 14, 0.88)" },
};
