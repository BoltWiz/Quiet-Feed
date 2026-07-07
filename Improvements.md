# Quiet Feed — Potential Improvements

> Generated 2026-07-07. Review periodically; not all items need to exist.

---

## 1. Core Filtering & Detection

### 1.1 Custom Keyword / Regex Filter Builder
- Let users add their own phrase lists via popup/options.
- Store in `chrome.storage.local` under `customRules`; merge at runtime.
- Low effort, high value for power users.

### 1.2 Whitelist / "Always Show" Profiles / Pages
- User marks a profile/page to never filter.
- Persist post IDs or profile URLs; check before hiding.
- Complements existing "Show this item" (temporary) with permanence.

### 1.3 Filter by Post Age
- Option to hide posts older than N days ( Facebook surfaces stale content sometimes).
- Requires reading post timestamp metadata if available in feed unit payload.

### 1.4 Seasonal / Time-Based Filters
- Holiday mode: temporarily reduce birthday/wish posts during event seasons.
- Work-hours mode: stricter distraction filtering during configured hours.

### 1.5 Image / Media Detection
- Option to hide posts containing only images/videos (text-only feed mode).
- Requires checking attachment types in React payload or DOM.
- ponytail: O(n) scan per feed unit; defer unless requested.

### 1.6 Group Post Filtering by Engagement
- Hide posts with below-threshold likes/comments from non-friends.
- Requires reading engagement counts from React payload.

### 1.7 Cross-Feature Dependency Improvements
- `allowFriendsReels` currently only affects reels via React hook; DOM fallback ignores it entirely.
- DOM fallback should respect `allowFriendsReels` when reel link count == 1.

---

## 2. User Experience

### 2.1 Keyboard Shortcuts
- `Alt+Q` (or configurable) to open popup.
- `Alt+Shift+Q` to toggle Clean Mode on/off instantly.
- Use `chrome.commands` API in manifest.

### 2.2 Undo / "Show Again" Across Sessions
- Currently `revealedItemKeys` is in-memory only (page hook + DOM fallback each have their own).
- Persist to `chrome.storage.session` (or `local` with LRU) so undo survives refresh.
- Warning: storage quota ~5MB; keep ceiling (currently 500 keys) or switch to bloom filter.

### 2.3 Per-Tab Filter Status Indicator
- Badge color changes based on active filter mode (advanced = blue, fallback = orange, off = gray).
- Better than static count badge.

### 2.4 Filtered-Item Log / History
- Popup tab showing last N filtered items with reason and undo link.
- Stored in `chrome.storage.local` with max 100 entries, FIFO eviction.

### 2.5 Onboarding for First-Time Users
- First install: show a one-time tutorial overlay on facebook.com.
- Explain Clean Mode vs Placeholder, where to find settings.

### 2.6 "Temporarily Disable All Filters" Button
- One-click pause (e.g., 5 min, 30 min, until next reload).
- Useful when user actually wants to see suggested/sponsored content briefly.

### 2.7 Bulk Toggle Improvements
- Current category actions (Enable all / Disable all / Defaults) affect only active tab.
- Add "Enable all across all tabs" or global reset.

### 2.8 Tooltip / Help Text Enhancements
- Info icons currently just show description.
- Add live preview / screenshot of what each filter does (link to docs images).

---

## 3. Performance

### 3.1 DOM Fallback: IntersectionObserver for Lazy Scanning
- Currently `MutationObserver` with 220ms debounce scans all added nodes.
- Use `IntersectionObserver` to only scan feed units entering viewport.
- Significant CPU savings on long-scroll Facebook sessions.

### 3.2 React Hook: Batch Component Updates
- `incrementCounter` flushes every 800ms; consider 500ms for snappier badge updates.
- Batch `window.postMessage` calls from page hook.

### 3.3 Storage Write Batching
- `chrome.storage.local.set` called per-feature change; batch multiple toggles.
- popup/options batching already uses `QF_SET_FEATURES`, but background still writes per-message.

### 3.4 DOM Fallback: Reduce Selector Complexity
- `FEED_UNIT_SELECTOR` has 3 broad patterns; Facebook changes data-pagelet often.
- Cache last-known-good selector per session; fall back to broader only if 0 hits in first 2s.

### 3.5 Reduce Memory Pressure from WeakSet/Map
- `countedElements` WeakSet grows unbounded for long sessions.
- `hiddenElements` Map is pruned, but periodic full-prune could run on slower cadence (e.g., every 60s).

---

## 4. Robustness & Error Handling

