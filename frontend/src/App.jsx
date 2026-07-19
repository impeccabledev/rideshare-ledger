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
const shiftMonthKey = (monthKey, offset) => {
  const [year, month] = monthKey.split("-").map(Number);
  return fmtMonthApi(new Date(year, month - 1 + offset, 1));
};

function BrandMark({ compact = false, smallGlyph = false }) {
  return (
    <div className={`brandLockup${compact ? " brandLockupCompact" : ""}${smallGlyph ? " brandLockupSmallGlyph" : ""}`}>
      <span className="brandSymbol" aria-hidden="true">
        <img src={smallGlyph ? "/rideshare-ledger-glyph.svg" : "/rideshare-ledger-icon.png"} alt="" />
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
    rideCar: <><path d="M3 15v-2.4c0-.8.5-1.4 1.3-1.6l3.1-.8 2.4-3.5h5.3l3.3 3.5 1.5.4c.7.2 1.1.8 1.1 1.5V15h-1.7M4.7 15h-.9m5.2 0h6" /><path d="M8 10.2h10.4M10 6.7v3.5m5.1-3.5v3.5" /><circle cx="6.8" cy="15" r="2.1" /><circle cx="17.2" cy="15" r="2.1" /></>,
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
    check: <path d="m5 12.5 4.2 4.2L19 7" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6m12 12 1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
    moon: <path d="M20 15.2A8.3 8.3 0 0 1 8.8 4a8.3 8.3 0 1 0 11.2 11.2Z" />,
  };

  return (
    <svg className={`uiIcon${className ? ` ${className}` : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function ThemeSwitch({ theme, onToggle, className = "" }) {
  const isLight = theme === "light";

  return (
    <button
      className={`themeToggle${isLight ? " isLight" : ""}${className ? ` ${className}` : ""}`}
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${isLight ? "dark" : "light"} theme`}
      aria-pressed={isLight}
      title={`Switch to ${isLight ? "dark" : "light"} theme`}
    >
      <span className="themeToggleThumb" aria-hidden="true" />
      <UiIcon name="sun" className="themeSun" />
      <UiIcon name="moon" className="themeMoon" />
    </button>
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
  const [theme, setTheme] = useState(() =>
    localStorage.getItem("rideshare_theme") === "light" ? "light" : "dark"
  );

  // ------- Auth state (JOIN screen) -------
  const [groupOk, setGroupOk] = useState(false);
  const [groupId, setGroupId] = useState(() => localStorage.getItem("group_id") || "");
  const [joinCode, setJoinCode] = useState(() => localStorage.getItem("join_code") || "");
  const [authErr, setAuthErr] = useState("");
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authBooting, setAuthBooting] = useState(() => Boolean(
    (localStorage.getItem("group_id") || "").trim() &&
    (localStorage.getItem("join_code") || "").trim()
  ));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("rideshare_theme", theme);

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute("content", theme === "light" ? "#f3f7f4" : "#07100d");
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => currentTheme === "light" ? "dark" : "light");
  }, []);

  // ------- App data state -------
  const [firstLaunchSplash, setFirstLaunchSplash] = useState(
    () => localStorage.getItem("rideshare_splash_seen") !== "true"
  );
  const [networkSplash, setNetworkSplash] = useState(false);
  const showSplash = firstLaunchSplash || networkSplash;
  const networkSplashTimerRef = useRef(null);

  const [monthDate, setMonthDate] = useState(() => new Date());
  const [monthTransition, setMonthTransition] = useState("none");
  const swipeStartRef = useRef(null);
  const swipeHandledRef = useRef(false);
  const monthTransitionLockRef = useRef(false);
  const monthTransitionTimersRef = useRef([]);
  const month = useMemo(() => fmtMonthApi(monthDate), [monthDate]);
  const monthDisplay = useMemo(() => fmtMonthDisplay(monthDate), [monthDate]);
  const activeMonthRef = useRef(month);
  activeMonthRef.current = month;
  const loadedMonthRef = useRef("");
  const monthRequestRef = useRef(0);
  const monthCacheRef = useRef(new Map());
  const prefetchQueueRef = useRef(Promise.resolve());
  const prefetchPendingRef = useRef(new Set());

  const [allMembers, setAllMembers] = useState([]);
  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [holidays, setHolidays] = useState([]);
  
  // Force re-render counter
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const pullStartRef = useRef(null);
  const pullDistanceRef = useRef(0);

  // ------- Day modal state -------
  const [open, setOpen] = useState(false);
  const [tripModalClosing, setTripModalClosing] = useState(false);
  const [rideSaveState, setRideSaveState] = useState("idle");
  const [rateSaveState, setRateSaveState] = useState("idle");
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
  const [memberModalClosing, setMemberModalClosing] = useState(false);
  const [memberSaveState, setMemberSaveState] = useState("idle");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberCountryCode, setNewMemberCountryCode] = useState("+1");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [memberErr, setMemberErr] = useState("");
  const tripCloseTimerRef = useRef(null);
  const memberCloseTimerRef = useRef(null);

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

  const showToast = useCallback((message, type = "success") => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, type });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const closeTripModal = useCallback(() => {
    if (tripModalClosing) return;
    setTripModalClosing(true);
    window.clearTimeout(tripCloseTimerRef.current);
    tripCloseTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setTripModalClosing(false);
      setRideSaveState("idle");
    }, 220);
  }, [tripModalClosing]);

  const closeMemberModal = useCallback(() => {
    if (memberModalClosing) return;
    setMemberModalClosing(true);
    window.clearTimeout(memberCloseTimerRef.current);
    memberCloseTimerRef.current = window.setTimeout(() => {
      setMemberOpen(false);
      setMemberModalClosing(false);
      setMemberSaveState("idle");
    }, 220);
  }, [memberModalClosing]);

  async function runWithContextualSplash(task) {
    window.clearTimeout(networkSplashTimerRef.current);
    networkSplashTimerRef.current = window.setTimeout(() => setNetworkSplash(true), 400);
    try {
      return await task();
    } finally {
      window.clearTimeout(networkSplashTimerRef.current);
      setNetworkSplash(false);
    }
  }

  function prefetchMonth(targetMonth) {
    if (monthCacheRef.current.has(targetMonth) || prefetchPendingRef.current.has(targetMonth)) {
      return prefetchQueueRef.current;
    }

    prefetchPendingRef.current.add(targetMonth);
    prefetchQueueRef.current = prefetchQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const [monthEntries, monthHolidays] = await Promise.all([
            getEntries(targetMonth),
            getHolidays(targetMonth),
          ]);
          monthCacheRef.current.set(targetMonth, {
            entries: monthEntries || [],
            holidays: monthHolidays || [],
          });
        } catch {
          // Prefetch is opportunistic; the foreground request will surface errors.
        } finally {
          prefetchPendingRef.current.delete(targetMonth);
        }
      });

    return prefetchQueueRef.current;
  }

  // ---- Boot: first-launch splash + auto-check stored creds ----
  useEffect(() => {
    if (!firstLaunchSplash) return undefined;
    localStorage.setItem("rideshare_splash_seen", "true");
    const timer = window.setTimeout(() => setFirstLaunchSplash(false), 1100);
    return () => window.clearTimeout(timer);
  }, [firstLaunchSplash]);

  useEffect(() => {
    async function bootAuth() {
      const gid = (localStorage.getItem("group_id") || "").trim();
      const jcode = (localStorage.getItem("join_code") || "").trim();

      if (!gid || !jcode) {
        setGroupOk(false);
        setAuthBooting(false);
        return;
      }

      try {
        await runWithContextualSplash(async () => {
          await groupCheck();
          await loadAll({ targetMonth: month, force: true });
        });
        setGroupOk(true);
      } catch (e) {
        localStorage.removeItem("group_id");
        localStorage.removeItem("join_code");
        setGroupId("");
        setJoinCode("");
        setGroupOk(false);
        setAuthErr(e.message || "Invalid group");
      } finally {
        setAuthBooting(false);
      }
    }
    bootAuth();
    // Authentication boot intentionally runs once with the initial month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll({
    targetMonth = month,
    force = false,
    skipDriverReset = false,
    throwOnError = false,
  } = {}) {
    const requestId = ++monthRequestRef.current;
    let cached = monthCacheRef.current.get(targetMonth);

    if (prefetchPendingRef.current.size > 0) {
      if (force || !cached) setLoading(true);
      await prefetchQueueRef.current.catch(() => undefined);
      cached = monthCacheRef.current.get(targetMonth);
      if (requestId !== monthRequestRef.current || activeMonthRef.current !== targetMonth) {
        return false;
      }
    }

    if (cached && !force && activeMonthRef.current === targetMonth) {
      setEntries(cached.entries);
      setHolidays(cached.holidays);
    }

    setLoading(force || !cached);
    setErr("");
    try {
      const [m, e, h] = cached && !force
        ? [await getMembers(), cached.entries, cached.holidays]
        : await Promise.all([
          getMembers(),
          getEntries(targetMonth),
          getHolidays(targetMonth),
        ]);

      monthCacheRef.current.set(targetMonth, {
        entries: e || [],
        holidays: h || [],
      });

      if (requestId !== monthRequestRef.current || activeMonthRef.current !== targetMonth) {
        return false;
      }

      setAllMembers(m || []);
      const active = (m || []).filter((x) => x.active);
      setMembers(active);
      setEntries(e || []);
      setHolidays(h || []);
      loadedMonthRef.current = targetMonth;
      // Only auto-select first driver if driverId is truly empty (not __none__)
      if (!skipDriverReset && !driverId && !driverId.startsWith("__") && active.length) {
        setDriverId(active[0].member_id);
      }

      prefetchMonth(shiftMonthKey(targetMonth, -1));
      prefetchMonth(shiftMonthKey(targetMonth, 1));
      return true;
    } catch (e) {
      if (requestId === monthRequestRef.current && activeMonthRef.current === targetMonth) {
        setErr(e.message || "Failed to load");
      }
      if (throwOnError) throw e;
      return false;
    } finally {
      if (requestId === monthRequestRef.current && activeMonthRef.current === targetMonth) {
        setLoading(false);
      }
    }
  }

  // load data only when groupOk is true
  useEffect(() => {
    if (!groupOk || loadedMonthRef.current === month) return;
    loadAll({ targetMonth: month });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupOk, month]);

  useEffect(() => () => {
    window.clearTimeout(networkSplashTimerRef.current);
    window.clearTimeout(toastTimerRef.current);
    window.clearTimeout(tripCloseTimerRef.current);
    window.clearTimeout(memberCloseTimerRef.current);
    monthTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function logout() {
    localStorage.removeItem("group_id");
    localStorage.removeItem("join_code");
    setGroupId("");
    setJoinCode("");
    setAuthErr("");
    setErr("");
    setGroupOk(false);
  }

  function handlePullStart(e) {
    if (
      e.pointerType === "mouse" ||
      window.innerWidth > 640 ||
      window.scrollY > 1 ||
      open ||
      memberOpen ||
      pullRefreshing
    ) return;

    pullStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePullMove(e) {
    if (!pullStartRef.current) return;
    const dx = e.clientX - pullStartRef.current.x;
    const dy = e.clientY - pullStartRef.current.y;

    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      pullStartRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }

    if (dy > 8) e.preventDefault();
    const distance = Math.min(72, Math.max(0, (dy - 4) * 0.42));
    pullDistanceRef.current = distance;
    setPullDistance(distance);
  }

  async function handlePullEnd() {
    if (!pullStartRef.current) return;
    pullStartRef.current = null;
    const shouldRefresh = pullDistanceRef.current >= 56;
    pullDistanceRef.current = 0;

    if (!shouldRefresh) {
      setPullDistance(0);
      return;
    }

    setPullRefreshing(true);
    setPullDistance(56);
    const refreshed = await loadAll({ targetMonth: month, force: true });
    if (refreshed) showToast("Calendar updated");
    else showToast("Couldn’t refresh. Showing saved data.", "error");
    setPullRefreshing(false);
    setPullDistance(0);
  }

  function handlePullCancel() {
    pullStartRef.current = null;
    pullDistanceRef.current = 0;
    if (!pullRefreshing) setPullDistance(0);
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
      await runWithContextualSplash(async () => {
        await groupCheck();
        await loadAll({ targetMonth: month, force: true });
      });
      setGroupOk(true);
    } catch (e2) {
      localStorage.removeItem("group_id");
      localStorage.removeItem("join_code");
      setGroupOk(false);
      setAuthErr(e2.message || "Invalid group");
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

  function navigateMonth(offset) {
    if (monthTransitionLockRef.current) return;
    monthTransitionLockRef.current = true;
    monthRequestRef.current += 1;

    const targetDate = new Date(monthDate);
    targetDate.setDate(1);
    targetDate.setMonth(targetDate.getMonth() + offset);
    const targetMonth = fmtMonthApi(targetDate);

    prefetchMonth(targetMonth);
    setMonthTransition(offset > 0 ? "calendarExitLeft" : "calendarExitRight");

    const swapTimer = window.setTimeout(() => {
      const cached = monthCacheRef.current.get(targetMonth);
      activeMonthRef.current = targetMonth;
      loadedMonthRef.current = "";

      if (cached) {
        setEntries(cached.entries);
        setHolidays(cached.holidays);
        setLoading(false);
      } else {
        setEntries([]);
        setHolidays([]);
        setLoading(true);
      }

      setMonthDate(targetDate);
      setMonthTransition(offset > 0 ? "calendarEnterRight" : "calendarEnterLeft");
    }, 140);

    const finishTimer = window.setTimeout(() => {
      setMonthTransition("none");
      monthTransitionLockRef.current = false;
    }, 360);

    monthTransitionTimersRef.current = [swapTimer, finishTimer];
  }

  function prevMonth() {
    navigateMonth(-1);
  }

  function nextMonth() {
    navigateMonth(1);
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

    window.clearTimeout(tripCloseTimerRef.current);
    setTripModalClosing(false);
    setRideSaveState("idle");

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
    if (!activeDay || rideSaveState === "saving") return;
    setRideSaveState("saving");

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
        monthCacheRef.current.set(month, { entries: filteredEntries, holidays });
        
        // Reset the clear flag
        setShouldClear(false);
        
        setRideSaveState("success");
        showToast("Ride removed");
        window.setTimeout(closeTripModal, 420);
        
        console.log("Clear complete - entry removed from UI");
      } catch (e) {
        console.error("Clear error:", e);
        setErr(e.message || "Failed to clear entry");
        setRideSaveState("idle");
        showToast(e.message || "Failed to clear entry", "error");
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

      const nextEntries = [
        ...entries.filter((existingEntry) => existingEntry.date !== date),
        entry,
      ].sort((a, b) => a.date.localeCompare(b.date));
      setEntries(nextEntries);
      monthCacheRef.current.set(month, { entries: nextEntries, holidays });

      setRideSaveState("success");
      showToast("Ride saved");
      window.setTimeout(closeTripModal, 420);

      // Revalidate in the background while the optimistic result remains visible.
      loadAll({ targetMonth: month, force: true, skipDriverReset: true });
    } catch (e) {
      setErr(e.message || "Failed to save entry");
      setRideSaveState("idle");
      showToast(e.message || "Failed to save entry", "error");
    }
  }

  async function onUpdateRates() {
    setErr("");
    if (!driverId || rateSaveState !== "idle") return;
    setRateSaveState("saving");
    try {
      await updateMemberRates({
        member_id: driverId,
        one_way_total: Number(driverRatesForm.one_way_total),
        two_way_total: Number(driverRatesForm.two_way_total),
      });
      await loadAll({ targetMonth: month, force: true, skipDriverReset: true, throwOnError: true });
      setRateSaveState("success");
      showToast("Driver rates saved");
      window.setTimeout(() => setRateSaveState("idle"), 1400);
    } catch (e) {
      setErr(e.message || "Failed to update rates");
      setRateSaveState("idle");
      showToast(e.message || "Failed to update rates", "error");
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

    if (memberSaveState === "saving") return;
    setMemberSaveState("saving");

    try {
      await createMember({ name, phone: fullPhone, active: true });
      setNewMemberName("");
      setNewMemberPhone("");
      setMemberSaveState("success");
      showToast("Member added");
      window.setTimeout(closeMemberModal, 420);
      loadAll({ targetMonth: month, force: true, skipDriverReset: true });
    } catch (e) {
      setMemberErr(e.message || "Failed to create member");
      setMemberSaveState("idle");
      showToast(e.message || "Failed to create member", "error");
    }
  }


  // ---------- Balances ----------
  const balances = useMemo(() => computeMonthBalances(allMembers, entries), [allMembers, entries]);
  const transfers = useMemo(() => suggestTransfers(balances), [balances]);

  const todayStr = fmtDate(new Date());

  if (authBooting) {
    return (
      <main className="authBootPage" data-theme={theme}>
        {showSplash ? (
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
              <div className="splashProgress" aria-hidden="true"><span /><span /><span /></div>
            </div>
          </div>
        ) : (
          <div className="authBootState" role="status" aria-live="polite">
            <BrandMark smallGlyph />
            <div className="authBootPulse" aria-hidden="true"><span /><span /><span /></div>
            <span>Opening your workspace</span>
          </div>
        )}
      </main>
    );
  }

  // =========================
  // JOIN SCREEN
  // =========================
  if (!groupOk) {
    return (
      <main className="authPage" data-theme={theme}>
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
        <ThemeSwitch theme={theme} onToggle={toggleTheme} className="themeToggleAuth themeToggleAuthDesktop" />

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
            <div className="authMobileBrand">
              <BrandMark />
              <ThemeSwitch theme={theme} onToggle={toggleTheme} className="themeToggleAuthMobile" />
            </div>

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
    <main
      className={`appShell${pullDistance > 0 ? " isPulling" : ""}`}
      data-theme={theme}
      onPointerDown={handlePullStart}
      onPointerMove={handlePullMove}
      onPointerUp={handlePullEnd}
      onPointerCancel={handlePullCancel}
    >
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

      {toast && (
        <div
          key={toast.id}
          className={`appToast appToast${toast.type === "error" ? "Error" : "Success"}`}
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
          <span aria-hidden="true">{toast.type === "error" ? "!" : <UiIcon name="check" />}</span>
          <strong>{toast.message}</strong>
        </div>
      )}

      <div
        className={`pullRefreshIndicator${pullDistance >= 56 ? " isReady" : ""}${pullRefreshing ? " isRefreshing" : ""}`}
        style={{
          opacity: pullRefreshing ? 1 : Math.min(1, pullDistance / 44),
          transform: `translate(-50%, ${Math.min(18, pullDistance * 0.22) - 10}px)`,
        }}
        role="status"
        aria-live="polite"
      >
        <UiIcon name="refresh" />
        <span>{pullRefreshing ? "Refreshing…" : pullDistance >= 56 ? "Release to refresh" : "Pull to refresh"}</span>
      </div>

      <div className="appAmbient appAmbientOne" aria-hidden="true" />
      <div className="appAmbient appAmbientTwo" aria-hidden="true" />
      <div className="appGrid" aria-hidden="true" />

      <div className="appContent">
        <header className="appHeader">
          <BrandMark />
          <div className="appHeaderActions">
            <ThemeSwitch theme={theme} onToggle={toggleTheme} />
            <button
              className="mobileHeaderSignOut"
              type="button"
              onClick={logout}
              aria-label="Sign out"
            >
              <UiIcon name="logout" />
            </button>
            <div className="workspaceStatus workspaceStatusDesktop">
              <UiIcon name="users" className="groupStatusIcon" />
              <span>{groupId}</span>
            </div>
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
          <button
            className="statsDisclosure"
            type="button"
            onClick={() => setStatsExpanded((expanded) => !expanded)}
            aria-expanded={statsExpanded}
            aria-controls="workspace-stats"
          >
            <span><strong>Monthly summary</strong><small>{entries.length} rides · {members.length} members</small></span>
            <UiIcon name="chevronRight" />
          </button>
          <div id="workspace-stats" className={`statsCollapse${statsExpanded ? " isExpanded" : " isCollapsed"}`}>
            <div className="statsCollapseInner">
              <div className="dashboardStats" aria-label="Workspace summary">
                <div><strong>{entries.length}</strong><span>Trips this month</span></div>
                <div><strong>{members.length}</strong><span>Active members</span></div>
                <div><strong>{transfers.length}</strong><span>Settlements</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="appToolbar" aria-label="Calendar controls">
          <div className="monthNavigator">
            <button className="iconButton" type="button" onClick={prevMonth} disabled={monthTransition !== "none"} aria-label="Previous month">
              <UiIcon name="chevronLeft" />
            </button>
            <div className="monthTitle">
              <span>Viewing</span>
              <strong>{monthDisplay}</strong>
            </div>
            <button className="iconButton" type="button" onClick={nextMonth} disabled={monthTransition !== "none"} aria-label="Next month">
              <UiIcon name="chevronRight" />
            </button>
          </div>

          <div className="toolbarActions">
            <button className="appButton appButtonPrimary" type="button" onClick={() => {
              window.clearTimeout(memberCloseTimerRef.current);
              setMemberErr("");
              setMemberModalClosing(false);
              setMemberSaveState("idle");
              setMemberOpen(true);
            }}>
              <UiIcon name="userPlus" />
              <span>Add member</span>
            </button>
            <button className="appButton mobileRefreshAction" type="button" onClick={() => loadAll({ targetMonth: month, force: true })} disabled={loading}>
              <UiIcon name="refresh" className={loading ? "isSpinning" : ""} />
              <span>{loading ? "Refreshing" : "Refresh"}</span>
            </button>
            <button className="appButton appButtonQuiet mobileSignOutAction" type="button" onClick={logout}>
              <UiIcon name="logout" />
              <span>Sign out</span>
            </button>
          </div>
        </section>

        {err && <div className="appError" role="alert">{err}</div>}

        <section className="calendarPanel" aria-busy={loading}>
          <div className="calendarPanelHeader">
            <div><UiIcon name="calendar" /><strong>Weekday schedule</strong></div>
            <span>Select a day to add or edit a ride</span>
          </div>

          <div
            className={`calendarContainer${monthTransition !== "none" ? ` ${monthTransition}` : ""}${loading ? " isMonthLoading" : ""}`}
            style={{ touchAction: "pan-y" }}
            onPointerDown={handleSwipeStart}
            onPointerUp={handleSwipeEnd}
            onClickCapture={handleCalendarClick}
          >
          {loading && (
            <div className="calendarLoading" aria-hidden="true">
              <span /><span /><span />
            </div>
          )}
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
                          <UiIcon name="rideCar" className="calendarCarIcon" />
                          <span className="calendarDriverName">{nameById[e.driver_id] || e.driver_id}</span>
                        </div>
                        <div className="pcRiders">
                          <UiIcon name="users" />
                          {e.riders?.length || 0} riders
                        </div>
                      </div>

                      <div className="mobileSummary">
                        <div className="mobileDriver">
                          <UiIcon name="rideCar" className="calendarCarIcon" />
                          <span className="calendarDriverName">{nameById[e.driver_id] || e.driver_id}</span>
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
        <div className={`modalBackdrop${tripModalClosing ? " isClosing" : ""}`} onClick={closeTripModal}>
          <div className="modal tripModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalDragHandle" aria-hidden="true" />
            <div className="modalHeader">
              <div>
                <span className="sectionKicker">Ride details</span>
                <h2>{activeDay ? activeDay.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""}</h2>
              </div>
              <button className="iconButton modalClose" type="button" onClick={closeTripModal} aria-label="Close ride details">
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
                <button type="button" className={`appButton appButtonSmall actionStateButton${rateSaveState === "success" ? " isSuccess" : ""}`} onClick={onUpdateRates} disabled={rateSaveState !== "idle"}>
                  {rateSaveState === "saving" && <i className="actionSpinner" aria-hidden="true" />}
                  {rateSaveState === "success" && <UiIcon name="check" />}
                  {rateSaveState === "saving" ? "Saving…" : rateSaveState === "success" ? "Saved" : "Save rates"}
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
              <button type="button" className="appButton appButtonDanger" onClick={onClear} disabled={rideSaveState !== "idle"}>
                <UiIcon name="trash" />
                Clear day
              </button>
              <span className="modalFooterSpacer" />
              <button type="button" className="appButton" onClick={closeTripModal} disabled={rideSaveState === "saving"}>
                Cancel
              </button>
              <button type="button" className={`appButton appButtonPrimary actionStateButton${rideSaveState === "success" ? " isSuccess" : ""}`} onClick={onSave} disabled={rideSaveState !== "idle"}>
                {rideSaveState === "idle" && <UiIcon name="save" />}
                {rideSaveState === "saving" && <i className="actionSpinner" aria-hidden="true" />}
                {rideSaveState === "success" && <UiIcon name="check" />}
                {rideSaveState === "saving" ? "Saving…" : rideSaveState === "success" ? "Saved" : "Save ride"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {memberOpen && (
        <div className={`modalBackdrop${memberModalClosing ? " isClosing" : ""}`} onClick={closeMemberModal}>
          <div className="modal memberModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalDragHandle" aria-hidden="true" />
            <div className="modalHeader">
              <div><span className="sectionKicker">Add member</span></div>
              <button className="iconButton modalClose" type="button" onClick={closeMemberModal} aria-label="Close add member form"><UiIcon name="close" /></button>
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
              <button type="button" className="appButton" onClick={closeMemberModal} disabled={memberSaveState === "saving"}>
                Cancel
              </button>
              <button type="button" className={`appButton appButtonPrimary actionStateButton${memberSaveState === "success" ? " isSuccess" : ""}`} onClick={onCreateMember} disabled={memberSaveState !== "idle"}>
                {memberSaveState === "idle" && <UiIcon name="userPlus" />}
                {memberSaveState === "saving" && <i className="actionSpinner" aria-hidden="true" />}
                {memberSaveState === "success" && <UiIcon name="check" />}
                {memberSaveState === "saving" ? "Adding…" : memberSaveState === "success" ? "Added" : "Add member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
