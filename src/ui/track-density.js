/**
 * src/ui/track-density.js - Track Node Spacing & Auto-Angled Split Names
 *
 * Computes --node-spacing from the visible-splits preference and viewport size,
 * decides whether split titles need the 40° angled-text mode, and syncs the
 * related badges, spin boxes and preset buttons.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  /**
   * @param {Object} options
   * @param {Function} options.getSplitCount - Returns the number of loaded splits
   * @param {Function} options.onOrientationChange - Called when the track flips between horizontal and vertical
   * @param {Function} [options.refresh] - Full density refresh used by the cycle helpers (defaults to update)
   */
  function createTrackDensityController(options = {}) {
    const {
      getSplitCount = () => 0,
      onOrientationChange = () => {},
      refresh = () => update()
    } = options;

    let lastKnownOrientation = null;

    function computeSpacing(isVertical, splitPref, alwaysShowLast, viewportWidth, viewportHeight, splitCount) {
      if (isVertical) {
        const pTop = 16;
        const pBottom = 24;
        const availH = Math.max(200, viewportHeight - (pTop + pBottom));
        if (splitPref === "all") {
          const totalCount = Math.max(1, splitCount + 1);
          return Math.max(38, Math.floor(availH / totalCount));
        } else if (splitPref !== "auto") {
          const num = parseInt(splitPref, 10);
          if (!isNaN(num) && num > 0) {
            const K = Math.min(num, splitCount + 1);
            return Math.max(38, Math.floor(availH / K));
          }
          return 64;
        } else if (alwaysShowLast && splitCount > 2) {
          const V = Math.max(4, Math.floor(availH / 64));
          const K = Math.min(V, splitCount + 1);
          return Math.max(38, Math.floor(availH / K));
        }
        return 64;
      }

      const pLeft = 24;
      const pRight = 24;
      const availW = Math.max(300, viewportWidth - (pLeft + pRight));

      if (splitPref === "all") {
        // Fit all splits on screen without scrolling
        const totalCount = Math.max(1, splitCount + 1); // +1 for the Start node
        return Math.max(45, Math.floor(availW / totalCount));
      } else if (splitPref !== "auto") {
        const num = parseInt(splitPref, 10);
        if (!isNaN(num) && num > 0) {
          const K = Math.min(num, splitCount + 1);
          return Math.max(45, Math.floor(availW / K));
        }
        return 220;
      } else if (alwaysShowLast && splitCount > 2) {
        // Auto mode: calculate capacity based on comfortable spacing, fully utilizing real estate
        const V = Math.max(4, Math.floor(availW / 125));
        const K = Math.min(V, splitCount + 1);
        return Math.max(45, Math.floor(availW / K));
      }
      // Default auto spacing
      return 220;
    }

    function syncSplitCountControls(splitPref, isVertical, splitCount) {
      const splitBadge = document.getElementById("split-density-badge");
      if (splitBadge) {
        splitBadge.innerText = (splitPref === "all")
          ? "Splits: All"
          : (splitPref === "auto" ? "Splits: Auto" : `Splits: ${splitPref}`);
      }

      const numInput = document.getElementById("input-visible-splits");
      const modalNumInput = document.getElementById("modal-input-visible-splits");
      const btnAll = document.getElementById("btn-splits-fit-all");
      const btnAuto = document.getElementById("btn-splits-auto");
      const modalBtnAll = document.getElementById("modal-btn-splits-all");
      const modalBtnAuto = document.getElementById("modal-btn-splits-auto");
      const valBadge = document.getElementById("val-visible-splits");

      const isAll = (splitPref === "all");
      const isAuto = (splitPref === "auto");
      const intVal = parseInt(splitPref, 10);
      const isNum = !isNaN(intVal) && intVal > 0;

      if (btnAll) btnAll.classList.toggle("active", isAll);
      if (modalBtnAll) modalBtnAll.classList.toggle("active", isAll);
      if (btnAuto) btnAuto.classList.toggle("active", isAuto);
      if (modalBtnAuto) modalBtnAuto.classList.toggle("active", isAuto);

      if (isNum) {
        if (numInput) numInput.value = intVal;
        if (modalNumInput) modalNumInput.value = intVal;
        if (valBadge) valBadge.innerText = `${intVal} splits`;
      } else if (isAll) {
        const total = Math.max(1, splitCount);
        if (numInput) numInput.value = total;
        if (modalNumInput) modalNumInput.value = total;
        if (valBadge) valBadge.innerText = `Fit All (${total})`;
      } else {
        if (numInput) numInput.value = isVertical ? 10 : 8;
        if (modalNumInput) modalNumInput.value = isVertical ? 10 : 8;
        if (valBadge) valBadge.innerText = "Auto";
      }
    }

    function shouldAngleNames(track, isVertical, anglePref, spacing) {
      // 40° angle applies strictly to split names in horizontal mode
      if (isVertical) return false;
      if (anglePref === "angled" || anglePref === "40") return true;
      if (anglePref === "horizontal" || anglePref === "flat") return false;
      // Intelligent collision detection:
      // If node spacing is under 175px, text is very prone to collision
      if (spacing < 175) return true;
      const nameElements = track.querySelectorAll(".split-name");
      for (const el of nameElements) {
        if (el.scrollWidth > (spacing - 24)) return true;
      }
      return false;
    }

    function applyAngleMode(track, shouldAngle, isVertical, anglePref) {
      if (shouldAngle) {
        track.classList.add("angled-text");
        // Enforce opposing delta positioning when angled mode is active
        if (window.hudLayout) {
          const style = window.hudLayout.getTrackStyle();
          if (style && style.namePos === style.deltaPos) {
            style.deltaPos = style.namePos === "top" ? "bottom" : "top";
            if (window.hudLayout.saveTrackStyle) window.hudLayout.saveTrackStyle();
            if (window.hudLayout.syncTrackModalUI) window.hudLayout.syncTrackModalUI();
          }
        }
      } else {
        track.classList.remove("angled-text");
      }

      const angleBadge = document.getElementById("split-angle-badge");
      if (angleBadge) {
        if (isVertical) {
          angleBadge.innerText = "Angle: Flat";
        } else {
          angleBadge.innerText = (anglePref === "auto")
            ? (shouldAngle ? "Angle: Auto (40°)" : "Angle: Auto (Flat)")
            : (anglePref === "angled" ? "Angle: 40°" : "Angle: Flat");
        }
      }
      const angleSelect = document.getElementById("select-split-angle");
      if (angleSelect) {
        angleSelect.value = isVertical ? "horizontal" : anglePref;
      }
    }

    /**
     * Recomputes spacing and angle mode for the current track.
     * @returns {boolean} false when the track DOM is missing (nothing updated)
     */
    function update() {
      const viewport = document.getElementById("track-viewport");
      const track = document.getElementById("track");
      if (!viewport || !track) return false;

      const isVertical = track.classList.contains("vertical");
      const trackComp = document.getElementById("hud-comp-track");
      const isDockedVertical = isVertical && (trackComp?.classList.contains("docked-left") || trackComp?.classList.contains("docked-right"));
      const isDockedHorizontal = !isVertical && (trackComp?.classList.contains("docked-bottom") || trackComp?.classList.contains("docked-top"));

      const currentOrient = isVertical ? "vertical" : "horizontal";
      if (lastKnownOrientation !== null && lastKnownOrientation !== currentOrient) {
        onOrientationChange();
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
      lastKnownOrientation = currentOrient;

      const viewportWidth = (isDockedHorizontal && (viewport.clientWidth < 500))
        ? (window.innerWidth || 1920)
        : (viewport.clientWidth || window.innerWidth || 1920);

      const viewportHeight = (isDockedVertical && (viewport.clientHeight < 300))
        ? (window.innerHeight || 1080)
        : (viewport.clientHeight || window.innerHeight || 800);

      const splitPref = localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto";
      const anglePref = localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
      const alwaysShowLast = localStorage.getItem(STORAGE_KEYS.ALWAYS_SHOW_LAST) !== "false";
      const splitCount = getSplitCount();

      const spacing = computeSpacing(isVertical, splitPref, alwaysShowLast, viewportWidth, viewportHeight, splitCount);
      document.documentElement.style.setProperty("--node-spacing", `${spacing}px`);

      syncSplitCountControls(splitPref, isVertical, splitCount);
      applyAngleMode(track, shouldAngleNames(track, isVertical, anglePref, spacing), isVertical, anglePref);
      return true;
    }

    function cycleVisibleSplits() {
      const current = localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto";
      const sequence = ["auto", "6", "8", "10", "12", "16", "all"];
      const curIdx = sequence.indexOf(current);
      const nextIdx = (curIdx !== -1) ? ((curIdx + 1) % sequence.length) : 0;
      const nextVal = sequence[nextIdx];
      if (window.hudLayout?.setVisibleSplits) {
        window.hudLayout.setVisibleSplits(nextVal);
      } else {
        localStorage.setItem(STORAGE_KEYS.VISIBLE_SPLITS, nextVal);
        refresh();
      }
    }

    function cycleSplitAngle() {
      const current = localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
      const sequence = ["auto", "angled", "horizontal"];
      const nextIdx = (sequence.indexOf(current) + 1) % sequence.length;
      const nextVal = sequence[nextIdx];
      localStorage.setItem(STORAGE_KEYS.SPLIT_ANGLE, nextVal);
      if (window.hudLayout) {
        if (nextVal === "angled") {
          const style = window.hudLayout.getTrackStyle();
          if (style && style.orientation !== "vertical") {
            style.deltaPos = (style.namePos === "top") ? "bottom" : "top";
            window.hudLayout.saveTrackStyle();
          }
        }
        window.hudLayout.applyTrackStyle();
      }
      refresh();
    }

    return { update, computeSpacing, cycleVisibleSplits, cycleSplitAngle };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TrackDensity = {
    createTrackDensityController
  };
})();
