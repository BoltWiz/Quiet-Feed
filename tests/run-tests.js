"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rules = require(path.join(root, "src", "filter-rules.js"));
const shared = require(path.join(root, "src", "shared", "features.js"));

let passed = 0;
const asynchronousTests = [];

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function asyncTest(name, callback) {
  asynchronousTests.push({ name, callback });
}

const defaults = {
  removeReels: true,
  allowFriendsReels: false,
  removeSponsored: true,
  removeSuggested: true,
  removeMarketplaceAds: true,
  removeSearchAds: true,
  removeGroupSuggestions: true,
  removePeopleSuggestions: true,
};

test("normalizes Vietnamese accents", () => {
  assert.equal(rules.normalizeText("Được tài trợ"), "đuoc tai tro");
});

test("classifies English sponsored posts", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "Brand name · Sponsored", pathname: "/", hasReelLink: false, reelLinkCount: 0 },
      defaults,
    ),
    "sponsored",
  );
});

test("classifies Vietnamese sponsored posts", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "Nhãn hàng · Được tài trợ", pathname: "/", hasReelLink: false, reelLinkCount: 0 },
      defaults,
    ),
    "sponsored",
  );
});

test("classifies suggested content", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "Suggested for you", pathname: "/", hasReelLink: false, reelLinkCount: 0 },
      defaults,
    ),
    "suggested",
  );
});

test("classifies people suggestions", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "People you may know", pathname: "/", hasReelLink: false, reelLinkCount: 0 },
      defaults,
    ),
    "suggested",
  );
});

test("classifies reel posts when friend reels are not allowed", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "A new video", pathname: "/", hasReelLink: true, reelLinkCount: 1 },
      defaults,
    ),
    "reels",
  );
});

test("keeps individual friend reels when allowed", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "A new video", pathname: "/", hasReelLink: true, reelLinkCount: 1 },
      { ...defaults, allowFriendsReels: true },
    ),
    null,
  );
});

test("keeps ordinary posts", () => {
  assert.equal(
    rules.classifyFeedUnit(
      { text: "A normal post from a friend", pathname: "/", hasReelLink: false, reelLinkCount: 0 },
      defaults,
    ),
    null,
  );
});

test("manifest references existing local resources", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const resources = [
    manifest.background.service_worker,
    manifest.options_page,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const resource of resources) {
    assert.equal(fs.existsSync(path.join(root, resource)), true, `Missing ${resource}`);
  }
  assert.equal("update_url" in manifest, false);
  assert.equal("externally_connectable" in manifest, false);
});

