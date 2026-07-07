# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development

This is a **zero-build, dependency-free** Manifest V3 browser extension. Source files in `src/` are loaded directly by Chrome. Node.js is only needed to run tests and a local preview server.

- Run the test suite: `npm test` (or `node tests/run-tests.js`)
- Run the browser smoke test: `node tests/browser/popup-test-server.js`, then open `http://127.0.0.1:4173/src/popup/popup-test.html`
- Preview the UI with mock data: `node tests/browser/popup-test-server.js`, then open `http://127.0.0.1:4173/preview/popup.html` or `http://127.0.0.1:4173/preview/options.html`
- To install the extension for testing: Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the repository folder.

## Architecture Overview

### Security Model: Two Content Worlds

There are two content scripts running at different times in different Chrome extension execution worlds:

1. **`src/legacy/facebook-react-hook-runtime.js`** — Runs at `document_start` in `world: "MAIN"`. This minified script initializes the `___km` and `___sf` APIs that the extension uses to intercept and transform React components inside Facebook's own JavaScript bundle.
2. **`src/page-hook.js`** — Runs at `document_end` in `world: "MAIN"`. Waits for Facebook's `window.require` and `window.___km` to be available, then registers `installTarget()` hooks for known Facebook React module names (e.g. `CometFeedUnitErrorBoundary`, `FBReelsRootWrapper`).
3. **`src/content.js`** — Runs in the isolated extension content script world (the default). Provides the DOM-based fallback when the advanced React hook engine is unavailable, and relays messages between the page world and the service worker.

### Dual Filtering Strategy

- **React hook engine** (primary): Intercepts known Facebook module types before they render, using `window.___km` to proxy component definitions. Only available inside `world: "MAIN"`.
- **DOM fallback**: MutationObserver-based classifier that runs in the isolated content script world. Activates after a 4-second timeout if the hook engine hasn't signaled readiness. Queries for feed units by selector, then calls `QuietFeedRules.classifyFeedUnit()` to categorize content by text patterns.

The two engines do not compete for the same content. Once `content.js` receives `QFP_HOOK_ACTIVE`, it stops the fallback entirely.

### Extension Services

**Background service worker (`src/background.js`)** — Serializes all storage mutations with a `createSerialExecutor()` queue to avoid overlapping writes. Exposes a message-based API for state management, stat counters, and tab relaods.

Key message types (`QF_GET_STATE`, `QF_SET_FEATURE`, `QF_SET_FEATURES`, `QF_INCREMENT_STATS`, `QF_RESET_STATS`, `QF_RESET_SETTINGS`, `QF_IMPORT_STATE`, `QF_GET_FILTER_HEALTH`, `QF_RELOAD_FACEBOOK_TABS`, `QF_OPEN_OPTIONS`):
- Must have a handler in `background.js`.
- Sent from `content.js`, `popup.js`, or `options.js`.
- Counter updates (`QF_INCREMENT_STATS`) are verified to only originate from Facebook tabs.

**Shared features module (`src/shared/features.js`)** — Single source of truth for the `FEATURES` array, `DEFAULT_SETTINGS`, `DEFAULT_STATS`, and merge/normalize utilities. Shared via `globalThis.QuietFeed` in the browser, and `module.exports` under Node for tests.

**Filter rules (`src/filter-rules.js`)** — Pure functions for DOM fallback classification. Normalizes text (including diacritics), then matches against `PHRASES` for sponsored, suggested, reels, stories, groups, people, and birthdays. Shared via `globalThis.QuietFeedRules` in the browser, and `module.exports` under Node for tests.

### Data Flow

- **Settings and stats** live in `chrome.storage.local`. The background worker guards them with `mergeSettings()`/`mergeStats()` to ensure defaults and schema safety.
- **Counters** are accumulated in `pendingCounts` by both the page hook and the DOM fallback, then flushed every 800ms via `QFP_COUNTS` page messages, then aggregated in the service worker.
- **Undo / show-item** works against a bounded `revealedItemKeys` set (max 500), which is local only and not persisted.

### UI Surfaces

- **`src/popup/popup.js`** — Toolbar popup with two category tabs (`feed`/`distractions`), batch enable/disable/reset actions, confirmation dialogs for risky features, filter health polling, and an optional tab reload prompt.
- **`src/options/options.js`** — Full settings page with the same feature grid plus import/export, stats reset, and counters display.
- Both surfaces store the active tab (`quietFeedPopupTab`) in `chrome.storage.local` and rerender when `chrome.storage.onChanged` fires.

## Important Conventions

- **No frameworks or builds**: All UI is plain HTML, CSS, and vanilla JavaScript.
- **Feature keys must be in `FEATURES`**: If you add or rename a feature, update `src/shared/features.js`; do not scatter feature keys elsewhere.
- **Module name pairing**: When Facebook changes a component, update both `src/page-hook.js` (readable target name) and `src/legacy/facebook-react-hook-runtime.js` (minified registration fragment). The test suite verifies these pairs stay in sync.
- **Message contract**: Page hook and `content.js` communicate via `window.postMessage` using the `QFP_` prefix (`QFP_SETTINGS`, `QFP_HOOK_READY`, `QFP_HOOK_ACTIVE`, `QFP_COUNTS`). Ensure both files use the same event types.
- **DOM fallback selectors**: `FEED_UNIT_SELECTOR`, `STORIES_SELECTOR`, `RIGHT_RAIL_SELECTOR`, and `NOTIFICATION_SELECTOR` in `content.js` are brittle against Facebook UI changes. Treat them as the first diagnostic when the fallback misfilters.
- **Text classification phrases**: `PHRASES` in `src/filter-rules.js` supports multiple languages. Add new phrases for new Facebook label variants rather than relying on heuristics alone.

## Key Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest, world/run_at timing, permissions |
| `src/shared/features.js` | Feature schema, defaults, merge utilities |
| `src/filter-rules.js` | Text-based content classification logic |
| `src/background.js` | Service worker, storage serialization, message handlers |
| `src/page-hook.js` | React component hooks in `world: "MAIN"` |
| `src/content.js` | Isolated bridge, DOM fallback observer |
| `src/legacy/facebook-react-hook-runtime.js` | Minified runtime for `___km`/`___sf` APIs |
| `src/popup/popup.js` | Toolbar popup UI logic |
| `src/options/options.js` | Options page UI logic |
| `tests/run-tests.js` | Node test suite |
| `tests/browser/popup-test-server.js` | Local server for browser smoke tests |
| `tests/browser/popup-test-runner.js` | In-browser harness for popup tests |
