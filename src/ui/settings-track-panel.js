/**
 * src/ui/settings-track-panel.js - Track Settings Panel
 *
 * Syncs and binds the track controls shared by the toolbar and the customizer modal:
 * - Orientation (segmented control + footer badge) and the opposing-side hint
 * - Split name / delta positions (kept on opposite sides while 40° angle mode is active)
 * - Split angle (toolbar select + modal segmented control)
 * - Name / delta font, bar height and dot size sliders
 * - Visible split count (toolbar + modal spin boxes, Fit All / Auto) and "Always Show Last Split"
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const C = window.LiveSplit.SettingsControls;

  const SIZE_SLIDERS = [
    { sliderId: "slider-name-font", badgeId: "val-name-font", prop: "nameFontSize" },
    { sliderId: "slider-delta-font", badgeId: "val-delta-font", prop: "deltaFontSize" },
    { sliderId: "slider-bar-height", badgeId: "val-bar-height", prop: "barHeight" },
    { sliderId: "slider-dot-size", badgeId: "val-dot-size", prop: "dotSize" }
  ];

  const SPINNERS = [
    { dec: "btn-splits-dec", inc: "btn-splits-inc", input: "input-visible-splits", all: "btn-splits-fit-all", auto: "btn-splits-auto" },
    { dec: "modal-splits-dec", inc: "modal-splits-inc", input: "modal-input-visible-splits", all: "modal-btn-splits-all", auto: "modal-btn-splits-auto" }
  ];

  function getAnglePref() {
    return localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
  }

  // Angle mode is on when chosen explicitly or auto-applied by track density
  function isAngledMode() {
    const track = document.getElementById("track");
    return getAnglePref() === "angled" || !!(track && track.classList.contains("angled-text"));
  }

  function refreshTrackDensity() {
    if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
  }

  /**
   * @param {Object} deps - { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle, setTrackOrientation, setVisibleSplits }
   */
  function createTrackPanel(deps) {
    const { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle, setTrackOrientation, setVisibleSplits } = deps;

    function syncOrientation(isVert) {
      C.syncSegmented("#ctrl-track-orient", isVert ? "vertical" : "horizontal");

      const orientBadge = document.getElementById("track-orient-badge");
      if (orientBadge) {
        orientBadge.innerText = isVert ? "Orient: Vert" : "Orient: Horiz";
        orientBadge.style.color = isVert ? "#a78bfa" : "#38bdf8";
      }

      const hint = document.getElementById("opposing-hint");
      if (hint) {
        if (isVert) {
          hint.style.display = "block";
          hint.innerText = "💡 Position split names and deltas on either side of the vertical timeline node.";
        } else {
          hint.innerText = "💡 When 40° angle is active, timers stay horizontal on the opposite side to eliminate overlap.";
          hint.style.display = isAngledMode() ? "block" : "none";
        }
      }

      // Horizontal tracks offer Top/Bottom, vertical tracks Left/Right
      document.querySelectorAll(".seg-btn-horiz").forEach((btn) => { btn.style.display = isVert ? "none" : ""; });
      document.querySelectorAll(".seg-btn-vert").forEach((btn) => { btn.style.display = isVert ? "" : "none"; });
    }

    function syncVisibleSplits() {
      const splitPref = localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto";
      const spinInput = document.getElementById("input-visible-splits");
      const modalSpinInput = document.getElementById("modal-input-visible-splits");
      const valBadge = document.getElementById("val-visible-splits");

      const isAll = (splitPref === "all");
      const isAuto = (splitPref === "auto");
      const intVal = parseInt(splitPref, 10);
      const isNum = !isNaN(intVal) && intVal > 0;

      ["btn-splits-fit-all", "modal-btn-splits-all"].forEach((id) => document.getElementById(id)?.classList.toggle("active", isAll));
      ["btn-splits-auto", "modal-btn-splits-auto"].forEach((id) => document.getElementById(id)?.classList.toggle("active", isAuto));

      if (isNum) {
        if (spinInput) spinInput.value = intVal;
        if (modalSpinInput) modalSpinInput.value = intVal;
        if (valBadge) valBadge.innerText = `${intVal} splits`;
      } else if (valBadge) {
        valBadge.innerText = isAll ? "Fit All" : "Auto";
      }
    }

    function sync(style) {
      const isVert = (style.orientation === "vertical");
      const anglePref = getAnglePref();

      syncOrientation(isVert);
      C.syncSegmented("#ctrl-name-pos", style.namePos);
      C.syncSegmented("#ctrl-delta-pos", style.deltaPos);
      C.syncSegmented("#ctrl-modal-angle", anglePref);
      const angleSelect = document.getElementById("select-split-angle");
      if (angleSelect) angleSelect.value = anglePref;

      syncVisibleSplits();
      SIZE_SLIDERS.forEach((s) => C.syncSlider(s.sliderId, s.badgeId, style[s.prop], C.formats.px));
      C.syncStorageCheckbox("cb-always-show-last-split", STORAGE_KEYS.ALWAYS_SHOW_LAST);
    }

    // Choosing 40° moves deltas opposite the names so angled titles never collide with timers
    function applySplitAngle(val) {
      localStorage.setItem(STORAGE_KEYS.SPLIT_ANGLE, val);
      const style = getCurrentTrackStyle();
      if (val === "angled" && style) {
        style.deltaPos = (style.namePos === "top") ? "bottom" : "top";
        saveTrackStyle();
      }
      applyTrackStyle();
      refreshTrackDensity();
    }

    function bindPositions() {
      C.bindSegmented("#ctrl-name-pos", (val) => {
        const style = getCurrentTrackStyle();
        if (!style) return;
        style.namePos = val;
        if (isAngledMode()) {
          style.deltaPos = (style.namePos === "top") ? "bottom" : "top";
        }
        applyTrackStyle();
        saveTrackStyle();
      });

      C.bindSegmented("#ctrl-delta-pos", (val) => {
        const style = getCurrentTrackStyle();
        if (!style) return;
        style.deltaPos = val;
        if (isAngledMode()) {
          style.namePos = (style.deltaPos === "top") ? "bottom" : "top";
        }
        applyTrackStyle();
        saveTrackStyle();
      });
    }

    function bind() {
      const getCurrentSplits = () => parseInt(localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS), 10);
      SPINNERS.forEach((ids) => C.bindSplitSpinner(ids, getCurrentSplits, setVisibleSplits));

      const angleSelect = document.getElementById("select-split-angle");
      if (angleSelect) angleSelect.addEventListener("change", () => applySplitAngle(angleSelect.value));
      C.bindSegmented("#ctrl-modal-angle", applySplitAngle);

      C.bindSegmented("#ctrl-track-orient", setTrackOrientation);
      document.getElementById("track-orient-badge")?.addEventListener("click", () => {
        const style = getCurrentTrackStyle();
        const cur = (style && style.orientation) || "horizontal";
        setTrackOrientation(cur === "vertical" ? "horizontal" : "vertical");
      });

      bindPositions();

      SIZE_SLIDERS.forEach((s) => C.bindStyleSlider(Object.assign({
        format: C.formats.px,
        getStyle: getCurrentTrackStyle,
        applyStyle: applyTrackStyle,
        saveStyle: saveTrackStyle
      }, s)));

      C.bindStorageCheckbox("cb-always-show-last-split", STORAGE_KEYS.ALWAYS_SHOW_LAST, () => {
        refreshTrackDensity();
        if (typeof window !== "undefined" && window.updateTrackStatus) window.updateTrackStatus(window.getCurrentIndex ? window.getCurrentIndex() : -1);
      });
    }

    return { sync, bind, applySplitAngle };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsTrackPanel = {
    createTrackPanel,
    isAngledMode
  };
})();
