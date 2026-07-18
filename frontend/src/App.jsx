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

function BrandMark({ compact = false }) {
  return (
    <div className={`brandLockup${compact ? " brandLockupCompact" : ""}`}>
      <span className="brandSymbol" aria-hidden="true">
        <img src="/rideshare-ledger-icon.png" alt="" />
      </span>
      <span className="brandWords">
        <strong>RideShare</strong>
        {!compact && <small>Ledger</small>}
      </span>
    </div>
  );
}

function UiIcon({ name, className = "" }) {
  const paths = {
    chevronLeft: <path d="m15 18-6-6 6-6" />,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    userPlus: <><path d="M15 19c0-2.2-2-4-4.5-4S6 16.8 6 19" /><circle cx="10.5" cy="8.5" r="3" /><path d="M18 8v6m-3-3h6" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-1.5 4.3" /></>,
    logout: <><path d="M10 5H5v14h5" /><path d="m14 8 4 4-4 4m4-4H9" /></>,
    car: <><path d="M5 17v-5l2-5h10l2 5v5" /><path d="M5 13h14M8 17v2m8-2v2" /><circle cx="8" cy="14.5" r="1" /><circle cx="16" cy="14.5" r="1" /></>,
    carSide: <>
      <path className="sideCarBody" d="M2.3 16.1v-3c0-.9.6-1.6 1.5-1.8l3.1-.6 2.6-4h6.4l3.5 3.9 1.4.3c.8.2 1.3.9 1.3 1.7v3.5h-2.4a2.6 2.6 0 0 0-5.1 0H9.3a2.6 2.6 0 0 0-5.1 0H2.3Z" />
      <path className="sideCarWindow" d="m10 8.1-1.8 2.7h4V8.1H10Zm3.3 0h2l2.4 2.7h-4.4V8.1Z" />
      <path className="sideCarDetail" d="M3.1 13h2.1m14.7 0h1.6m-8.2-.4h2.2" />
      <circle className="sideCarWheel" cx="6.8" cy="16.2" r="2.15" />
      <circle className="sideCarHub" cx="6.8" cy="16.2" r=".75" />
      <circle className="sideCarWheel" cx="17.1" cy="16.2" r="2.15" />
      <circle className="sideCarHub" cx="17.1" cy="16.2" r=".75" />
    </>,
    users: <><circle cx="9" cy="9" r="3" /><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5" /><path d="M16 7.5a2.5 2.5 0 0 1 0 5M16.5 14c2 0 3.5 1.6 3.5 3.5" /></>,
    wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19v14H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" /><path d="M4 8h15m-4 4h4v4h-4a2 2 0 0 1 0-4Z" /></>,
    settle: <><path d="M5 8h13m-3-3 3 3-3 3M19 16H6m3 3-3-3 3-3" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4m8-4v4M4 10h16" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7" /><path d="M10 11v5m4-5v5" /></>,
    save: <><path d="M5 4h12l2 2v14H5V4Z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
    close: <path d="m7 7 10 10M17 7 7 17" />,
  };

  return (
    <svg className={`uiIcon${className ? ` ${className}` : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function AuthBenefits({ className = "" }) {
  return (
    <div className={`authBenefits${className ? ` ${className}` : ""}`} aria-label="RideShare benefits">
      <div className="authBenefit">
        <span className="authBenefitIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 17.5c1.8-4.3 4.2-6.4 7.1-6.4s5.1-2.1 6.9-6.3M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>
        </span>
        <span>Track rides</span>
      </div>
      <div className="authBenefit">
        <span className="authBenefitIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3v18M5 7.5h10.5a3.5 3.5 0 0 1 0 7H8.3a3.3 3.3 0 0 0 0 6.5H19" /></svg>
        </span>
        <span>Split costs</span>
      </div>
      <div className="authBenefit">
        <span className="authBenefitIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M20 11.1V12a8 8 0 1 1-4.7-7.3M8.5 11.8l2.3 2.3L20 5" /></svg>
        </span>
        <span>Settle up</span>
      </div>
    </div>
  );
}

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
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [authPending, setAuthPending] = useState(false);

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
    // Allow the full car and caption sequence to finish before the splash closes.
    const t = setTimeout(() => setShowSplash(false), 2400);
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
      setAuthErr("Group ID and Join Code are required.");
      return;
    }

    setAuthPending(true);

    localStorage.setItem("group_id", gid);
    localStorage.setItem("join_code", jcode);

    try {
      await groupCheck();
      setShowSplash(true);
      setGroupOk(true);
      await loadAll();
      setTimeout(() => setShowSplash(false), 2400);
    } catch (e2) {
      setGroupOk(false);
      setAuthErr(e2.message || "Invalid group");
      setShowSplash(false);
    } finally {
      setAuthPending(false);
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
    let twoWayCount = 0;
    for (const t of Object.values(riderTrip)) {
      if (t === "two_way") twoWayCount++;
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
    let twoWayCount = 0;
    for (const r of riders) {
      if (r.trip_type === "two_way") twoWayCount++;
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
      <main className="authPage">
        {showSplash && (
          <div className="splashOverlay">
            <div className="splashCard">
              <BrandMark />
              <div className="road">
                <div className="car" aria-hidden="true"><UiIcon name="carSide" /></div>
              </div>
              <div className="splashSub" aria-label="Preparing your trip. Buckle up.">
                <span className="splashMessage splashMessagePrimary" aria-hidden="true">Preparing your trip</span>
                <span className="splashMessage splashMessageSecondary" aria-hidden="true">Buckle up</span>
              </div>
              <div className="splashProgress" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div className="authGlow authGlowOne" aria-hidden="true" />
        <div className="authGlow authGlowTwo" aria-hidden="true" />
        <div className="authGrid" aria-hidden="true" />

        <div className="authLayout">
          <section className="authStory" aria-label="RideShare Ledger overview">
            <BrandMark />

            <div className="authStoryCopy">
              <div className="authEyebrow"><span /> Shared rides, clear books</div>
              <h1>Every ride.<br /><em>Perfectly balanced.</em></h1>
              <p>One private place for your group to track trips, split costs, and settle up without the spreadsheet shuffle.</p>
            </div>

            <AuthBenefits />

            <div className="authTrust"><span className="shieldIcon">✓</span> Private to your group · Encrypted in transit</div>
          </section>

          <section className="authPanel">
            <div className="authMobileBrand"><BrandMark /></div>

            <form onSubmit={handleJoin} className="authCard" noValidate>
              <div className="authCardHeader">
                <div className="authKicker">Member access</div>
                <h2>Welcome back</h2>
                <p>Enter the credentials shared by your group organizer.</p>
              </div>

              {authErr && (
                <div className="authError" role="alert">
                  <span aria-hidden="true">!</span>
                  <div><strong>We couldn’t sign you in</strong><small>{authErr}</small></div>
                </div>
              )}

              <div className="authField">
                <label htmlFor="group-id">Group ID</label>
                <div className="authInputWrap">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 18.5v-1.2c0-1.8-1.8-3.3-4-3.3s-4 1.5-4 3.3v1.2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 9h4m-2-2v4" /></svg>
                  <input
                    id="group-id"
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck="false"
                    placeholder="e.g. northstar-team"
                    aria-invalid={authErr ? "true" : "false"}
                  />
                </div>
              </div>

              <div className="authField">
                <div className="authLabelRow">
                  <label htmlFor="join-code">Join code</label>
                  <span>Up to 8 characters</span>
                </div>
                <div className="authInputWrap">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v9H6v-9Zm6 4v2" /></svg>
                  <input
                    id="join-code"
                    type={showJoinCode ? "text" : "password"}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    autoComplete="current-password"
                    maxLength={8}
                    placeholder="Enter your join code"
                    aria-invalid={authErr ? "true" : "false"}
                  />
                  <button
                    className="revealCode"
                    type="button"
                    onClick={() => setShowJoinCode((visible) => !visible)}
                    aria-label={showJoinCode ? "Hide join code" : "Show join code"}
                    aria-pressed={showJoinCode}
                  >
                    {showJoinCode ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <button className="authSubmit" type="submit" disabled={authPending}>
                <span>{authPending ? "Signing in…" : "Sign in"}</span>
                {authPending ? <i className="authSpinner" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}
              </button>

              <div className="authHelp">
                <span aria-hidden="true">?</span>
                <p><strong>Need your access details?</strong> Ask your group organizer for the Group ID and Join code.</p>
              </div>

              <AuthBenefits className="authBenefitsMobile" />
            </form>

            <div className="authLegal">By continuing, you’re accessing a private group workspace.</div>
          </section>
        </div>
      </main>
    );
  }

  // =========================
  // MAIN APP UI
  // =========================
  return (
    <main className="appShell">
      {showSplash && (
        <div className="splashOverlay">
          <div className="splashCard">
            <BrandMark />
            <div className="road">
              <div className="car" aria-hidden="true"><UiIcon name="carSide" /></div>
            </div>
            <div className="splashSub" aria-label="Preparing your trip. Buckle up.">
              <span className="splashMessage splashMessagePrimary" aria-hidden="true">Preparing your trip</span>
              <span className="splashMessage splashMessageSecondary" aria-hidden="true">Buckle up</span>
            </div>
            <div className="splashProgress" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      <div className="appAmbient appAmbientOne" aria-hidden="true" />
      <div className="appAmbient appAmbientTwo" aria-hidden="true" />
      <div className="appGrid" aria-hidden="true" />

      <div className="appContent">
        <header className="appHeader">
          <BrandMark />
          <div className="workspaceStatus workspaceStatusDesktop">
            <span className="statusDot" />
            <span>{groupId}</span>
          </div>
        </header>

        <section className="dashboardIntro">
          <div>
            <div className="dashboardTitleRow">
              <h1>Ride calendar</h1>
              <div className="workspaceStatus workspaceStatusMobile">
                <UiIcon name="users" className="groupStatusIcon" />
                <span>{groupId}</span>
              </div>
            </div>
            <p>Plan rides, split each trip, and keep every balance current.</p>
          </div>
          <div className="dashboardStats" aria-label="Workspace summary">
            <div><strong>{entries.length}</strong><span>Trips this month</span></div>
            <div><strong>{members.length}</strong><span>Active members</span></div>
            <div><strong>{transfers.length}</strong><span>Settlements</span></div>
          </div>
        </section>

        <section className="appToolbar" aria-label="Calendar controls">
          <div className="monthNavigator">
            <button className="iconButton" type="button" onClick={prevMonth} aria-label="Previous month">
              <UiIcon name="chevronLeft" />
            </button>
            <div className="monthTitle">
              <span>Viewing</span>
              <strong>{monthDisplay}</strong>
            </div>
            <button className="iconButton" type="button" onClick={nextMonth} aria-label="Next month">
              <UiIcon name="chevronRight" />
            </button>
          </div>

          <div className="toolbarActions">
            <button className="appButton appButtonPrimary" type="button" onClick={() => { setMemberErr(""); setMemberOpen(true); }}>
              <UiIcon name="userPlus" />
              <span>Add member</span>
            </button>
            <button className="appButton" type="button" onClick={loadAll} disabled={loading}>
              <UiIcon name="refresh" className={loading ? "isSpinning" : ""} />
              <span>{loading ? "Refreshing" : "Refresh"}</span>
            </button>
            <button className="appButton appButtonQuiet" type="button" onClick={logout}>
              <UiIcon name="logout" />
              <span>Sign out</span>
            </button>
          </div>
        </section>

        {err && <div className="appError" role="alert">{err}</div>}

        <section className="calendarPanel">
          <div className="calendarPanelHeader">
            <div><UiIcon name="calendar" /><strong>Weekday schedule</strong></div>
            <span>Select a day to add or edit a ride</span>
          </div>

          <div
            className="calendarContainer"
            style={{
              animation: transitionDirection === "prev" ? "calendarFromLeft 0.34s ease-out" : transitionDirection === "next" ? "calendarFromRight 0.34s ease-out" : "none",
              touchAction: "pan-y",
            }}
            onPointerDown={handleSwipeStart}
            onPointerUp={handleSwipeEnd}
            onClickCapture={handleCalendarClick}
          >
          <div className="weekHeader">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
            <div key={label} className="weekHeaderCell">
              {label}
            </div>
          ))}
          </div>

          {weeks.map((week, wi) => (
          <div key={wi} className="weekRow">
            {week.map((d, idx) => {
              if (!d) {
                return (
                  <div
                    key={`empty-${wi}-${idx}`}
                    className="calendarCell calendarCellEmpty"
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
                  className={`calendarCell${e ? " calendarCellHasEntry" : ""}${isHoliday ? " calendarCellHoliday" : ""}${isToday ? " calendarCellToday" : ""}`}
                  onClick={() => openDay(d)}
                >
                  <div className="dayTop">
                    <div className="dayNum">{d.getDate()}</div>
                    {isToday && <span className="todayTag">Today</span>}
                  </div>

                  {e ? (
                    <>
                      <div className="cellDetails">
                        <div className="pcDriver">
                          <UiIcon name="car" />
                          {nameById[e.driver_id] || e.driver_id}
                        </div>
                        <div className="pcRiders">
                          <UiIcon name="users" />
                          {e.riders?.length || 0} riders
                        </div>
                      </div>

                      <div className="mobileSummary">
                        <div className="mobileDriver">
                          <UiIcon name="car" />
                          {nameById[e.driver_id] || e.driver_id}
                        </div>
                        <div className="mobileRiders">
                          <UiIcon name="users" />
                          {e.riders?.length || 0}
                        </div>
                      </div>
                    </>
                  ) : null}

                  {isHoliday && (
                    <div className="holidayTag">
                      {holidayName}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          ))}
          </div>
        </section>

        <section className="bottomGrid">
        <article className="summaryCard balanceCard">
          <header className="summaryCardHeader">
            <span className="summaryIcon"><UiIcon name="wallet" /></span>
            <div><h2>Balances</h2><p>Current position by member</p></div>
          </header>
          <div className="summaryRows">
            {allMembers
              .slice()
              .sort((a, b) => Number(b.active) - Number(a.active))
              .filter((m) => m.active || Math.abs(balances[m.member_id] ?? 0) > 0.005)
              .map((m) => {
                const balance = Number(balances[m.member_id] ?? 0);
                return (
                <div key={m.member_id} className={`summaryRow${m.active ? "" : " isInactive"}`}>
                  <div className="memberIdentity">
                    <span>{m.name?.slice(0, 1)?.toUpperCase()}</span>
                    <div><strong>{m.name}</strong>{!m.active && <small>Inactive</small>}</div>
                  </div>
                  <div className={`balanceAmount ${balance >= 0 ? "isPositive" : "isNegative"}`}>
                    {balance >= 0 ? "+" : "−"}${Math.abs(balance).toFixed(2)}
                  </div>
                </div>
              )})}
          </div>
        </article>

        <article className="summaryCard settleCard">
          <header className="summaryCardHeader">
            <span className="summaryIcon"><UiIcon name="settle" /></span>
            <div><h2>Settle up</h2><p>Suggested transfers</p></div>
          </header>
          <div className="summaryRows">
            {transfers.length === 0 ? (
              <div className="emptyState"><span>✓</span><strong>All settled</strong><p>No transfers are needed this month.</p></div>
            ) : (
              transfers.map((t, i) => (
                <div key={i} className="summaryRow transferRow">
                  <div>
                    <strong>{nameById[t.from] || t.from}</strong>
                    <span><UiIcon name="chevronRight" /></span>
                    <strong>{nameById[t.to] || t.to}</strong>
                  </div>
                  <div className="transferAmount">${Number(t.amount).toFixed(2)}</div>
                </div>
              ))
            )}
          </div>
        </article>
        </section>
      </div>

      {/* Day modal */}
      {open && (
        <div className="modalBackdrop" onClick={() => setOpen(false)}>
          <div className="modal tripModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <span className="sectionKicker">Ride details</span>
                <h2>{activeDay ? activeDay.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""}</h2>
              </div>
              <button className="iconButton modalClose" type="button" onClick={() => setOpen(false)} aria-label="Close ride details">
                <UiIcon name="close" />
              </button>
            </div>

            <div className="modalBody">
            <section className="formSection">
              <div className="formSectionHeader"><strong>Trip setup</strong><span>Choose the driver and trip rates.</span></div>
              <label className="appLabel" htmlFor="driver-select">Driver</label>
              <div className="selectControl">
                <select
                  id="driver-select"
                  className="appControl"
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
                <UiIcon name="chevronRight" />
              </div>

              <div className="appLabel appLabelSpaced">Driver rates</div>
              <div className="rateRow">
                <div className="rateInputWrapper">
                  <input
                    className="rateInput"
                    inputMode="decimal"
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
                    inputMode="decimal"
                    placeholder=" "
                    value={driverRatesForm.one_way_total}
                    onChange={(e) => setDriverRatesForm((p) => ({ ...p, one_way_total: e.target.value }))}
                  />
                  <span className="rateLabel">One-way total ($)</span>
                </div>
              </div>

              <div className="inlineAction">
                <button type="button" className="appButton appButtonSmall" onClick={onUpdateRates}>
                  Save Rates
                </button>
                <span>Saved for future trips with this driver.</span>
              </div>
            </section>

            <section className="formSection">
              <div className="formSectionHeader"><strong>Riders</strong><span>Set each person’s trip type.</span></div>
              <div className="ridersBoxTight ridersBox">
                {members.map((m) => {
                  const v = riderTrip[m.member_id] || "none";
                  return (
                    <div key={m.member_id} className="riderRow">
                      <div className="riderName"><span>{m.name?.slice(0, 1)?.toUpperCase()}</span><strong>{m.name}</strong></div>
                      <div className="tripSelector">
                        <button type="button" className={`tripPill${v === "none" ? " isActive" : ""}`} onClick={() => setTrip(m.member_id, "none")}>
                          None
                        </button>
                        <button type="button" className={`tripPill${v === "one_way" ? " isActive" : ""}`} onClick={() => setTrip(m.member_id, "one_way")}>
                          One-way
                        </button>
                        <button type="button" className={`tripPill${v === "two_way" ? " isActive" : ""}`} onClick={() => setTrip(m.member_id, "two_way")}>
                          Two-way
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="formSection formSectionCompact">
              <label className="appLabel" htmlFor="ride-notes">Notes</label>
              <input id="ride-notes" className="appControl" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add an optional note" />
            </section>

            <section className="formSection splitSection">
              <div className="formSectionHeader"><strong>Split preview</strong><span>Calculated from the selected rider trips.</span></div>
              <div className="previewBoxTight previewBox">
                {computedPreview.riders.length === 0 ? (
                  <div className="previewEmpty">Select riders to see their charges.</div>
                ) : (
                  computedPreview.riders.map((r) => (
                    <div key={r.member_id} className="previewRow">
                      <div><strong>{r.name}</strong><span>{r.trip_type.replace("_", " ")}</span></div>
                      <strong>{r.charge}</strong>
                    </div>
                  ))
                )}
                <div className="previewTotal">
                  <span>Total</span>
                  <strong>${computedPreview.total}</strong>
                </div>
              </div>
            </section>
            </div>

            <div className="modalFooter">
              <button type="button" className="appButton appButtonDanger" onClick={onClear}>
                <UiIcon name="trash" />
                Clear day
              </button>
              <span className="modalFooterSpacer" />
              <button type="button" className="appButton" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="appButton appButtonPrimary" onClick={onSave}>
                <UiIcon name="save" />
                Save ride
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {memberOpen && (
        <div className="modalBackdrop" onClick={() => setMemberOpen(false)}>
          <div className="modal memberModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div><span className="sectionKicker">Workspace access</span><h2>Add member</h2></div>
              <button className="iconButton modalClose" type="button" onClick={() => setMemberOpen(false)} aria-label="Close add member form"><UiIcon name="close" /></button>
            </div>

            <div className="modalBody">
            <p className="modalIntro">Add a rider to your shared ledger. Their rates can be configured when you record a trip.</p>
            {memberErr && <div className="appError" role="alert">{memberErr}</div>}

            <div className="formSection formSectionCompact">
              <label className="appLabel" htmlFor="member-name">Full name</label>
              <input id="member-name" className="appControl" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="e.g. Arun Kumar" />
            </div>

            <div className="formSection formSectionCompact">
              <label className="appLabel" htmlFor="member-phone">Mobile number</label>
              <div className="phoneControl">
                <div className="selectControl countryControl">
                  <select
                    className="appControl"
                    value={newMemberCountryCode}
                    onChange={(e) => setNewMemberCountryCode(e.target.value)}
                  >
                    {countryCodes.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.code}
                      </option>
                    ))}
                  </select>
                  <UiIcon name="chevronRight" />
                </div>
                <input
                  id="member-phone"
                  className="appControl"
                  inputMode="tel"
                  value={newMemberPhone}
                  onChange={(e) => setNewMemberPhone(e.target.value)}
                  placeholder="Phone number"
                />
              </div>
              <div className="fieldHint">Used only for group contact and ride coordination.</div>
            </div>
            </div>

            <div className="modalFooter">
              <span className="modalFooterSpacer" />
              <button type="button" className="appButton" onClick={() => setMemberOpen(false)}>
                Cancel
              </button>
              <button type="button" className="appButton appButtonPrimary" onClick={onCreateMember}>
                <UiIcon name="userPlus" />
                Add member
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
