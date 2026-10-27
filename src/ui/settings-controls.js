/**
 * src/ui/settings-controls.js - Shared Settings Control Helpers
 *
 * DOM helpers for the patterns the settings panels repeat: segmented buttons,
 * range sliders bound to a track style property, value badges, split-count
 * spin boxes, and checkboxes persisted to storage.
 */

(function () {
  "use strict";

  // Badge formatters shared by sync (initial value) and bind (live input)
  const formats = {
    px: (v) => `${v}px`,
    percent: (v) => `${v}%`,
    percentOrOff: (v) => (Number(v) === 0 ? "0% (Off)" : `${v}%`),
    pinLength: (v) => (Number(v) === 0 ? "0px (On Track)" : `${v}px`)
  };

  /** Marks the .seg-btn whose data-val equals `value` as active. */
  function syncSegmented(selector, value) {
    document.querySelectorAll(`${selector} .seg-btn`).forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === value);
    });
  }

  /** Calls onSelect(data-val) when any .seg-btn in the group is clicked. */
  function bindSegmented(selector, onSelect) {
    document.querySelectorAll(`${selector} .seg-btn`).forEach((btn) => {
      btn.addEventListener("click", () => onSelect(btn.getAttribute("data-val")));
    });
  }

  /** Sets a slider and its badge (only when both exist, matching the modal markup). */
  function syncSlider(sliderId, badgeId, value, format) {
    const slider = document.getElementById(sliderId);
    const badge = document.getElementById(badgeId);
    if (!slider || !badge) return;
    slider.value = value;
    badge.innerText = format(value);
  }

  /**
   * Live-binds a slider to a numeric track style property: input updates the
   * property, badge and preview; change persists the style.
   */
  function bindStyleSlider({ sliderId, badgeId, prop, format, getStyle, applyStyle, saveStyle }) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;
    slider.addEventListener("input", () => {
      const style = getStyle();
      if (!style) return;
      style[prop] = parseInt(slider.value, 10);
      const badge = document.getElementById(badgeId);
      if (badge) badge.innerText = format(style[prop]);
      applyStyle();
    });
    slider.addEventListener("change", saveStyle);
  }

  /** Checks a checkbox from a stored "true"/"false" flag (missing counts as true). */
  function syncStorageCheckbox(id, key) {
    const cb = document.getElementById(id);
    if (cb) cb.checked = (localStorage.getItem(key) !== "false");
  }

  /** Persists a checkbox as "true"/"false" and runs onChange afterwards. */
  function bindStorageCheckbox(id, key, onChange = () => {}) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      localStorage.setItem(key, e.target.checked ? "true" : "false");
      onChange(e.target.checked);
    });
  }

  /**
   * Binds a split-count spin box: -/+ buttons, typed value (2..60) and Fit All / Auto pills.
   * @param {Object} ids - { dec, inc, input, all, auto }
   * @param {Function} getCurrent - Current numeric preference (falls back to 8)
   * @param {Function} setVisibleSplits
   */
  function bindSplitSpinner(ids, getCurrent, setVisibleSplits) {
    document.getElementById(ids.dec)?.addEventListener("click", () => {
      setVisibleSplits(Math.max(2, (getCurrent() || 8) - 1));
    });
    document.getElementById(ids.inc)?.addEventListener("click", () => {
      setVisibleSplits(Math.min(60, (getCurrent() || 8) + 1));
    });

    const input = document.getElementById(ids.input);
    if (input) {
      input.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 2 && val <= 60) setVisibleSplits(val);
      });
      input.addEventListener("change", (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 2) val = 2;
        if (val > 60) val = 60;
        e.target.value = val;
        setVisibleSplits(val);
      });
    }

    document.getElementById(ids.all)?.addEventListener("click", () => setVisibleSplits("all"));
    document.getElementById(ids.auto)?.addEventListener("click", () => setVisibleSplits("auto"));
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsControls = {
    formats,
    syncSegmented,
    bindSegmented,
    syncSlider,
    bindStyleSlider,
    syncStorageCheckbox,
    bindStorageCheckbox,
    bindSplitSpinner
  };
})();
