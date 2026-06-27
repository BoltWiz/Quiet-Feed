(function initializeOptions() {
  "use strict";

  const {
    FEATURES,
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    mergeSettings,
    mergeStats,
  } = QuietFeed;

  let settings = null;
  let toastTimer = null;

  document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  document.querySelector("#reset-stats").addEventListener("click", resetStats);
  document.querySelector("#reset-settings").addEventListener("click", resetSettings);
  document.querySelector("#export-settings").addEventListener("click", exportSettings);
  document.querySelector("#import-settings").addEventListener("change", importSettings);
  document.querySelector("#restart-facebook").addEventListener("click", restartFacebook);

  loadState().catch(showError);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[STORAGE_KEYS.stats]) renderStats(changes[STORAGE_KEYS.stats].newValue);
    if (changes[STORAGE_KEYS.settings]) {
      settings = mergeSettings(changes[STORAGE_KEYS.settings].newValue);
      renderFeatures();
    }
  });

  async function loadState() {
    const response = await chrome.runtime.sendMessage({ type: "QF_GET_STATE" });
    if (!response?.ok) throw new Error(response?.error || "Could not load settings");
    settings = mergeSettings(response.settings);
    renderStats(response.stats);
    renderFeatures();
  }

  function renderStats(value) {
    const stats = mergeStats(value);
    for (const key of Object.keys(stats)) {
      document.querySelector(`#stat-${key}`).textContent = stats[key].toLocaleString();
    }
  }

  function renderFeatures() {
    renderFeatureGroup("#feed-features", ["feed", "behavior"]);
    renderFeatureGroup("#distraction-features", ["distractions"]);
  }

  function renderFeatureGroup(selector, groups) {
    document.querySelector(selector).replaceChildren(
      ...FEATURES.filter((feature) => groups.includes(feature.group)).map(createFeatureRow),
    );
  }

  function createFeatureRow(feature) {
    const disabled = feature.dependsOn && !settings[feature.dependsOn];
    const row = document.createElement("div");
    row.className = "feature-row";
    row.setAttribute("aria-disabled", String(Boolean(disabled)));

    const copy = document.createElement("div");
    copy.className = "feature-copy";
    const label = document.createElement("label");
    label.className = "feature-label";
    label.htmlFor = `feature-${feature.key}`;
    label.textContent = feature.label;
    const description = document.createElement("p");
    description.className = "feature-description";
    description.textContent = feature.description;
    copy.append(label, description);

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    const input = document.createElement("input");
    input.id = `feature-${feature.key}`;
    input.type = "checkbox";
    input.checked = settings[feature.key];
    input.disabled = Boolean(disabled);
    input.setAttribute("aria-label", feature.label);
    input.addEventListener("change", () => updateFeature(feature.key, input.checked));
    const track = document.createElement("span");
    track.className = "switch__track";
    track.setAttribute("aria-hidden", "true");
    switchLabel.append(input, track);
    row.append(copy, switchLabel);
    return row;
  }

  async function updateFeature(key, value) {
    const feature = FEATURES.find((item) => item.key === key);
    if (value && feature?.confirmation && !window.confirm(feature.confirmation)) {
      renderFeatures();
      return;
    }

    const response = await chrome.runtime.sendMessage({ type: "QF_SET_FEATURE", key, value });
    if (!response?.ok) {
      renderFeatures();
      return showError(new Error(response?.error || "Could not save setting"));
    }
    settings = mergeSettings(response.settings);
    renderFeatures();
    showRestartPrompt();
    showToast("Setting saved.");
  }

  async function resetStats() {
    const response = await chrome.runtime.sendMessage({ type: "QF_RESET_STATS" });
    if (!response?.ok) return showError(new Error(response?.error || "Could not reset counters"));
    renderStats(response.stats);
    showToast("Counters reset.");
  }

  async function resetSettings() {
    if (!confirmSuggestedRemoval(DEFAULT_SETTINGS)) return;
    const response = await chrome.runtime.sendMessage({ type: "QF_RESET_SETTINGS" });
    if (!response?.ok) return showError(new Error(response?.error || "Could not restore defaults"));
    settings = mergeSettings(response.settings || DEFAULT_SETTINGS);
    renderFeatures();
    showRestartPrompt();
    showToast("Default settings restored.");
  }

  async function exportSettings() {
    const response = await chrome.runtime.sendMessage({ type: "QF_GET_STATE" });
    if (!response?.ok) return showError(new Error(response?.error || "Could not export settings"));
    const payload = JSON.stringify(
      { version: 1, settings: response.settings, stats: response.stats },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "quiet-feed-settings.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Settings exported.");
  }

  async function importSettings(event) {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const importedSettings = mergeSettings(payload.settings);
      const importedStats = mergeStats(payload.stats);
      if (!confirmSuggestedRemoval(importedSettings)) return;
      const response = await chrome.runtime.sendMessage({
        type: "QF_IMPORT_STATE",
        value: { settings: importedSettings, stats: importedStats },
      });
      if (!response?.ok) throw new Error(response?.error || "Could not import settings");
      showRestartPrompt();
      showToast("Settings imported.");
    } catch {
      showError(new Error("That file is not a valid Quiet Feed backup."));
    }
  }

  function confirmSuggestedRemoval(nextSettings) {
    if (settings?.removeSuggested || !nextSettings.removeSuggested) return true;
    const feature = FEATURES.find((item) => item.key === "removeSuggested");
    return !feature?.confirmation || window.confirm(feature.confirmation);
  }

  function showRestartPrompt() {
    document.querySelector("#restart-alert").hidden = false;
  }

  async function restartFacebook() {
    const response = await chrome.runtime.sendMessage({ type: "QF_RESTART_FACEBOOK" });
    if (!response?.ok || !response.restarted) {
      return showError(new Error(response?.reason || response?.error || "Could not restart Facebook"));
    }
    document.querySelector("#restart-alert").hidden = true;
    showToast(`Restarted ${response.count} Facebook ${response.count === 1 ? "tab" : "tabs"}.`);
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2800);
  }

  function showError(error) {
    showToast(error.message);
  }
})();
