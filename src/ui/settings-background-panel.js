/**
 * src/ui/settings-background-panel.js - HUD Background Settings Panel
 *
 * Glassmorphic background plate controls: the shared opacity and blur sliders
 * (Layout Mode toolbar), opacity preset pills where present, each widget's plate
 * toggle (in its settings popover), and the settings menu BG badge that cycles
 * presets.
 */

(function () {
  "use strict";

  const C = window.LiveSplit.SettingsControls;

  const DEFAULT_OPACITY = 55;
  const DEFAULT_BLUR = 8;
  const FOOTER_PRESET_CYCLE = [55, 80, 0, 35];
  const COMPONENT_TOGGLES = [
    { id: "cb-bg-title", prop: "bgTitle" },
    { id: "cb-bg-timers", prop: "bgTimers" },
    { id: "cb-bg-track", prop: "bgTrack" }
  ];

  /**
   * @param {Object} deps - { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle }
   */
  function createBackgroundPanel(deps) {
    const { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle } = deps;

    function setOpacity(val) {
      const style = getCurrentTrackStyle();
      if (!style) return;
      style.bgOpacity = val;
      applyTrackStyle();
      saveTrackStyle();
    }

    function sync(style) {
      const opacity = (style.bgOpacity != null ? style.bgOpacity : DEFAULT_OPACITY);
      C.syncSlider("slider-bg-opacity", "val-bg-opacity", opacity, C.formats.percentOrOff);
      C.syncSlider("slider-bg-blur", "val-bg-blur", (style.bgBlur != null ? style.bgBlur : DEFAULT_BLUR), C.formats.px);

      document.querySelectorAll(".preset-pill-btn[data-preset-bg]").forEach((btn) => {
        btn.classList.toggle("active", parseInt(btn.getAttribute("data-preset-bg"), 10) === opacity);
      });

      COMPONENT_TOGGLES.forEach(({ id, prop }) => {
        const cb = document.getElementById(id);
        if (cb) cb.checked = style[prop] !== false;
      });

      const bgBadge = document.getElementById("bg-opacity-badge");
      if (bgBadge) {
        bgBadge.innerText = (opacity === 0) ? "BG: Off" : `BG: ${opacity}%`;
        bgBadge.style.color = (opacity > 0) ? "#38bdf8" : "rgba(148, 163, 184, 0.7)";
      }
    }

    function bind() {
      const sliderDeps = { getStyle: getCurrentTrackStyle, applyStyle: applyTrackStyle, saveStyle: saveTrackStyle };
      C.bindStyleSlider(Object.assign({ sliderId: "slider-bg-opacity", badgeId: "val-bg-opacity", prop: "bgOpacity", format: C.formats.percentOrOff }, sliderDeps));
      C.bindStyleSlider(Object.assign({ sliderId: "slider-bg-blur", badgeId: "val-bg-blur", prop: "bgBlur", format: C.formats.px }, sliderDeps));

      document.querySelectorAll(".preset-pill-btn[data-preset-bg]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = parseInt(btn.getAttribute("data-preset-bg"), 10);
          if (!isNaN(val)) setOpacity(val);
        });
      });

      COMPONENT_TOGGLES.forEach(({ id, prop }) => {
        document.getElementById(id)?.addEventListener("change", (e) => {
          const style = getCurrentTrackStyle();
          if (!style) return;
          style[prop] = e.target.checked;
          applyTrackStyle();
          saveTrackStyle();
        });
      });

      document.getElementById("bg-opacity-badge")?.addEventListener("click", () => {
        const style = getCurrentTrackStyle();
        if (!style) return;
        const cur = style.bgOpacity != null ? style.bgOpacity : DEFAULT_OPACITY;
        const idx = FOOTER_PRESET_CYCLE.indexOf(cur);
        setOpacity((idx !== -1) ? FOOTER_PRESET_CYCLE[(idx + 1) % FOOTER_PRESET_CYCLE.length] : DEFAULT_OPACITY);
      });
    }

    return { sync, bind };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsBackgroundPanel = {
    createBackgroundPanel
  };
})();
