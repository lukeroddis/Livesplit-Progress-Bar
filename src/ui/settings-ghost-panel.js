/**
 * src/ui/settings-ghost-panel.js - Ghost Runner Settings Panel
 *
 * Pin style for ghost and race pins: pin length / pinhead size sliders, pin side,
 * the pin lane and ghost opacity. Which ghosts show (and ghosts on / off) are
 * registry settings (settings-dialog-rows.js).
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const C = window.LiveSplit.SettingsControls;

  /**
   * @param {Object} deps - { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle }
   */
  function createGhostPanel(deps) {
    const { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle } = deps;

    function sync(style) {
      C.syncSlider("slider-ghost-pin-length", "val-ghost-pin-length", (style.ghostPinLength != null ? style.ghostPinLength : 16), C.formats.pinLength);
      C.syncSlider("slider-ghost-pin-size", "val-ghost-pin-size", (style.ghostPinSize != null ? style.ghostPinSize : 26), C.formats.px);
      C.syncSlider("slider-ghost-opacity", "val-ghost-opacity", parseInt(localStorage.getItem(STORAGE_KEYS.GHOST_OPACITY) || "85", 10), C.formats.percent);
      C.syncSegmented("#ctrl-pin-pos", style.pinPos || "auto");
      const cbLane = document.getElementById("cb-pin-lane");
      if (cbLane) cbLane.checked = style.pinLane !== false;
    }

    function updateStyle(mutate) {
      const style = getCurrentTrackStyle();
      if (!style) return;
      mutate(style);
      applyTrackStyle();
      saveTrackStyle();
    }

    function bind() {
      const sliderDeps = { getStyle: getCurrentTrackStyle, applyStyle: applyTrackStyle, saveStyle: saveTrackStyle };
      C.bindStyleSlider(Object.assign({ sliderId: "slider-ghost-pin-length", badgeId: "val-ghost-pin-length", prop: "ghostPinLength", format: C.formats.pinLength }, sliderDeps));
      C.bindStyleSlider(Object.assign({ sliderId: "slider-ghost-pin-size", badgeId: "val-ghost-pin-size", prop: "ghostPinSize", format: C.formats.px }, sliderDeps));

      C.bindSegmented("#ctrl-pin-pos", (val) => updateStyle((style) => { style.pinPos = val; }));
      document.getElementById("cb-pin-lane")?.addEventListener("change", (e) => {
        updateStyle((style) => { style.pinLane = e.target.checked; });
      });

      // Opacity is a ghost-runner preference (not track style): live preview on input, persisted on change
      const sliderGhostOp = document.getElementById("slider-ghost-opacity");
      if (sliderGhostOp) {
        sliderGhostOp.addEventListener("input", () => {
          const valBadge = document.getElementById("val-ghost-opacity");
          if (valBadge) valBadge.innerText = C.formats.percent(sliderGhostOp.value);
          window.LiveSplit.Overlay.setGhostOpacity?.(sliderGhostOp.value);
        });
        sliderGhostOp.addEventListener("change", () => {
          localStorage.setItem(STORAGE_KEYS.GHOST_OPACITY, sliderGhostOp.value);
        });
      }
    }

    return { sync, bind };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsGhostPanel = {
    createGhostPanel
  };
})();
