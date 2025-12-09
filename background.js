// background.js - listens for remainingMs messages and updates badge (HH:MM)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg.remainingMs === "undefined") return;

  let ms = msg.remainingMs;
  if (!ms || ms <= 0) {
    chrome.action.setBadgeText({ text: "00:00" });
    chrome.action.setBadgeBackgroundColor({ color: "#888888" });
    return;
  }

  // convert to HH:MM (hours may exceed 2 digits but we pad to at least 2)
  const totalMinutes = Math.ceil(ms / 60000);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  const badge = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;

  // set badge (Chrome trims if too long; this matches your requested HH:MM)
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color: "#0a84ff" });
});