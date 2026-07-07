**Plan: Quiet Feed Extension -- Improvements Implementation**

---

**1. Project Summary (from CLAUDE.md)**

- Zero-build, dependency-free Manifest V3 Chrome extension targeting facebook.com / web.facebook.com
- Dual filtering: React hook engine (primary, world MAIN) with DOM MutationObserver fallback (isolated world)
- Service worker serializes all storage writes; message-based API between content scripts, popup, and options
- Feature schema lives in `src/shared/features.js`; all feature keys must exist there
- UI: plain HTML/CSS/JS popup and options page, no frameworks
- Test harness: Node-based unit tests + in-browser popup smoke tests
- Key constraints: no build step, no new dependencies, feature keys centralized, QFP_ message contract

---

**2. All Proposed Improvements (Grouped by Category)**

**Category A -- Core Filtering (Section 1)**

| ID | Improvement | Effort |
|----|-------------|--------|
| 1.1 | Custom keyword/regex filter builder | Low |
| 1.2 | Whitelist "always show" profiles/pages | Medium |
| 1.3 | Filter by post age | Medium |
| 1.4 | Seasonal / time-based filters | Medium |
| 1.5 | Image/media-only post detection | High |
| 1.6 | Group posts by engagement threshold | High |
| 1.7 | DOM fallback respects `allowFriendsReels` | Low |

**Category B -- User Experience (Section 2)**

| ID | Improvement |
|----|-------------|
| 2.1 | Keyboard shortcuts via `chrome.commands` |
| 2.2 | Persist undo/reveal list across sessions |
| 2.3 | Per-tab badge color by filter mode |
| 2.4 | Filtered-item log/history |
| 2.5 | Onboarding overlay for new installs |
| 2.6 | Temporary "disable all" button with timer |
| 2.7 | Global bulk toggle (across all tabs) |
| 2.8 | Tooltip help enhancements |

**Category C -- Performance (Section 3)**

| ID | Improvement |
|----|-------------|
| 3.1 | IntersectionObserver for lazy DOM scanning |
| 3.2 | Reduce counter flush interval to 500ms |
| 3.3 | Batch storage writes in background.js |
| 3.4 | Cache last-known-good DOM selector |
| 3.5 | Periodic full-prune of WeakSet/Map |

**Category D -- Robustness (Section 4)**

| ID | Improvement |
|----|-------------|
| 4.1 | User-visible toast when falling back to DOM mode |
| 4.2 | Periodic health check for hook engine |
| 4.3 | Selector-resilience monitoring |
| 4.4 | Stricter JSON import sanitization |
| 4.5 | Service worker lifecycle verification |
| 4.6 | Deduplication of counter updates |

**Category E -- Accessibility (Section 5)**

| ID | Improvement |
|----|-------------|
| 5.1 | Keyboard navigation for feature rows |
| 5.2 | `aria-live` announcements |
| 5.3 | `prefers-reduced-motion` gate |
| 5.4 | High-contrast / forced-colors support |

**Category F -- Internationalization (Section 6)**

| ID | Improvement |
|----|-------------|
| 6.1 | Extract strings to `_locales/` + `chrome.i18n` |
| 6.2 | RTL layout support |
| 6.3 | Locale-aware badge formatting |

**Category G -- Developer Experience (Section 7)**

| ID | Improvement |
|----|-------------|
| 7.1 | Debug/diagnostic mode flag |
| 7.2 | Structured logging |
| 7.3 | Automated visual regression tests |
| 7.4 | CI/CD packaging workflow |

**Category H -- New Features (Section 8)**

| ID | Improvement |
|----|-------------|
| 8.1 | Feed analytics dashboard |
| 8.2 | Focus mode / Pomodoro timer |
| 8.3 | Export weekly filtered-item report |
| 8.4 | Chrome sync for settings |
| 8.5 | ML label classification (experimental) |

**Category I -- Code Quality (Section 9)**

