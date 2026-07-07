(function initializeQuietFeedPageHooks() {
  "use strict";

  const HOOK_SUFFIX = ".react|quiet-feed";
  const COUNTER_FLUSH_DELAY = 800;
  const RUNTIME_RETRY_DELAY = 250;
  const RUNTIME_WAIT_TIMEOUT = 12000;
  const EMPTY_SETTINGS = Object.freeze({});
  const GROUP_SUGGESTION_TYPES = new Set(["GroupsYouShouldJoinFeedUnit"]);

  let settings = EMPTY_SETTINGS;
  let React = null;
  let counterTimer = null;
  let installed = false;
  const runtimeWaitDeadline = Date.now() + RUNTIME_WAIT_TIMEOUT;
  const activeTargets = new Set();
  const revealedItemKeys = new Set();
  const pendingCounts = { reels: 0, suggested: 0, sponsored: 0 };
  const pendingLogEntries = [];

  window.addEventListener("message", receiveExtensionMessage);
  waitForFacebookRuntime();

  function receiveExtensionMessage(event) {
    if (event.source !== window || event.data?.source !== "quiet-feed-extension") return;
    if (event.data.type === "QFP_SETTINGS" && event.data.settings) {
      settings = { ...event.data.settings };
    }
  }

  function waitForFacebookRuntime() {
    if (installed) return;
    if (!window.requireLazy || !window.require || !window.___km || !window.___sf) {
      retryRuntimeWait();
      return;
    }

    try {
      window.requireLazy(["react", "__debug"], () => {
        const reactDomModule = findReactDomModule();
        if (!reactDomModule) {
          retryRuntimeWait();
          return;
        }
        window.require(reactDomModule);
        React = window.require("react");
        installHooks();
      });
    } catch {
      retryRuntimeWait();
    }
  }

  function retryRuntimeWait() {
    if (Date.now() >= runtimeWaitDeadline) return;
    setTimeout(waitForFacebookRuntime, RUNTIME_RETRY_DELAY);
  }

  function findReactDomModule() {
    try {
      const modules = window.require("__debug").modulesMap;
      return Object.keys(modules)
        .filter((name) => name.startsWith("ReactDOM"))
        .find((name) => {
          const module = modules[name];
          return Boolean(
            module.exports &&
              module.exports.version &&
              module.depPosition > 3 &&
              name.includes("classic"),
          );
        });
    } catch {
      return null;
    }
  }

  function installHooks() {
    if (installed || !React) return;
    installed = true;

    installPageStyle();

    installTarget("CometFeedUnitErrorBoundary", filterFeedUnit);
    installTarget("CometHomeRightRailUnit", (payload) =>
      React.createElement("div", { className: "qf-home-right-rail" }, payload.lastCmp),
    );
    installTarget("CometAdsSideFeedUnitItem", (payload) =>
      enabled("removeSponsored") ? React.createElement(HiddenSideAd) : payload.lastCmp,
    );
    installTarget("CometToasterRoot", (payload) =>
      enabled("removeNotifications") ? empty() : payload.lastCmp,
    );
    installTarget("CometHomeRightSideBirthdayReminders", (payload) =>
      enabled("removeBirthdays") ? empty() : payload.lastCmp,
    );
    installTarget("FBReelsRootWrapper", (payload) =>
      enabled("removeReels")
        ? removed(payload.lastCmp, "reels", "Removed reels")
        : payload.lastCmp,
    );
    installTarget("FBReelsTopOfFeedTrayTile", (payload) =>
      enabled("removeReels")
        ? removed(payload.lastCmp, "reels", "Removed reels")
        : payload.lastCmp,
    );
    installTarget("CometFeedStoryFBReelsAttachmentStyle", (payload) => {
      if (!enabled("removeReels") || enabled("allowFriendsReels")) return payload.lastCmp;
      return removed(payload.lastCmp, "reels", "Removed reels");
    });
    installTarget("FriendingCometPYMKGrid", filterPeopleSuggestion);
    installTarget("FriendingCometFeedPYMKHScroll", filterPeopleSuggestion);
    installTarget("FriendingCometPYMKPanel", filterPeopleSuggestion);
    installTarget("StoriesTrayRectangularRoot", (payload) =>
      enabled("removeStories") ? empty() : payload.lastCmp,
    );
    installTarget("CometMarketplaceAdCard", (payload) =>
      enabled("removeMarketplaceAds")
        ? removed(payload.lastCmp, "sponsored", "Removed Marketplace ad")
        : payload.lastCmp,
    );
    installTarget("SearchCometResultsAd", (payload) =>
      enabled("removeSearchAds")
        ? removed(payload.lastCmp, "sponsored", "Removed search ad")
        : payload.lastCmp,
    );

    window.postMessage({ source: "quiet-feed-page", type: "QFP_HOOK_READY" }, location.origin);
  }

  function installTarget(moduleName, transform) {
    window.___km(
      `${moduleName}${HOOK_SUFFIX}`,
      (payload) => {
        reportHookActivity(moduleName);
        return transform(payload);
      },
      { fallback: empty },
    );
  }

  function reportHookActivity(moduleName) {
    if (activeTargets.has(moduleName)) return;
    activeTargets.add(moduleName);
    window.postMessage(
      { source: "quiet-feed-page", type: "QFP_HOOK_ACTIVE", moduleName },
      location.origin,
    );
  }

  function filterPeopleSuggestion(payload) {
    return enabled("removePeopleSuggestions")
      ? removed(payload.lastCmp, "suggested", "Removed people suggestion")
      : payload.lastCmp;
  }

  function filterFeedUnit(payload) {
    if (location.pathname !== "/") return payload.lastCmp;

    const feedUnitId =
      get(payload.payload, "feedUnit.id") || get(payload.payload, "feedUnit.__id");
    const unitType = get(payload.payload, "unitTypename", "none");
    const isSponsored = Boolean(
      feedUnitId && relayField(feedUnitId, "^sponsored_data.ad_id"),
    );

    if (enabled("removeSponsored") && isSponsored) {
      return removed(payload.lastCmp, "sponsored", "Removed sponsored post", feedUnitId);
    }

    const canJoin = Boolean(
      feedUnitId && relayField(feedUnitId, "^to.viewer_forum_join_state") === "CAN_JOIN",
    );
    const canSubscribe = Boolean(
      feedUnitId && relayField(feedUnitId, "^^actors[0].subscribe_status") === "CAN_SUBSCRIBE",
    );

    if (
      enabled("removeGroupSuggestions") &&
      (GROUP_SUGGESTION_TYPES.has(unitType) || canJoin)
    ) {
      return removed(payload.lastCmp, "suggested", "Removed group suggestion", feedUnitId);
    }

    if (enabled("removeSuggested") && (canSubscribe || canJoin)) {
      return removed(payload.lastCmp, "suggested", "Removed suggested content", feedUnitId);
    }

    if (enabled("removeGroupSuggestions") && canSubscribe) {
      return removed(payload.lastCmp, "suggested", "Removed suggested content", feedUnitId);
    }

    const storyId =
      get(payload.payload, "feedUnit.__id") ||
      get(payload.payload, "children[0].props.children.props.feedUnit.__id");

    if (storyId) {
      const storyType = relayField(storyId, "showcase_story_type");
      if (enabled("removeReels") && storyType === "SHOWCASE_SHORT_VIDEO") {
        return removed(payload.lastCmp, "reels", "Removed reels", storyId);
      }

      const homepageSuggestion = relayField(
        storyId,
        "^story_header{$1}.^title.text",
        { $1: { location: "homepage_stream" } },
      );
      const groupSuggestion = relayField(
        storyId,
        "^story_header{$1}.^title.text",
        { $1: { location: "groups_tab" } },
      );
      if (enabled("removeSuggested") && (homepageSuggestion || groupSuggestion)) {
        return removed(payload.lastCmp, "suggested", "Removed suggested content", storyId);
      }
    }

    return React.createElement("div", { className: "CometFeedUnit" }, payload.lastCmp);
  }

  function removed(originalContent, category, label, itemKey) {
    return React.createElement(RemovedContent, { originalContent, category, label, itemKey });
  }

  function RemovedContent({ originalContent, category, label, itemKey }) {
    const [revealed, setRevealed] = React.useState(() => Boolean(itemKey && revealedItemKeys.has(itemKey)));
    React.useEffect(() => {
      incrementCounter(category, label);
    }, []);

    if (revealed) return originalContent;

    return React.createElement(
      React.Fragment,
      null,
      enabled("cleanMode")
        ? null
        : React.createElement(
            "div",
            { className: "qf-removed-placeholder" },
            React.createElement("span", null, label),
            React.createElement(
              "button",
              {
                type: "button",
                className: "qf-removed-btn",
                onClick: () => {
                  rememberRevealedItem(itemKey);
                  setRevealed(true);
                },
              },
              "Show this item",
            ),
          ),
      React.createElement(
        "div",
        { style: { position: "relative" } },
        React.createElement(
          "div",
          {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              zIndex: -1,
              width: 1,
              height: 1,
              maxWidth: 1,
              maxHeight: 1,
              overflow: "hidden",
              opacity: 0,
              pointerEvents: "none",
              userSelect: "none",
            },
          },
          originalContent,
        ),
      ),
    );
  }

  function rememberRevealedItem(itemKey) {
    if (!itemKey) return;
    revealedItemKeys.add(itemKey);
    if (revealedItemKeys.size > 500) {
      revealedItemKeys.delete(revealedItemKeys.values().next().value);
    }
  }

  function HiddenSideAd() {
    React.useEffect(() => {
      incrementCounter("sponsored");
    }, []);
    return React.createElement("div", { className: "qf-hidden-side-ad" });
  }

  function installPageStyle() {
    if (document.querySelector("#quiet-feed-page-hook-style")) return;
    const style = document.createElement("style");
    style.id = "quiet-feed-page-hook-style";
    style.textContent = [
      ".qf-home-right-rail:has(.qf-hidden-side-ad){display:none!important}",
      ".qf-removed-placeholder{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-radius:8px;margin:8px 0;color:#65676b;background:#fff;border:1px solid rgba(0,0,0,0.08);font:14px/1.34 'Segoe UI',system-ui,sans-serif}",
      "@media(prefers-color-scheme:dark){.qf-removed-placeholder{color:#b0b3b8;background:#242526;border-color:rgba(255,255,255,0.06)}}",
      ".qf-removed-btn{padding:6px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:20px;background:#f0f2f5;color:#050505;cursor:pointer;font:600 13px/1 'Segoe UI',system-ui,sans-serif;white-space:nowrap}",
      ".qf-removed-btn:hover{background:#e4e6eb}",
      "@media(prefers-color-scheme:dark){.qf-removed-btn{border-color:rgba(255,255,255,0.1);background:#3a3b3c;color:#e4e6eb}.qf-removed-btn:hover{background:#4e4f50}}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function incrementCounter(category, label) {
    if (!(category in pendingCounts)) return;
    pendingCounts[category] += 1;
    if (label) {
      pendingLogEntries.push({ ts: Date.now(), category, text: String(label).slice(0, 120) });
      if (pendingLogEntries.length > 50) pendingLogEntries.splice(0, pendingLogEntries.length - 50);
    }
    clearTimeout(counterTimer);
    counterTimer = setTimeout(flushCounters, COUNTER_FLUSH_DELAY);
  }

  function flushCounters() {
    const delta = { ...pendingCounts };
    const entries = pendingLogEntries.splice(0);
    pendingCounts.reels = 0;
    pendingCounts.suggested = 0;
    pendingCounts.sponsored = 0;
    window.postMessage(
      { source: "quiet-feed-page", type: "QFP_COUNTS", delta, entries },
      location.origin,
    );
  }

  function enabled(key) {
    return settings[key] === true;
  }

  function relayField(id, path, variables) {
    try {
      return window.___sf(id, path, variables);
    } catch {
      return undefined;
    }
  }

  function get(object, path, fallback) {
    const parts = path.replace(/\[(\d+)]/g, ".$1").split(".");
    let value = object;
    for (const part of parts) {
      if (value == null || !(part in Object(value))) return fallback;
      value = value[part];
    }
    return value === undefined ? fallback : value;
  }

  function empty() {
    return React ? React.createElement(React.Fragment, null) : null;
  }
})();
