(function startQuietFeedContentScript() {
  "use strict";

  const { STORAGE_KEYS, mergeSettings, pruneDisconnectedEntries } = QuietFeed;
  const { PHRASES, includesPhrase, classifyFeedUnit } = QuietFeedRules;

  const FEED_UNIT_SELECTOR = [
    'div[role="article"]',
    '[data-pagelet^="FeedUnit"]',
    '[data-pagelet*="FeedUnit"]',
  ].join(",");

  const hiddenElements = new Map();
  const countedElements = new WeakSet();
  const pendingCounts = { reels: 0, suggested: 0, sponsored: 0 };
  let settings = null;
  let scanTimer = null;
  let countTimer = null;
  let fallbackTimer = null;
  let observer = null;
  let hookActive = false;
  let fallbackActive = false;

  injectStyle();
  window.addEventListener("message", receivePageMessage);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "QF_GET_FILTER_STATUS") return false;
    sendResponse({
      status: hookActive ? "advanced" : fallbackActive ? "fallback" : "waiting",
    });
    return false;
  });
  initialize().catch((error) => console.error("Quiet Feed failed to start", error));

  async function initialize() {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
    settings = mergeSettings(stored[STORAGE_KEYS.settings]);
    postSettingsToPage();
    fallbackTimer = setTimeout(startDomFallback, 4000);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.settings]) return;
      settings = mergeSettings(changes[STORAGE_KEYS.settings].newValue);
      postSettingsToPage();
      if (fallbackActive) {
        restoreAll();
        scheduleScan();
      }
    });
  }

  function receivePageMessage(event) {
    if (event.source !== window || event.data?.source !== "quiet-feed-page") return;

    if (event.data.type === "QFP_HOOK_READY") {
      postSettingsToPage();
      return;
    }

    if (event.data.type === "QFP_HOOK_ACTIVE") {
      hookActive = true;
      clearTimeout(fallbackTimer);
      stopDomFallback();
      return;
    }

    if (event.data.type === "QFP_COUNTS") {
      const delta = sanitizeDelta(event.data.delta);
      if (Object.values(delta).some(Boolean)) {
        chrome.runtime
          .sendMessage({ type: "QF_INCREMENT_STATS", delta })
          .catch((error) => console.debug("Quiet Feed counter bridge failed", error));
      }
    }
  }

  function postSettingsToPage() {
    if (!settings) return;
    window.postMessage(
      { source: "quiet-feed-extension", type: "QFP_SETTINGS", settings },
      location.origin,
    );
  }

  function sanitizeDelta(value) {
    return Object.fromEntries(
      Object.keys(pendingCounts).map((key) => {
        const count = Number(value?.[key]);
        return [key, Number.isFinite(count) && count > 0 ? Math.floor(count) : 0];
      }),
    );
  }

  function startDomFallback() {
    if (hookActive || fallbackActive) return;
    fallbackActive = true;
    scanDocument();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    console.info("Quiet Feed: Facebook hooks unavailable; using DOM fallback filters.");
  }

  function stopDomFallback() {
    if (!fallbackActive) return;
    fallbackActive = false;
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    restoreAll();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanDocument, 220);
  }

  function scanDocument() {
    if (!fallbackActive || !settings || !document.body) return;
    pruneDisconnectedEntries(hiddenElements, (placeholder) => placeholder?.remove());
    document.querySelectorAll(FEED_UNIT_SELECTOR).forEach(processFeedUnit);
    processStories();
    processRightRail();
    processNotifications();
  }

  function processFeedUnit(element) {
    if (
      !(element instanceof HTMLElement) ||
      element.dataset.qfAllowed === "true" ||
      element.closest("[data-qf-placeholder]") ||
      element.closest(".qf-hidden") ||
      element.querySelector(":scope .qf-hidden")
    ) {
      return;
    }

    const links = Array.from(element.querySelectorAll('a[href*="/reel/"]'));
    const category = classifyFeedUnit(
      {
        text: element.innerText || element.textContent || "",
        pathname: location.pathname,
        hasReelLink: links.length > 0,
        reelLinkCount: links.length,
      },
      settings,
    );

    if (category) hideElement(element, category);
  }

  function processStories() {
    if (!settings.removeStories) return;
    const selectors = [
      '[aria-label="Stories"]',
      '[aria-label="Tin"]',
      '[data-pagelet*="Stories"]',
    ];
    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      const container = findStableContainer(element);
      hideElement(container, null);
    });
  }

  function processRightRail() {
    const rail = document.querySelector('[data-pagelet*="RightRail"], [role="complementary"]');
    if (!rail) return;
    const cards = rail.querySelectorAll('div[role="article"], div[aria-label]');
    cards.forEach((card) => {
      const text = card.innerText || card.textContent || "";
      if (settings.removeBirthdays && includesPhrase(text, PHRASES.birthdays)) {
        hideElement(findStableContainer(card), null);
      }
    });
  }

  function processNotifications() {
    if (!settings.removeNotifications) return;
    document
      .querySelectorAll('[role="status"], [data-pagelet*="Toast"], [data-visualcompletion="ignore-dynamic"] [role="alert"]')
      .forEach((element) => hideElement(findStableContainer(element), null));
  }

  function findStableContainer(element) {
    return (
      element.closest('[role="article"]') ||
      element.closest('[data-pagelet]') ||
      element.parentElement ||
      element
    );
  }

  function hideElement(element, category) {
    if (
      !(element instanceof HTMLElement) ||
      element.dataset.qfAllowed === "true" ||
      hiddenElements.has(element)
    ) {
      return;
    }
    const placeholder = settings.cleanMode ? null : createPlaceholder(category, element);
    hiddenElements.set(element, placeholder);
    if (placeholder) element.insertAdjacentElement("afterend", placeholder);
    element.classList.add("qf-hidden");
    element.setAttribute("data-qf-filtered", category || "other");

    if (category && !countedElements.has(element)) {
      countedElements.add(element);
      pendingCounts[category] += 1;
      scheduleCountFlush();
    }
  }

  function restoreAll() {
    hiddenElements.forEach((placeholder, element) => {
      placeholder?.remove();
      if (!element.isConnected) return;
      element.classList.remove("qf-hidden");
      element.removeAttribute("data-qf-filtered");
    });
    hiddenElements.clear();
  }

  function createPlaceholder(category, element) {
    const placeholder = document.createElement("div");
    placeholder.className = "qf-placeholder";
    placeholder.setAttribute("data-qf-placeholder", "true");
    const message = document.createElement("span");
    message.textContent = `Quiet Feed removed a ${category || "distracting"} item.`;
    const showButton = document.createElement("button");
    showButton.type = "button";
    showButton.className = "qf-show-button";
    showButton.textContent = "Show this item";
    showButton.addEventListener("click", () => {
      element.dataset.qfAllowed = "true";
      element.classList.remove("qf-hidden");
      element.removeAttribute("data-qf-filtered");
      hiddenElements.delete(element);
      placeholder.remove();
    });
    placeholder.append(message, showButton);
    return placeholder;
  }

  function scheduleCountFlush() {
    clearTimeout(countTimer);
    countTimer = setTimeout(flushCounts, 800);
  }

  async function flushCounts() {
    const delta = { ...pendingCounts };
    pendingCounts.reels = 0;
    pendingCounts.suggested = 0;
    pendingCounts.sponsored = 0;
    if (!Object.values(delta).some(Boolean)) return;
    try {
      await chrome.runtime.sendMessage({ type: "QF_INCREMENT_STATS", delta });
    } catch (error) {
      console.debug("Quiet Feed counter update was deferred", error);
      for (const key of Object.keys(pendingCounts)) pendingCounts[key] += delta[key];
      scheduleCountFlush();
    }
  }

  function injectStyle() {
    const style = document.createElement("style");
    style.id = "quiet-feed-style";
    style.textContent = [
      ".qf-hidden{display:none!important}",
      ".qf-placeholder{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0;padding:12px 16px;border:1px solid rgba(255,255,255,.1);border-radius:12px;color:#999;background:#141414;font:13px/1.3 system-ui,sans-serif}",
      ".qf-show-button{padding:7px 11px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:#292929;color:#fff;cursor:pointer;font:600 12px/1 system-ui,sans-serif;white-space:nowrap}",
      ".qf-show-button:hover{background:#363636}",
      ".qf-show-button:focus-visible{outline:2px solid #0099ff;outline-offset:2px}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }
})();