test("all client message types have background handlers", () => {
  const background = fs.readFileSync(path.join(root, "src", "background.js"), "utf8");
  const clients = [
    "src/content.js",
    "src/popup/popup.js",
    "src/options/options.js",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  const sent = new Set(
    clients.flatMap((source) => [...source.matchAll(/type:\s*["'](QF_[A-Z_]+)["']/g)].map((match) => match[1])),
  );
  const handled = new Set(
    [...background.matchAll(/case\s+["'](QF_[A-Z_]+)["']/g)].map((match) => match[1]),
  );
  for (const type of sent) assert.equal(handled.has(type), true, `No handler for ${type}`);
});

test("page hook and isolated bridge use matching contracts", () => {
  const pageHook = fs.readFileSync(path.join(root, "src", "page-hook.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
  for (const type of ["QFP_SETTINGS", "QFP_HOOK_READY", "QFP_HOOK_ACTIVE", "QFP_COUNTS"]) {
    assert.equal(pageHook.includes(type), true, `Page hook missing ${type}`);
    assert.equal(content.includes(type), true, `Content bridge missing ${type}`);
  }
});

test("DOM cleanup releases disconnected entries and their placeholders", () => {
  const connected = { isConnected: true };
  const disconnected = { isConnected: false };
  const removed = [];
  const entries = new Map([
    [connected, "keep"],
    [disconnected, "remove"],
  ]);

  assert.equal(shared.pruneDisconnectedEntries(entries, (value) => removed.push(value)), 1);
  assert.deepEqual([...entries.values()], ["keep"]);
  assert.deepEqual(removed, ["remove"]);
});

asyncTest("serialized mutations cannot overlap and recover after failures", async () => {
  const runSerially = shared.createSerialExecutor();
  const order = [];
  let active = 0;
  let maximumActive = 0;

  const first = runSerially(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("first:end");
    active -= 1;
  });
  const second = runSerially(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push("second");
    active -= 1;
  });

  await Promise.all([first, second]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
  await assert.rejects(runSerially(async () => Promise.reject(new Error("expected"))));
  assert.equal(await runSerially(async () => "recovered"), "recovered");
});

test("hook polling is bounded and fallback waits for real activity", () => {
  const pageHook = fs.readFileSync(path.join(root, "src", "page-hook.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
  assert.equal(pageHook.includes("RUNTIME_WAIT_TIMEOUT"), true);
  assert.equal(pageHook.includes("setTimeout(waitForFacebookRuntime"), true);
  assert.equal(pageHook.includes("requestAnimationFrame(waitForFacebookRuntime"), false);
  assert.equal(content.includes('event.data.type === "QFP_HOOK_ACTIVE"'), true);
  assert.equal(content.includes('event.data.type === "QFP_HOOK_READY"'), true);
});

test("setting changes require confirmation and offer an optional restart", () => {
  const popup = fs.readFileSync(path.join(root, "src", "popup", "popup.js"), "utf8");
  const popupHtml = fs.readFileSync(path.join(root, "src", "popup", "popup.html"), "utf8");
  const options = fs.readFileSync(path.join(root, "src", "options", "options.js"), "utf8");
  const suggested = shared.FEATURES.find((feature) => feature.key === "removeSuggested");
  assert.equal(suggested.confirmation.includes("large amount of content"), true);
  assert.equal(popup.includes("window.confirm(feature.confirmation)"), true);
  assert.equal(options.includes("window.confirm(feature.confirmation)"), true);
  assert.equal(options.includes("confirmSuggestedRemoval(importedSettings)"), true);
  assert.equal(popup.includes('type: "QF_RESTART_FACEBOOK"'), true);
  assert.equal(options.includes('type: "QF_RESTART_FACEBOOK"'), true);
  assert.equal(popupHtml.includes("Optional: Restart Facebook"), true);
  assert.equal(options.includes('type: "QF_IMPORT_STATE"'), true);
});

test("manifest loads primary hooks in MAIN world and fallback in isolation", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const proxy = manifest.content_scripts.find((entry) =>
    entry.js.includes("src/legacy/facebook-react-hook-runtime.js"),
  );
  const pageHook = manifest.content_scripts.find((entry) => entry.js.includes("src/page-hook.js"));
  const fallback = manifest.content_scripts.find((entry) => entry.js.includes("src/content.js"));
  assert.equal(proxy.world, "MAIN");
  assert.equal(proxy.run_at, "document_start");
  assert.equal(pageHook.world, "MAIN");
  assert.equal(pageHook.run_at, "document_end");
  assert.equal("world" in fallback, false);
});

test("legacy runtime and readable page hook share module targets", () => {
  const runtime = fs.readFileSync(
    path.join(root, "src", "legacy", "facebook-react-hook-runtime.js"),
    "utf8",
  );
  const pageHook = fs.readFileSync(path.join(root, "src", "page-hook.js"), "utf8");
  for (const [readableTarget, runtimeFragment] of [
    ["CometFeedUnitErrorBoundary", "FeedUnitErrorBoundary"],
    ["CometAdsSideFeedUnitItem", "AdsSideFeedUnitItem"],
    ["FBReelsRootWrapper", "FBReelsRootWrapper"],
    ["StoriesTrayRectangularRoot", "StoriesTrayRectangularRoot"],
    ["CometMarketplaceAdCard", "MarketplaceAdCard"],
    ["SearchCometResultsAd", "ResultsAd"],
  ]) {
    assert.equal(runtime.includes(runtimeFragment), true, `Runtime missing ${runtimeFragment}`);
    assert.equal(pageHook.includes(readableTarget), true, `Readable hook missing ${readableTarget}`);
  }
  assert.equal(runtime.includes(".react|quiet-feed"), true);
});

test("source contains no inherited product or store integration", () => {
  const files = walk(root).filter(
    (file) => file !== __filename && /\.(js|json|html|css|md)$/.test(file),
  );
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n").toLowerCase();
  assert.equal(source.includes("esuit.dev"), false);
  assert.equal(source.includes("clients2.google.com/service/update2/crx"), false);
  assert.equal(source.includes("remove-reels-for-facebook"), false);
});

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : target;
  });
}

async function runAsynchronousTests() {
  for (const { name, callback } of asynchronousTests) {
    try {
      await callback();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      throw error;
    }
  }
  console.log(`\n${passed} tests passed.`);
}

runAsynchronousTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
