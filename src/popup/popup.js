(function initializePopup() {
  "use strict";

  const { FEATURES, STORAGE_KEYS, mergeSettings, mergeStats } = QuietFeed;
  const featureList = document.querySelector("#feature-list");
  const restartAlert = document.querySelector("#restart-alert");
  const saveStatus = document.querySelector("#save-status");
  let settings = null;

  document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  document.querySelector("#open-options").addEventListener("click", openOptions);
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
    featureList.replaceChildren(
      ...FEATURES.filter((feature) => feature.group !== "distractions" || feature.defaultValue)
        .map(createFeatureRow),
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
    restartAlert.hidden = false;
  }

  async function restartFacebook() {
    const response = await chrome.runtime.sendMessage({ type: "QF_RESTART_FACEBOOK" });
    if (!response?.ok || !response.restarted) {
      return showError(new Error(response?.reason || response?.error || "Could not restart Facebook"));
    }
    window.close();
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
