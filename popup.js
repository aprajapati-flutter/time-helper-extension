// Settings
const REQUIRED_MINUTES = 8 * 60 + 30; // 8:30 -> 510 minutes
const BREAK_MINUTES = 60; // 1 hour fixed

// ---------- Helpers ----------
function safeText(s){ return (s||"").trim(); }

function parseTimeStringToDate(timeStr) {
  // Accepts e.g. "9:53:11 am", "02:00:00 pm", "2:00 pm", "1:10:15 pm"
  if (!timeStr) return null;
  let s = timeStr.trim();
  if (s === "-" || s.length === 0) return null;

  // normalize
  const parts = s.split(/\s+/);
  if (parts.length < 2) {
    const t = parts[0];
    const comps = t.split(":").map(Number);
    if (comps.length >= 2) {
      let hh = comps[0]||0, mm = comps[1]||0, ss = comps[2]||0;
      let d = new Date(); d.setHours(hh, mm, ss, 0); return d;
    }
    return null;
  }

  let timePart = parts[0];
  let mer = parts[1].toUpperCase();

  let comps = timePart.split(":").map(x => parseInt(x,10) || 0);
  let hh = comps[0]||0, mm = comps[1]||0, ss = comps[2]||0;

  if (mer === "PM" && hh !== 12) hh += 12;
  if (mer === "AM" && hh === 12) hh = 0;

  let d = new Date();
  d.setHours(hh, mm, ss, 0);
  return d;
}

function format12WithSec(d) {
  if (!d) return "--:--:-- --";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}
function format12NoSec(d) {
  if (!d) return "--:-- --";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function msToHms(ms) {
  if (ms < 0) ms = 0;
  let sec = Math.floor(ms / 1000);
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = sec % 60;
  return [h,m,s].map(n => String(n).padStart(2,"0")).join(":");
}

function msToHM_roundedUpMinutes(ms) {
  if (ms < 0) ms = 0;
  let totalMinutes = Math.ceil(ms / 60000); // round up minutes
  let h = Math.floor(totalMinutes / 60);
  let m = totalMinutes % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// ---------- Read punches from the HRMS page ----------
async function readPunchRowsFromPage() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let res = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // rows assumed in <tbody><tr> ... columns: 0:Location, 1:In Time, 2:Out Time, 3:Presence
      const rows = Array.from(document.querySelectorAll("tbody tr"));
      return rows.map(r => {
        const tds = Array.from(r.querySelectorAll("td")).map(td => td.innerText.trim());
        return {
          in: tds[1] || "",
          out: tds[2] || ""
        };
      });
    }
  });
  return (res && res[0] && res[0].result) || [];
}

// ---------- Core calculation & UI update ----------
async function computeAndUpdate() {
  try {
    const rawRows = await readPunchRowsFromPage();

    // Build sessions array { inDate, outDate|null }
    const sessions = rawRows.map(r => {
      return {
        inDate: parseTimeStringToDate(r.in),
        outDate: (r.out && r.out !== "-" && r.out.trim() !== "") ? parseTimeStringToDate(r.out) : null
      };
    }).filter(s => s.inDate); // drop invalid

    // sort by inDate
    sessions.sort((a,b) => a.inDate - b.inDate);

    // completed presence (sum of in->out for sessions with outDate)
    let completedPresenceMs = 0;
    for (const s of sessions) {
      if (s.outDate) {
        completedPresenceMs += (s.outDate - s.inDate);
      }
    }

    // breaks: gaps between out and next in
    let breakUsedMs = 0;
    for (let i = 0; i < sessions.length - 1; i++) {
      const cur = sessions[i];
      const nxt = sessions[i+1];
      if (cur.outDate && nxt.inDate) {
        const gap = nxt.inDate - cur.outDate;
        if (gap > 0) breakUsedMs += gap;
      }
    }

    // find current open session (last session with outDate == null)
    let currentSession = null;
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (!sessions[i].outDate) { currentSession = sessions[i]; break; }
    }

    const now = new Date();

    let elapsedCurrentMs = 0;
    if (currentSession) {
      elapsedCurrentMs = now - currentSession.inDate;
      if (elapsedCurrentMs < 0) elapsedCurrentMs = 0;
    }

    // completedBeforeCurrentMs: sum of sessions that are fully closed before currentSession
    let completedBeforeCurrentMs = 0;
    for (const s of sessions) {
      if (s === currentSession) break;
      if (s.outDate) completedBeforeCurrentMs += (s.outDate - s.inDate);
    }

    const requiredPresenceMs = REQUIRED_MINUTES * 60 * 1000;
    // remaining presence from now (taking into account elapsed in current)
    let totalPresenceSoFarIncludingNow = completedBeforeCurrentMs + (currentSession ? elapsedCurrentMs : 0);
    let remainingPresenceFromNowMs = requiredPresenceMs - totalPresenceSoFarIncludingNow;
    if (remainingPresenceFromNowMs < 0) remainingPresenceFromNowMs = 0;

    // Estimated checkout:
    let estimatedCheckout = null;
    if (currentSession) {
      let remainingForCheckoutMs = requiredPresenceMs - completedBeforeCurrentMs;
      if (remainingForCheckoutMs < 0) remainingForCheckoutMs = 0;
      estimatedCheckout = new Date(currentSession.inDate.getTime() + remainingForCheckoutMs);
    } else {
      estimatedCheckout = new Date(now.getTime() + remainingPresenceFromNowMs);
    }

    // Break remaining from fixed 1 hour rule
    const breakRequiredMs = BREAK_MINUTES * 60 * 1000;
    let breakRemainingMs = breakRequiredMs - breakUsedMs;
    if (breakRemainingMs < 0) breakRemainingMs = 0;

    // UI strings
    const checkInTimeStr = currentSession ? format12WithSec(currentSession.inDate) : (sessions.length ? format12WithSec(sessions[sessions.length-1].inDate) : "--:--:-- --");
    const totalInTimeMs = completedBeforeCurrentMs + (currentSession ? elapsedCurrentMs : 0);
    const totalInTimeStr = msToHms(totalInTimeMs);
    const checkoutStr = format12WithSec(estimatedCheckout);

    // === CHANGED: show full HH:MM:SS remaining in UI (updates every second) ===
    const remainingHMS = msToHms(remainingPresenceFromNowMs);

    const breakUsedStr = msToHms(breakUsedMs);
    const breakRemainingStr = msToHms(breakRemainingMs);

    // Update DOM
    document.getElementById("dayEndAt").innerText = checkoutStr;
    document.getElementById("checkInTime").innerText = checkInTimeStr;
    document.getElementById("totalInTime").innerText = totalInTimeStr;
    document.getElementById("checkoutTime").innerText = checkoutStr;
    document.getElementById("remainingTime").innerText = remainingHMS; // HH:MM:SS now
    document.getElementById("breakUsed").innerText = breakUsedStr;
    document.getElementById("breakRemaining").innerText = breakRemainingStr;

    // Update badge via background (badge should be HH:MM)
    chrome.runtime.sendMessage({ remainingMs: remainingPresenceFromNowMs });

  } catch (err) {
    console.error("computeAndUpdate error:", err);
  }
}

// Start ticking
computeAndUpdate();
setInterval(computeAndUpdate, 1000);