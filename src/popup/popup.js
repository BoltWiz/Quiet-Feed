(function initializePopup() {
  "use strict";

  const { FEATURES, STORAGE_KEYS, mergeSettings, mergeStats } = QuietFeed;
  const featureList = document.querySelector("#feature-list");
  const reloadAlert = document.querySelector("#reload-alert");
  const reloadButton = document.querySelector("#reload-facebook");
  const saveStatus = document.querySelector("#save-status");
  const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  let settings = null;
  let activeTab = "feed";

  document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  document.querySelector("#open-options").addEventListener("click", openOptions);
  reloadButton.addEventListener("click", reloadFacebook);
  document.querySelector("#dismiss-reload").addEventListener("click", () => {
    reloadAlert.hidden = true;
  });
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
    button.addEventListener("keydown", handleTabKeydown);
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
    if (!settings) return;
    const groups = activeTab === "feed" ? ["feed", "behavior"] : ["distractions"];
    featureList.replaceChildren(
      ...FEATURES.filter((feature) => groups.includes(feature.group)).map(createFeatureRow),
    );
  }

  function selectTab(tab) {
    if (!tabButtons.some((button) => button.dataset.tab === tab)) return;
    activeTab = tab;
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === activeTab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document
      .querySelector("#filter-panel")
      .setAttribute("aria-labelledby", activeTab === "feed" ? "tab-feed" : "tab-distractions");
    renderFeatures();
  }

  function handleTabKeydown(event) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const currentIndex = tabButtons.indexOf(event.currentTarget);
    const nextButton = tabButtons[(currentIndex + direction + tabButtons.length) % tabButtons.length];
    selectTab(nextButton.dataset.tab);
    nextButton.focus();
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
    switchLabel.title = feature.description;
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
    if (!(await confirmFeatureChange(feature, value))) {
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
    saveStatus.hidden = true;
    await showReloadPrompt();
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
    reloadAlert.hidden = false;
    const response = await chrome.runtime.sendMessage({ type: "QF_GET_FILTER_HEALTH" });
    if (!response?.ok) return;
    renderFilterHealth(response);
    const count = response.tabCount;
    document.querySelector("#reload-copy").textContent = count
      ? `Optional: Reload ${count} Facebook ${count === 1 ? "tab" : "tabs"} to ensure this setting is fully applied.`
      : "Setting saved. Open Facebook to apply it.";
    reloadButton.hidden = count === 0;
    reloadButton.textContent = count === 1 ? "Reload tab" : `Reload ${count} tabs`;
  }

  async function reloadFacebook() {
    const response = await chrome.runtime.sendMessage({ type: "QF_RELOAD_FACEBOOK_TABS" });
    if (!response?.ok || !response.reloaded) {
      return showError(new Error(response?.reason || response?.error || "Could not reload Facebook"));
    }
    window.close();
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
  }

  async function openOptions() {
    await chrome.runtime.sendMessage({ type: "QF_OPEN_OPTIONS" });
    window.close();
  }

  function showError(error) {
    saveStatus.hidden = false;
    saveStatus.textContent = error.message;
  }
})();
