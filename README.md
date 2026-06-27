# Quiet Feed 2.1

Quiet Feed is a readable, no-build Manifest V3 browser extension. It filters distracting Facebook feed content with a DOM classifier and stores settings and counters locally.

## Architecture

- `src/shared/features.js` — single source of truth for features, defaults, storage keys, and validation.
- `src/filter-rules.js` — pure text and context classifier; independently testable.
- `src/legacy/facebook-react-hook-runtime.js` — isolated Facebook module interception compatibility layer.
- `src/page-hook.js` — readable React transformations based on the original engine's exact module targets.
- `src/content.js` — settings/counter bridge and delayed DOM fallback when React hooks are unavailable.
- `src/background.js` — storage migration, settings API, statistics, badge, refresh, and options routing.
- `src/popup/` — compact popup built with plain HTML/CSS/JavaScript.
- `src/options/` — full settings, live counters, backup/import, and reset controls.
- `tests/run-tests.js` — classifier, message-contract, manifest, and resource tests.

There are no compiled application bundles, Ant Design styles, Web Store metadata, external account systems, pricing links, or CSP modifications. The isolated compatibility shim is retained because Facebook hides ad metadata inside private React/Relay modules; all filter behavior around it is readable.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Open Facebook and refresh the page once.

## Test

Run:

```powershell
node tests/run-tests.js
```

The extension has no package dependencies and no build step.

## Filtering notes

The React hook engine is primary. If Facebook changes its private modules and the hook cannot initialize, the extension automatically activates the DOM classifier in `src/filter-rules.js` and `src/content.js` after four seconds.

Default filters remove reels, sponsored posts, Marketplace ads, and search ads. All other filters start off. Enabling suggested-content removal requires confirmation because it can hide a large part of the News Feed. Non-clean mode leaves a placeholder with a one-item undo action.