| ID | Improvement |
|----|-------------|
| 9.1 | Extract shared `createFeatureRow` |
| 9.2 | Schema version migration logic |
| 9.3 | Test coverage for page-hook, popup, options, background |
| 9.4 | JSDoc + `@ts-check` type annotations |
| 9.5 | ESLint config |

**Category J -- Platform (Section 10)**

| ID | Improvement |
|----|-------------|
| 10.1 | Instagram Reels support |
| 10.2 | m.facebook.com support |

---

**3. Key Dependencies Between Improvements**

- **9.1 (shared UI component)** should come before 2.4, 2.5, 2.6, 2.8 -- any UI additions benefit from deduplication first
- **6.1 (i18n extraction)** must precede 6.2 and 6.3 -- RTL and locale formatting only make sense with extracted strings
- **9.2 (schema versioning)** should precede 1.1, 1.2, 1.4, 2.2 -- any new storage keys or settings renames need a migration path
- **7.1 (debug mode)** should precede 4.1, 4.2, 4.3 -- robustness improvements are easier to validate with diagnostic logging
- **7.2 (structured logging)** pairs naturally with 7.1
- **2.2 (persist reveal list)** is a prerequisite for 2.4 (filtered-item log) -- both touch the same persistence layer
- **3.1 (IntersectionObserver)** and 3.4 (selector caching) are independent of each other but both live in `content.js`; implement sequentially to avoid merge conflicts
- **1.7 (allowFriendsReels in fallback)** has no blockers and fixes an existing inconsistency -- do early
- **9.5 (ESLint)** should come before large refactors to catch regressions automatically
- **8.4 (chrome.storage.sync)** depends on 9.2 (schema versioning) because sync has strict size limits and needs controlled key sets

---

**4. Conflicts and Risks**

| Risk | Details |
|------|---------|
| Zero-build constraint vs i18n | 6.1 requires `chrome.i18n.getMessage()` calls everywhere; this is compatible with zero-build but is a large mechanical rewrite that touches every UI file |
| IntersectionObserver (3.1) vs existing MutationObserver | These serve different purposes (visibility vs DOM mutation); must coexist, not replace. Risk of missing items that enter DOM but never scroll into view (e.g., above-fold feed units) |
| Custom rules storage (1.1) vs `mergeSettings` | Current `mergeSettings` only accepts booleans keyed by `FEATURES`. Custom rules need a separate storage key and merge function -- must not pollute the existing settings schema |
| Debug mode (7.1) adding a hidden feature | CLAUDE.md says all feature keys go in `FEATURES`. A hidden debug flag breaks this pattern. Resolve by storing it in a separate storage key (`quietFeedDebug`) outside the features system |
| chrome.storage.sync (8.4) vs current `chrome.storage.local` usage | Requires rewriting all storage calls to route through an abstraction layer, which is a significant refactor |
| ML classification (8.5) | Incompatible with zero-build/zero-dependency unless using a pre-built WASM blob or calling an external API. Flag as future-only |
| Platform expansion (10.x) | Requires new host_permissions, new content scripts, and likely separate filter-rules -- significant manifest changes and testing surface |

---

**5. Proposed Execution Order**

**Phase 1 -- Foundation and Quick Wins (do first, minimal risk)**

1. **9.5** Add ESLint config (catches bugs in all subsequent changes)
2. **9.4** Add JSDoc `@ts-check` to core files (features.js, filter-rules.js, background.js)
3. **1.7** Fix `allowFriendsReels` gap in DOM fallback (small bugfix, improves consistency)
4. **9.1** Extract `createFeatureRow` to `src/shared/ui-components.js`
5. **7.1** Add debug mode under separate storage key
6. **7.2** Structured logging (tiny logger wrapping `console.*`)
7. **2.1** Keyboard shortcuts (manifest `commands` addition, one handler in background.js)

**Phase 2 -- Storage and Schema (enables future features)**

8. **9.2** Implement schema migration path (version 1 to 2 upgrade logic)
9. **2.2** Persist `revealedItemKeys` in `chrome.storage.session`
10. **4.4** Stricter JSON import sanitization

**Phase 3 -- Core Filtering Enhancements**

