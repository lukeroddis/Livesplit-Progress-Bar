/**
 * src/ui/settings-background-panel.js - HUD Background Settings Panel
 *
 * Glassmorphic background plate controls: the shared opacity and blur sliders
 * (Layout Mode toolbar) and each widget's plate toggle (in its settings popover).
 */

(function () {
  "use strict";

  const C = window.LiveSplit.SettingsControls;

  const DEFAULT_OPACITY = 55;
  const DEFAULT_BLUR = 8;
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

    function sync(style) {
      const opacity = (style.bgOpacity != null ? style.bgOpacity : DEFAULT_OPACITY);
      C.syncSlider("slider-bg-opacity", "val-bg-opacity", opacity, C.formats.percentOrOff);
      C.syncSlider("slider-bg-blur", "val-bg-blur", (style.bgBlur != null ? style.bgBlur : DEFAULT_BLUR), C.formats.px);

      COMPONENT_TOGGLES.forEach(({ id, prop }) => {
        const cb = document.getElementById(id);
        if (cb) cb.checked = style[prop] !== false;
      });
    }

    function bind() {
      const sliderDeps = { getStyle: getCurrentTrackStyle, applyStyle: applyTrackStyle, saveStyle: saveTrackStyle };
      C.bindStyleSlider(Object.assign({ sliderId: "slider-bg-opacity", badgeId: "val-bg-opacity", prop: "bgOpacity", format: C.formats.percentOrOff }, sliderDeps));
      C.bindStyleSlider(Object.assign({ sliderId: "slider-bg-blur", badgeId: "val-bg-blur", prop: "bgBlur", format: C.formats.px }, sliderDeps));

      COMPONENT_TOGGLES.forEach(({ id, prop }) => {
        document.getElementById(id)?.addEventListener("change", (e) => {
          const style = getCurrentTrackStyle();
          if (!style) return;
          style[prop] = e.target.checked;
          applyTrackStyle();
          saveTrackStyle();
        });
      });
    }

    return { sync, bind };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsBackgroundPanel = {
    createBackgroundPanel
  };
})();
