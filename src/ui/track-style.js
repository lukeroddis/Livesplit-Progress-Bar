/**
 * Speedrun Overlay - Track Style & Orientation Controller
 * 
 * Encapsulates:
 * - Track styling defaults (bar height, dot size, typography, ghost pin length/size, backgrounds)
 * - Orientation transitions (horizontal docked-bottom vs vertical docked-left/right)
 * - Positional label mapping (top/bottom <-> left/right) and opposing angled text guarantees
 * - Dynamic CSS variable injection (--bar-height, --dot-size, --name-font-size, etc.)
 * - Split density preference management ("all", "auto", 2..60)
 * - Viewport scroll reset and reflow scheduling via requestAnimationFrame
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const TRACK_STYLE_KEY = STORAGE_KEYS.TRACK_STYLE;
  const SPLIT_DENSITY_KEY = STORAGE_KEYS.VISIBLE_SPLITS;

  // Single source of default track styling (layout.js and layout profiles read it from here)
  const DEFAULT_TRACK_STYLE = Object.freeze({
    orientation: "horizontal", // 'horizontal' | 'vertical'
    namePos: "top",        // 'top' | 'bottom' | 'left' | 'right'
    deltaPos: "bottom",    // 'top' | 'bottom' | 'left' | 'right'
    nameFontSize: 17,      // px
    deltaFontSize: 15,     // px
    barHeight: 6,          // px
    dotSize: 15,           // px
    ghostPinLength: 16,    // px (0 to 36)
    ghostPinSize: 26,      // px (18 to 44)
    bgOpacity: 55,         // % (0 to 95)
    bgBlur: 8,             // px (0 to 20)
    bgTitle: true,         // boolean
    bgTimers: true,        // boolean
    bgTrack: true,         // boolean
    logoHeight: 60         // px (25 to 140)
  });

  /**
   * Pure mapping helper to switch orientation and recalculate name/delta positions.
   */
  function mapOrientationSwitch(currentOrient, newOrient, currentNamePos, currentDeltaPos) {
    const targetOrient = (newOrient === "vertical") ? "vertical" : "horizontal";
    let namePos = currentNamePos;
    let deltaPos = currentDeltaPos;

    if (targetOrient === "vertical") {
      if (namePos === "top" || namePos === "bottom") {
        namePos = (namePos === "bottom") ? "right" : "left";
      }
      if (deltaPos === "top" || deltaPos === "bottom") {
        deltaPos = "right";
      }
    } else {
      if (namePos === "left" || namePos === "right") {
        namePos = (namePos === "right") ? "bottom" : "top";
      }
      if (deltaPos === "left" || deltaPos === "right") {
        deltaPos = "top";
      }
    }

    return { orientation: targetOrient, namePos, deltaPos };
  }

  function createTrackStyle(options = {}) {
    const {
      getCurrentStyle = () => null,
      setCurrentStyle = () => {},
      getLayoutState = () => null,
      saveLayout = () => {},
      applyComponentLayout = () => {},
      syncTrackModalUI = () => {},
      removeGameLogo = () => {},
      fitTrackOnScreen = () => {},
      storageKey = TRACK_STYLE_KEY
    } = options;

    function loadSavedStyle() {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          return Object.assign({}, DEFAULT_TRACK_STYLE, JSON.parse(saved));
        }
      } catch (e) {
        console.warn("Failed to load saved track style", e);
      }
      return Object.assign({}, DEFAULT_TRACK_STYLE);
    }

    function saveStyle(style) {
      const s = style || getCurrentStyle();
      try {
        localStorage.setItem(storageKey, JSON.stringify(s));
      } catch (e) {
        console.warn("Failed to save track style", e);
      }
    }

    function resetStyle() {
      const reset = Object.assign({}, DEFAULT_TRACK_STYLE);
      setCurrentStyle(reset);
      saveStyle(reset);
      applyStyle();
      removeGameLogo();
      return reset;
    }

    function enforceOpposingTrackPositions() {
      const currentTrackStyle = getCurrentStyle();
      if (!currentTrackStyle) return;
      if (currentTrackStyle.orientation === "vertical") return;
      const anglePref = localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
      const track = document.getElementById("track");
      const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));
      if (isAngled) {
        if (currentTrackStyle.namePos === "top") {
          currentTrackStyle.deltaPos = "bottom";
        } else {
          currentTrackStyle.deltaPos = "top";
        }
      }
    }

    function setOrientation(orient) {
      let currentTrackStyle = getCurrentStyle();
      if (!currentTrackStyle) {
        currentTrackStyle = loadSavedStyle();
        setCurrentStyle(currentTrackStyle);
      }
      const layoutState = getLayoutState();
      const mapped = mapOrientationSwitch(
        currentTrackStyle.orientation,
        orient,
        currentTrackStyle.namePos,
        currentTrackStyle.deltaPos
      );

      currentTrackStyle.orientation = mapped.orientation;
      currentTrackStyle.namePos = mapped.namePos;
      currentTrackStyle.deltaPos = mapped.deltaPos;

      if (mapped.orientation === "vertical") {
        if (layoutState && layoutState.track && layoutState.track.docked === "bottom") {
          layoutState.track.docked = "left";
          layoutState.track.x = 0;
          layoutState.track.y = 0;
          saveLayout();
        }
      } else {
        if (layoutState && layoutState.track && (layoutState.track.docked === "left" || layoutState.track.docked === "right")) {
          layoutState.track.docked = "bottom";
          layoutState.track.x = 0;
          layoutState.track.y = Math.max(0, ((typeof window !== "undefined" && window.innerHeight) || 1080) - 90);
          saveLayout();
        }
      }

      applyComponentLayout("track");
      applyStyle();
      // The old orientation's scale can push the new shape off screen (e.g. a scaled-up bar turned upright)
      fitTrackOnScreen();
      saveStyle(currentTrackStyle);
      syncTrackModalUI();

      const viewport = document.getElementById("track-viewport");
      if (viewport) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }

      window.LiveSplit.Overlay.refreshTrack?.();

      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          window.LiveSplit.Overlay.refreshTrack?.();
        });
      }
    }

    function applyStyle() {
      const currentTrackStyle = getCurrentStyle();
      if (!currentTrackStyle) return;
      const root = typeof document !== "undefined" ? document.documentElement : null;
      const track = document.getElementById("track");
      const elTrackComp = document.getElementById("hud-comp-track");
      const elViewport = document.getElementById("track-viewport");
      if (!root || !track) return;

      const isVert = (currentTrackStyle.orientation === "vertical");

      if (isVert) {
        track.classList.add("vertical");
        if (elTrackComp) elTrackComp.classList.add("vertical");
        if (elViewport) elViewport.classList.add("vertical");
      } else {
        track.classList.remove("vertical");
        if (elTrackComp) elTrackComp.classList.remove("vertical");
        if (elViewport) elViewport.classList.remove("vertical");
      }

      if (!isVert) {
        enforceOpposingTrackPositions();
      }

      // Set CSS custom variables
      root.style.setProperty("--bar-height", `${currentTrackStyle.barHeight}px`);
      root.style.setProperty("--dot-size", `${currentTrackStyle.dotSize}px`);
      root.style.setProperty("--name-font-size", `${currentTrackStyle.nameFontSize}px`);
      root.style.setProperty("--delta-font-size", `${currentTrackStyle.deltaFontSize}px`);
      const logoHeight = (currentTrackStyle.logoHeight != null ? currentTrackStyle.logoHeight : 60);
      root.style.setProperty("--game-logo-height", `${logoHeight}px`);
      const pinLength = (currentTrackStyle.ghostPinLength != null ? currentTrackStyle.ghostPinLength : 16);
      root.style.setProperty("--ghost-needle-length", `${pinLength}px`);
      track.style.setProperty("--ghost-needle-length", `${pinLength}px`);
      track.classList.toggle("ghost-on-track", pinLength === 0);

      const pinSize = (currentTrackStyle.ghostPinSize != null ? currentTrackStyle.ghostPinSize : 26);
      root.style.setProperty("--ghost-pin-size", `${pinSize}px`);
      track.style.setProperty("--ghost-pin-size", `${pinSize}px`);

      const opacityVal = (currentTrackStyle.bgOpacity != null ? currentTrackStyle.bgOpacity : 55);
      const blurPx = (currentTrackStyle.bgBlur != null ? currentTrackStyle.bgBlur : 8);
      root.style.setProperty("--bg-opacity", (opacityVal / 100).toFixed(2));
      root.style.setProperty("--bg-blur", `${blurPx}px`);

      // Toggle .has-bg on components
      const isBgActive = opacityVal > 0;
      const elTitle = document.getElementById("hud-comp-title");
      const elTimers = document.getElementById("hud-comp-timers");

      if (elTitle) elTitle.classList.toggle("has-bg", isBgActive && currentTrackStyle.bgTitle !== false);
      if (elTimers) elTimers.classList.toggle("has-bg", isBgActive && currentTrackStyle.bgTimers !== false);
      if (elTrackComp) elTrackComp.classList.toggle("has-bg", isBgActive && currentTrackStyle.bgTrack !== false);
      const elLeaderboard = document.getElementById("hud-comp-leaderboard");
      if (elLeaderboard) elLeaderboard.classList.toggle("has-bg", isBgActive);

      // Remove existing positional classes and set active ones
      track.classList.remove(
        "pos-name-top", "pos-name-bottom", "pos-name-left", "pos-name-right",
        "pos-delta-top", "pos-delta-bottom", "pos-delta-left", "pos-delta-right"
      );
      track.classList.add(`pos-name-${currentTrackStyle.namePos}`, `pos-delta-${currentTrackStyle.deltaPos}`);

      syncTrackModalUI();

      window.LiveSplit.Overlay.refreshTrack?.();
    }

    function setVisibleSplits(val) {
      if (val === "all" || val === "auto") {
        localStorage.setItem(SPLIT_DENSITY_KEY, val);
      } else {
        let num = parseInt(val, 10);
        if (isNaN(num) || num < 2) num = 2;
        if (num > 60) num = 60;
        localStorage.setItem(SPLIT_DENSITY_KEY, String(num));
      }
      window.LiveSplit.Overlay.refreshTrack?.();
      syncTrackModalUI();
    }

    return {
      STORAGE_KEY: storageKey,
      SPLIT_DENSITY_KEY,
      DEFAULT_STYLE: DEFAULT_TRACK_STYLE,
      loadSavedStyle,
      saveStyle,
      resetStyle,
      enforceOpposingTrackPositions,
      setOrientation,
      applyStyle,
      setVisibleSplits
    };
  }

  // Global namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TrackStyle = {
    DEFAULT_TRACK_STYLE,
    TRACK_STYLE_KEY,
    SPLIT_DENSITY_KEY,
    mapOrientationSwitch,
    createTrackStyle
  };
})();
