(function startQuietFeedContentScript() {
  "use strict";

  const { STORAGE_KEYS, mergeSettings, pruneDisconnectedEntries } = QuietFeed;
  const { PHRASES, includesPhrase, classifyFeedUnit, matchesCustomRules } = QuietFeedRules;

  const FEED_UNIT_SELECTOR = [
    'div[role="article"]',
    '[data-pagelet^="FeedUnit"]',
    '[data-pagelet*="FeedUnit"]',
  ].join(",");
  const STORIES_SELECTOR = '[aria-label="Stories"], [aria-label="Tin"], [data-pagelet*="Stories"]';
  const RIGHT_RAIL_SELECTOR = '[data-pagelet*="RightRail"], [role="complementary"]';
  const NOTIFICATION_SELECTOR =
    '[role="status"], [data-pagelet*="Toast"], [data-visualcompletion="ignore-dynamic"] [role="alert"]';

  const hiddenElements = new Map();
  const countedElements = new WeakSet();
  const revealedItemKeys = new Set();
  const pendingScanRoots = new Set();
  const pendingCounts = { reels: 0, suggested: 0, sponsored: 0 };
  let settings = null;
  let customRules = [];
  let scanTimer = null;
  let countTimer = null;
  let fallbackTimer = null;
  let observer = null;
  let hookActive = false;
  let fallbackActive = false;
  let debugMode = false;
  let pausedUntil = 0;

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
    const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, "quietFeedDebug", "quietFeedCustomRules", "quietFeedPausedUntil"]);
    settings = mergeSettings(stored[STORAGE_KEYS.settings]);
    debugMode = stored.quietFeedDebug === true;
    customRules = Array.isArray(stored.quietFeedCustomRules) ? stored.quietFeedCustomRules : [];
    pausedUntil = Number(stored.quietFeedPausedUntil) || 0;
    loadRevealedKeys();
    postSettingsToPage();
    fallbackTimer = setTimeout(startDomFallback, 4000);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[STORAGE_KEYS.settings]) {
        settings = mergeSettings(changes[STORAGE_KEYS.settings].newValue);
        postSettingsToPage();
      }
      if (changes.quietFeedCustomRules) {
        customRules = Array.isArray(changes.quietFeedCustomRules.newValue) ? changes.quietFeedCustomRules.newValue : [];
      }
      if (changes.quietFeedPausedUntil) {
        pausedUntil = Number(changes.quietFeedPausedUntil.newValue) || 0;
      }
      if ((changes[STORAGE_KEYS.settings] || changes.quietFeedCustomRules || changes.quietFeedPausedUntil) && fallbackActive) {
        restoreAll();
        scheduleFullScan();
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
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-label", "data-pagelet"],
      characterData: true,
    });
    console.info("Quiet Feed: Facebook hooks unavailable; using DOM fallback filters.");
  }

  function stopDomFallback() {
    if (!fallbackActive) return;
    fallbackActive = false;
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    pendingScanRoots.clear();
    restoreAll();
  }

  function handleMutations(records) {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) pendingScanRoots.add(node);
      });
      if (record.type === "attributes" && record.target instanceof HTMLElement) {
        pendingScanRoots.add(record.target);
      }
      if (record.type === "characterData" && record.target.parentElement) {
        pendingScanRoots.add(record.target.parentElement);
      }
    });
    if (pendingScanRoots.size === 0) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPendingNodes, 220);
  }

  function scheduleFullScan() {
    pendingScanRoots.clear();
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanDocument, 220);
  }

  function scanDocument() {
    if (!fallbackActive || !settings || !document.body) return;
    pruneDisconnectedEntries(hiddenElements, (placeholder) => placeholder?.remove());
    scanRoot(document);
  }

  function scanPendingNodes() {
    if (!fallbackActive || !settings || !document.body) return;
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    pruneDisconnectedEntries(hiddenElements, (placeholder) => placeholder?.remove());
    roots.filter((root) => root.isConnected).forEach(scanRoot);
  }

  function scanRoot(root) {
    if (pausedUntil && Date.now() < pausedUntil) return;
    selectWithin(root, FEED_UNIT_SELECTOR).forEach(processFeedUnit);
    processStories(root);
    processRightRail(root);
    processNotifications(root);
  }

  function selectWithin(root, selector) {
    const matches = root instanceof Element && root.matches(selector) ? [root] : [];
    return matches.concat(Array.from(root.querySelectorAll?.(selector) || []));
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

    const itemKey = getItemKey(element);
    if (itemKey && revealedItemKeys.has(itemKey)) {
      element.dataset.qfAllowed = "true";
      return;
    }
    const links = Array.from(element.querySelectorAll('a[href*="/reel/"]'));
    const text = element.innerText || element.textContent || "";
    const category = classifyFeedUnit(
      {
        text,
        pathname: location.pathname,
        hasReelLink: links.length > 0,
        reelLinkCount: links.length,
      },
      settings,
    );

    if (category) { hideElement(element, category); return; }
    if (matchesCustomRules(text, customRules)) { hideElement(element, "custom"); }
  }

  function processStories(root) {
    if (!settings.removeStories) return;
    selectWithin(root, STORIES_SELECTOR).forEach((element) => {
      const container = findStableContainer(element);
      hideElement(container, null);
    });
  }

  function processRightRail(root) {
    if (!settings.removeBirthdays) return;
    const rails = new Set(selectWithin(root, RIGHT_RAIL_SELECTOR));
    const ancestorRail = root instanceof Element ? root.closest(RIGHT_RAIL_SELECTOR) : null;
    if (ancestorRail) rails.add(ancestorRail);
    rails.forEach((rail) => {
      rail.querySelectorAll('div[role="article"], div[aria-label]').forEach((card) => {
        const text = card.innerText || card.textContent || "";
        if (includesPhrase(text, PHRASES.birthdays)) {
          hideElement(findStableContainer(card), null);
        }
      });
    });
  }

  function processNotifications(root) {
    if (!settings.removeNotifications) return;
    selectWithin(root, NOTIFICATION_SELECTOR).forEach((element) =>
      hideElement(findStableContainer(element), null),
    );
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
    if (debugMode) {
      console.debug("[QuietFeed]", category || "other", element.innerText?.slice(0, 80), element);
    }

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
      rememberRevealedItem(getItemKey(element));
      element.dataset.qfAllowed = "true";
      element.classList.remove("qf-hidden");
      element.removeAttribute("data-qf-filtered");
      hiddenElements.delete(element);
      placeholder.remove();
    });
    placeholder.append(message, showButton);
    return placeholder;
  }

  function getItemKey(element) {
    const link = element.querySelector(
      'a[href*="/posts/"], a[href*="story_fbid="], a[href*="/reel/"], a[href*="/videos/"]',
    );
    if (link?.href) {
      try {
        const url = new URL(link.href, location.href);
        const storyId = url.searchParams.get("story_fbid");
        return storyId ? `story:${storyId}` : `${url.hostname}${url.pathname}`;
      } catch {
        // Fall through to a stable pagelet when Facebook provides one.
      }
    }
    const pagelet = element.getAttribute("data-pagelet");
    return /^FeedUnit_\d{5,}$/.test(pagelet || "") ? `pagelet:${pagelet}` : null;
  }

  function rememberRevealedItem(itemKey) {
    if (!itemKey) return;
    revealedItemKeys.add(itemKey);
    if (revealedItemKeys.size > 500) {
      revealedItemKeys.delete(revealedItemKeys.values().next().value);
    }
    persistRevealedKeys();
  }

  function persistRevealedKeys() {
    chrome.storage.session
      .set({ quietFeedRevealed: [...revealedItemKeys] })
      .catch(() => {});
  }

  function loadRevealedKeys() {
    chrome.storage.session.get("quietFeedRevealed").then((stored) => {
      const keys = stored?.quietFeedRevealed;
      if (Array.isArray(keys)) {
        keys.slice(-500).forEach((k) => revealedItemKeys.add(k));
      }
    }).catch(() => {});
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
      ".qf-placeholder{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0;padding:10px 14px;border-radius:8px;color:#65676b;background:#fff;border:1px solid rgba(0,0,0,0.08);font:14px/1.34 'Segoe UI',system-ui,sans-serif}",
      "@media(prefers-color-scheme:dark){.qf-placeholder{color:#b0b3b8;background:#242526;border-color:rgba(255,255,255,0.06)}}",
      ".qf-show-button{padding:6px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:20px;background:#f0f2f5;color:#050505;cursor:pointer;font:600 13px/1 'Segoe UI',system-ui,sans-serif;white-space:nowrap;transition:background 100ms ease}",
      ".qf-show-button:hover{background:#e4e6eb}",
      "@media(prefers-color-scheme:dark){.qf-show-button{border-color:rgba(255,255,255,0.1);background:#3a3b3c;color:#e4e6eb}.qf-show-button:hover{background:#4e4f50}}",
      ".qf-show-button:focus-visible{outline:2px solid #1877f2;outline-offset:2px}",
      "@media(prefers-color-scheme:dark){.qf-show-button:focus-visible{outline-color:#2374e1}}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }
})();
