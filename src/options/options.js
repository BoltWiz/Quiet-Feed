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
  const pendingKeys = new Set();

  document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  document.querySelector("#reset-stats").addEventListener("click", resetStats);
  document.querySelector("#reset-settings").addEventListener("click", resetSettings);
  document.querySelector("#export-settings").addEventListener("click", exportSettings);
  document.querySelector("#import-settings").addEventListener("change", importSettings);
  document.querySelector("#reload-facebook").addEventListener("click", reloadFacebook);
  document.querySelector("#health-reload").addEventListener("click", reloadFacebook);
  document.querySelector("#dismiss-reload").addEventListener("click", () => {
    document.querySelector("#reload-alert").hidden = true;
  });

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
    refreshFilterHealth();
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
    const pending = pendingKeys.has(feature.key);
    const disabled = (feature.dependsOn && !settings[feature.dependsOn]) || pending;
    const row = document.createElement("div");
    row.className = "feature-row";
    row.setAttribute("aria-disabled", String(Boolean(disabled)));
    row.setAttribute("aria-busy", String(pending));

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
    row.addEventListener("click", (event) => {
      if (disabled || event.target.closest("label, input, button")) return;
      input.click();
    });
    return row;
  }

  async function updateFeature(key, value) {
    if (pendingKeys.has(key)) return;
    const feature = FEATURES.find((item) => item.key === key);
    if (!(await confirmFeatureChange(feature, value))) {
      renderFeatures();
      return;
    }
    if (pendingKeys.has(key)) return;

    pendingKeys.add(key);
    renderFeatures();
    try {
      const response = await chrome.runtime.sendMessage({ type: "QF_SET_FEATURE", key, value });
      if (!response?.ok) throw new Error(response?.error || "Could not save setting");
      settings = mergeSettings(response.settings);
    } catch (error) {
      showError(error);
      return;
    } finally {
      pendingKeys.delete(key);
      renderFeatures();
    }
    await showReloadPrompt();
    showToast("Setting saved.");
  }

  async function resetStats() {
    const response = await chrome.runtime.sendMessage({ type: "QF_RESET_STATS" });
    if (!response?.ok) return showError(new Error(response?.error || "Could not reset counters"));
    renderStats(response.stats);
    showToast("Counters reset.");
  }

  async function resetSettings() {
    if (!(await confirmSuggestedRemoval(DEFAULT_SETTINGS))) return;
    const response = await chrome.runtime.sendMessage({ type: "QF_RESET_SETTINGS" });
    if (!response?.ok) return showError(new Error(response?.error || "Could not restore defaults"));
    settings = mergeSettings(response.settings || DEFAULT_SETTINGS);
    renderFeatures();
    await showReloadPrompt();
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
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      showError(new Error("That file is not a valid Quiet Feed backup."));
      return;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.version !== 1 ||
      !payload.settings ||
      typeof payload.settings !== "object" ||
      Array.isArray(payload.settings) ||
      !payload.stats ||
      typeof payload.stats !== "object" ||
      Array.isArray(payload.stats)
    ) {
      showError(new Error("That file is not a valid Quiet Feed backup."));
      return;
    }

    const importedSettings = mergeSettings(payload.settings);
    const importedStats = mergeStats(payload.stats);
    if (!(await confirmSuggestedRemoval(importedSettings))) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "QF_IMPORT_STATE",
        value: { settings: importedSettings, stats: importedStats },
      });
      if (!response?.ok) throw new Error(response?.error || "Could not import settings");
      await showReloadPrompt();
      showToast("Settings imported.");
    } catch (error) {
      showError(new Error(error?.message || "Could not import settings."));
    }
  }

  function confirmSuggestedRemoval(nextSettings) {
    if (settings?.removeSuggested || !nextSettings.removeSuggested) return Promise.resolve(true);
    const feature = FEATURES.find((item) => item.key === "removeSuggested");
    return confirmFeatureChange(feature, true);
  }

  function confirmFeatureChange(feature, value) {
    if (!value || !feature?.confirmation) return Promise.resolve(true);
    const dialog = document.querySelector("#suggested-confirm");
    document.querySelector("#suggested-confirm-copy").textContent = feature.confirmation;
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {
        once: true,
      });
    });
  }

  async function showReloadPrompt() {
    const alert = document.querySelector("#reload-alert");
    const button = document.querySelector("#reload-facebook");
    alert.hidden = false;
    const response = await chrome.runtime.sendMessage({ type: "QF_GET_FILTER_HEALTH" });
    if (!response?.ok) return;
    renderFilterHealth(response);
    const count = response.tabCount;
    document.querySelector("#reload-copy").textContent = count
      ? `Setting changed. Optionally reload ${count} Facebook ${count === 1 ? "tab" : "tabs"} to ensure it is fully applied.`
      : "Setting changed. Open Facebook to apply it.";
    button.hidden = count === 0;
    button.textContent = count === 1 ? "Reload Facebook tab" : `Reload ${count} Facebook tabs`;
  }

  async function reloadFacebook() {
    const response = await chrome.runtime.sendMessage({ type: "QF_RELOAD_FACEBOOK_TABS" });
    if (!response?.ok || !response.reloaded) {
      return showError(new Error(response?.reason || response?.error || "Could not reload Facebook"));
    }
    document.querySelector("#reload-alert").hidden = true;
    showToast(`Reloaded ${response.count} Facebook ${response.count === 1 ? "tab" : "tabs"}.`);
    setTimeout(refreshFilterHealth, 1200);
  }

  async function refreshFilterHealth() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "QF_GET_FILTER_HEALTH" });
      if (response?.ok) renderFilterHealth(response);
    } catch {
      renderFilterHealth({ status: "inactive", label: "Filter status unavailable" });
    }
  }

  function renderFilterHealth(value) {
    const health = document.querySelector("#filter-health");
    health.dataset.status = value.status;
    document.querySelector("#filter-health-label").textContent = value.label;
    const action = document.querySelector("#health-reload");
    action.hidden = !value.tabCount || !["fallback", "waiting"].includes(value.status);
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
