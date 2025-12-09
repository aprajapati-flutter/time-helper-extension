chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg.remainingMs === "undefined") return;

  let ms = Number(msg.remainingMs) || 0;

  if (ms <= 0) {
    // 1. Badge
    chrome.action.setBadgeText({ text: "00:00" });
    chrome.action.setBadgeBackgroundColor({ color: "#888" });

    // 2. Play alarm
    const audio = new Audio(chrome.runtime.getURL("alarm.wav"));
    audio.play();

    // 3. Notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "logo.png",
      title: "Work Time Complete!",
      message: "Your required work hours are finished.",
      priority: 2
    });

    return; // stop here
  }

  // HH:MM badge
  const totalSeconds = Math.floor(ms / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const MAX_HOURS = 99;
  const shownHours = hh > MAX_HOURS ? MAX_HOURS : hh;

  const pad = (n) => String(n).padStart(2, "0");
  const badgeText = `${pad(shownHours)}:${pad(mm)}`;

  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: "#0a84ff" });
  chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
});