11. **1.1** Custom keyword/regex filter builder (new storage key `customRules`, UI in options, runtime merge in filter-rules.js and page-hook.js)
12. **1.2** Whitelist profiles/pages (new storage key, check before hide in both engines)
13. **2.6** "Temporarily disable all" with timer

**Phase 4 -- Performance and Robustness**

14. **3.1** IntersectionObserver for DOM fallback
15. **3.3** Batch storage writes in background.js
16. **3.5** Periodic prune of hiddenElements Map
17. **4.1** Toast notification when in fallback mode
18. **4.2** Periodic hook-engine health check
19. **4.6** Counter deduplication

**Phase 5 -- Accessibility and UX Polish**

20. **5.1** Keyboard navigation for feature toggles
21. **5.2** `aria-live` regions for dynamic updates
22. **5.4** High-contrast mode support
23. **2.3** Badge color by filter mode
24. **2.4** Filtered-item log/history

**Phase 6 -- Internationalization**

25. **6.1** Extract all strings to `_locales/`
26. **6.2** RTL layout support
27. **6.3** Locale-aware badge numbers

**Phase 7 -- Tests and CI**

28. **9.3** Add unit tests for background.js, popup.js, page-hook.js
29. **7.4** CI/CD GitHub Actions for lint + test + zip
30. **7.3** Optional visual regression tests (Puppeteer, dev-only)

**Phase 8 -- Advanced Features (lower priority)**

31. **1.3** Filter by post age
32. **1.4** Seasonal/time-based filters
33. **2.5** Onboarding overlay
34. **8.1** Feed analytics dashboard
35. **8.3** Weekly report export
36. **8.4** chrome.storage.sync settings

**Phase 9 -- Experimental / Future (defer)**

37. **1.5** Image/media detection
38. **1.6** Group engagement threshold
39. **8.2** Focus mode timer
40. **8.5** ML classification
41. **10.1** Instagram Reels
42. **10.2** m.facebook.com

---

**6. Ambiguities and Missing Information**

- **1.1 (Custom rules):** Where should custom rules apply -- DOM fallback only, or also React hook engine? React hook receives structured component types, not raw text. Need decision on scope.
- **1.2 (Whitelist):** How is a profile identified in the React payload? The Improvements doc says "post IDs or profile URLs" but the current React hook intercepts by component type, not by author metadata. Feasibility depends on what data is accessible at hook time.
- **1.3 (Post age):** No confirmation that timestamp metadata is reliably available in either the React payload or the DOM. Needs research spike.
- **2.5 (Onboarding):** What permissions are needed to inject content into facebook.com on first install? Current content scripts already run there, so this is doable, but the trigger mechanism (detecting first install) needs `chrome.runtime.onInstalled` in background.js.
- **3.1 (IntersectionObserver):** Above-the-fold feed units are visible immediately. Must still MutationObserver for initial DOM inserts, then hand off to IntersectionObserver for units below fold. Hybrid approach not yet specified.
- **4.5 (Service worker lifecycle):** "Verify" is vague. Needs a concrete test: what long-running operations currently exist and do they exceed the 5-minute idle limit?
- **8.4 (Sync):** Which settings sync and which stay local? Stats obviously stay local, but what about custom rules (1.1) and whitelist (1.2) which could be large?
- **9.1 (Shared UI):** How to load the extracted script -- via manifest content_scripts (not applicable to popup/options) or via `<script src>` in both popup.html and options.html? The latter is the answer (already how features.js is shared in UI pages) but worth confirming.

---

**Overall Approach**

Start with foundational improvements (linting, types, shared components, debug tooling) that de-risk all later work. Then unlock the storage/schema layer so new features have a safe migration path. Deliver high-user-value items (custom filters, keyboard shortcuts, persistent undo) in the middle phases. Leave expensive or speculative items (ML, platform expansion) at the end where they can be dropped without blocking the rest.

Each phase is independently shippable -- completing Phase 1-3 alone delivers the "Quick Wins" list from the Improvements doc plus the scaffolding that makes everything after it safer.