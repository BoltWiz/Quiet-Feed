(function initializeQuietFeedUI(global) {
  "use strict";

  /**
   * Creates a feature toggle row.
   * @param {object} feature - Feature definition from FEATURES array.
   * @param {object} options
   * @param {object} options.settings - Current settings object.
   * @param {Set} options.pendingKeys - Keys currently being saved.
   * @param {function} options.onChange - Called with (key, newValue) on toggle.
   * @param {"compact"|"full"} [options.variant] - "compact" shows tooltip, "full" shows description paragraph.
   * @returns {HTMLElement}
   */
  function createFeatureRow(feature, options) {
    const { settings, pendingKeys, onChange, variant = "compact" } = options;
    const dependencyDisabled = feature.dependsOn && !settings[feature.dependsOn];
    const pending = pendingKeys.has(feature.key);
    const disabled = dependencyDisabled || pending;

    const row = document.createElement("div");
    row.className = "feature-row";
    row.setAttribute("aria-disabled", String(Boolean(disabled)));
    row.setAttribute("aria-busy", String(pending));

    const copy = document.createElement("div");
    copy.className = "feature-copy";

    if (variant === "compact") {
      const heading = document.createElement("div");
      heading.className = "feature-heading";
      const label = document.createElement("label");
      label.className = "feature-label";
      label.htmlFor = `feature-${feature.key}`;
      label.textContent = feature.label;
      const info = document.createElement("button");
      info.type = "button";
      info.className = "feature-info";
      info.setAttribute("aria-label", `About ${feature.label}`);
      const tooltip = document.createElement("span");
      tooltip.className = "feature-tooltip";
      tooltip.id = `tooltip-${feature.key}`;
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = feature.description;
      info.setAttribute("aria-describedby", tooltip.id);
      info.append("i", tooltip);
      heading.append(label, info);
      copy.append(heading);
    } else {
      const label = document.createElement("label");
      label.className = "feature-label";
      label.htmlFor = `feature-${feature.key}`;
      label.textContent = feature.label;
      const description = document.createElement("p");
      description.className = "feature-description";
      description.textContent = feature.description;
      copy.append(label, description);
    }

    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    if (variant === "compact") switchLabel.title = feature.description;
    const input = document.createElement("input");
    input.id = `feature-${feature.key}`;
    input.type = "checkbox";
    input.checked = settings[feature.key];
    input.disabled = Boolean(disabled);
    input.setAttribute("aria-label", feature.label);
    input.addEventListener("change", () => onChange(feature.key, input.checked));
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

  const api = Object.freeze({ createFeatureRow });
  global.QuietFeedUI = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
