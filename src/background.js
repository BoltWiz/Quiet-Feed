"use strict";

importScripts("shared/features.js");

const {
  STORAGE_KEYS,
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  mergeSettings,
  mergeStats,
  isFeatureKey,
  isFacebookUrl,
  createSerialExecutor,
} = QuietFeed;

const runStorageMutation = createSerialExecutor();

function ensureStorage() {
  return runStorageMutation(async () => {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.settings,
      STORAGE_KEYS.stats,
      STORAGE_KEYS.schema,
    ]);

    const settings = mergeSettings(stored[STORAGE_KEYS.settings]);
    const stats = mergeStats(stored[STORAGE_KEYS.stats]);

    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: settings,
      [STORAGE_KEYS.stats]: stats,
      [STORAGE_KEYS.schema]: SCHEMA_VERSION,
    });

    await updateBadge(stats);
    return { settings, stats };
  });
}

async function getState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.stats,
  ]);
  return {
    settings: mergeSettings(stored[STORAGE_KEYS.settings]),
    stats: mergeStats(stored[STORAGE_KEYS.stats]),
  };
}

function setFeature(key, value) {
  if (!isFeatureKey(key) || typeof value !== "boolean") {
    return Promise.reject(new Error("Invalid feature update"));
  }
  return runStorageMutation(async () => {
    const { settings } = await getState();
    settings[key] = value;
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    return settings;
  });
}

function incrementStats(delta) {
  return runStorageMutation(async () => {
    const { stats } = await getState();
    for (const key of Object.keys(DEFAULT_STATS)) {
      const increment = Number(delta?.[key]);
      if (Number.isFinite(increment) && increment > 0) {
        stats[key] += Math.min(Math.floor(increment), 1000);
      }
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    return stats;
  });
}

function resetStats() {
  return runStorageMutation(async () => {
    const stats = { ...DEFAULT_STATS };
    await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
    return stats;
  });
}

function resetSettings() {
  return runStorageMutation(async () => {
    const settings = { ...DEFAULT_SETTINGS };
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    return settings;
  });
}

function importState(value) {
  return runStorageMutation(async () => {
    const settings = mergeSettings(value?.settings);
    const stats = mergeStats(value?.stats);
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: settings,
      [STORAGE_KEYS.stats]: stats,
    });
    return { settings, stats };
  });
}

async function updateBadge(stats) {
  const total = Object.values(stats).reduce((sum, value) => sum + value, 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#0099ff" });
  await chrome.action.setBadgeText({ text: total > 0 ? compactNumber(total) : "" });
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${Math.floor(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.floor(value / 100) / 10}k`;
  return String(value);
}

async function restartFacebookTabs() {
  const tabs = await chrome.tabs.query({
    url: ["https://www.facebook.com/*", "https://web.facebook.com/*"],
  });
  const tabIds = tabs.map((tab) => tab.id).filter(Number.isInteger);
  if (tabIds.length === 0) {
    return { restarted: false, reason: "Open Facebook in a tab first." };
  }
  await Promise.all(tabIds.map((tabId) => chrome.tabs.reload(tabId)));
  return { restarted: true, count: tabIds.length };
}

chrome.runtime.onInstalled.addListener(() => {
  ensureStorage().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  ensureStorage().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.stats]) return;
  updateBadge(mergeStats(changes[STORAGE_KEYS.stats].newValue)).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = handleMessage(message, sender);
  task.then(sendResponse).catch((error) => {
    console.error("Quiet Feed message failed", error);
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "QF_GET_STATE":
      return { ok: true, ...(await getState()) };
    case "QF_SET_FEATURE":
      return { ok: true, settings: await setFeature(message.key, message.value) };
    case "QF_INCREMENT_STATS":
      if (!sender.tab || !isFacebookUrl(sender.tab.url || "")) {
        throw new Error("Counter updates are accepted only from Facebook tabs.");
      }
      return { ok: true, stats: await incrementStats(message.delta) };
    case "QF_RESET_STATS":
      return { ok: true, stats: await resetStats() };
    case "QF_RESET_SETTINGS":
      return { ok: true, settings: await resetSettings() };
    case "QF_IMPORT_STATE":
      return { ok: true, ...(await importState(message.value)) };
    case "QF_RESTART_FACEBOOK":
      return { ok: true, ...(await restartFacebookTabs()) };
    case "QF_OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      throw new Error("Unknown Quiet Feed message");
  }
}

ensureStorage().catch(console.error);