### 4.1 Facebook Runtime Detection Timeout UX
- `RUNTIME_WAIT_TIMEOUT` is 12s with no user feedback.
- If hooks fail to install, surface a toast on facebook.com: "Quiet Feed running in fallback mode."`
- Could inject a subtle indicator into the page (respecting user's clean mode preference).

### 4.2 Graceful Degradation When `___km` / `___sf` Break
- Facebook updates can break the internal APIs without breaking the page.
- Currently falls back to DOM fallback after 4s silently.
- Add periodic (e.g., once per minute) health check: if no hooks active for 30s, trigger DOM fallback.

### 4.3 Selector Resilience Monitoring
- Track which selectors successfully match in DOM fallback.
- If match rate drops to zero for 10s, log diagnostic to console (or background) for debugging.

### 4.4 Safe JSON Import
- Import currently validates shape but not malicious keys.
- Sanitize imported keys against `FEATURES` keys only; reject unexpected top-level properties.

### 4.5 Manifest v3 Service Worker Lifecycle Handling
- `chrome.runtime.onMessage` listener is synchronous, but `handleMessage` is async.
- Ensure service worker stays alive during long operations (already handled by `return true` in listener, but verify).

### 4.6 Rate-Limit Counter Updates
- `incrementStats` caps per-update at 1000, but rapid DOM fallback + React hook could double-count.
- Consider deduplication by itemKey before counting (tracked by `countedElements` in content.js, but not in page-hook.js).

---

## 5. Accessibility (a11y)

### 5.1 Focus Management in Options Page
- Feature rows are not keyboard-navigable as a group.
- Add `tabindex` and arrow-key navigation for switch toggles.

### 5.2 Screen Reader Announcements
- Filter health updates should use `aria-live="polite"` region, not just static text update.
- Reload alert should be announced.

### 5.3 Reduced Motion Respect
- Inject style respects `prefers-reduced-motion` for any future transitions.
- Currently no animations, but adding them later should gate on media query.

### 5.4 High Contrast Mode Support
- Current colors use low-contrast grays (#141414, #292929).
- Add `forced-colors: active` media query overrides or use system color keywords.

---

## 6. Internationalization (i18n)

### 6.1 Extract All UI Strings
- Currently all labels, descriptions, confirmations are hardcoded in English in `FEATURES` array.
- Move to `_locales/en/messages.json`; use `chrome.i18n.getMessage()`.
- Also localize `PHRASES` for additional languages beyond the 6 currently supported.

### 6.2 RTL Layout Support
- Popup and options CSS does not account for RTL languages (Arabic, Hebrew).
- Add `dir="auto"` and test `margin-left` vs `margin-inline-start`.

### 6.3 Locale-Aware Date/Number Formatting
- Stats counters already use `toLocaleString()`; good.
- Badge compact number should respect locale conventions.

---

## 7. Developer Experience

### 7.1 Debug / Diagnostic Mode
- Add `debugMode` feature flag (hidden, set via console: `chrome.storage.local.set({quietFeedDebug: true})`).
- When enabled: log every filtered item with reason, show overlay badges on hidden items, highlight matched DOM nodes.
- Invaluable for troubleshooting Facebook changes.

### 7.2 Structured Logging
- Replace ad-hoc `console.error` / `console.debug` with a tiny logger that includes timestamps and component names.
- Enable filtering by module (background/content/page-hook/popup/options).

### 7.3 Automated Visual Regression Testing
- Current browser tests only cover popup interactions.
- Capture screenshots of facebook.com feed before/after filtering with mock HTML structures.
- Could use Puppeteer/Playwright, but that introduces a dependency; keep optional.

### 7.4 CI/CD for Extension Packaging
- GitHub Actions workflow: lint, test, pack into `.zip` for Chrome Web Store upload.
- Validate `manifest.json` against schema.

---

## 8. New Feature Ideas

### 8.1 Feed Analytics Dashboard
- Weekly / monthly stats: how many minutes estimated saved by filtering.
- Based on average time per post type (heuristic: 3s for reels, 5s for sponsored).

### 8.2 Focus Mode Timer
- Pomodoro-style: block all distractions for 25 min, then auto-allow for 5 min.
- Integrate with `removeNotifications` and `removeStories`.

### 8.3 Export Filtered-Item Report
- Generate a weekly digest: "You blocked 142 reels, 89 sponsored posts, 12 suggestions."
- Display in options page or as a browser notification.

### 8.4 Sync Across Devices (Optional)
- Use `chrome.storage.sync` instead of `chrome.storage.local` for settings (not stats).
- Must handle quota limits (102,400 bytes sync vs 10MB local).
- Fallback to local if sync fails.

### 8.5 Machine Learning Label Classification (Experimental)
- Train a tiny model on post text/structure to classify sponsored/suggested content more robustly than phrase matching.
- Overkill for current scope, but note for future if Facebook obfuscates labels further.

---

## 9. Code Quality & Architecture

### 9.1 Extract Shared UI Components
- `createFeatureRow` is duplicated between `popup.js` and `options.js`.
- Extract to `src/shared/ui-components.js` — but this is a zero-build project; include as `<script>`.

### 9.2 Feature Schema Versioning
- `SCHEMA_VERSION` (1) exists but is not used for migrations.
- If features are ever renamed/removed, implement a migration path.

### 9.3 Unit Test Coverage Gaps
- No tests for `page-hook.js` logic (requires mocking Facebook's `window.require` / `___km`).
- No tests for `popup.js` / `options.js` DOM interactions.
- No tests for `background.js` message handler routing.

### 9.4 Type Safety
- JSDoc types for core functions (`classifyFeedUnit`, `mergeSettings`, etc.) would improve IDE autocomplete and catch bugs.
- Zero-build means no TypeScript, but `// @ts-check` with JSDoc is free.

### 9.5 Linting
- No ESLint config in repo. Add minimal `.eslintrc.json` with `eslint:recommended` + browser globals.
- Catches common bugs (e.g., accidentally using `var`, missing `use strict`).

---

## 10. Platform Expansion

### 10.1 Support Instagram Reels (Separate Permission)
- Similar architecture (React-based), but different module names and selectors.
- Would require separate content scripts and host permissions.

### 10.2 Support Facebook Mobile Web (m.facebook.com)
- Different DOM structure, mostly server-rendered.
- Lower priority; most users use desktop web.

---

## Quick Wins (Do First)

1. **Custom keyword filter builder** — high user value, low code.
2. **Keyboard shortcuts** — simple manifest addition.
3. **Debug mode** — one hidden feature flag, huge support benefit.
4. **Persist reveal list across reloads** — move `revealedItemKeys` to `chrome.storage.session`.
5. **i18n extraction** — mechanical refactor, unlocks non-English markets.
6. **Shared `createFeatureRow`** — deduplicate popup.js/options.js.
