/**
 * layout.js - Interactive HUD Component Layout & Positioning Engine
 * Supports drag & drop positioning, proportional scaling, visibility toggling,
 * persistence via localStorage, and standalone OBS URL views (?view=title|timers|track).
 */

(function () {
  const STORAGE_KEY = "livesplit_hud_layout";
  const TRACK_STYLE_KEY = "livesplit_track_style";
  const COMPONENTS = ["title", "timers", "track"];

  const DEFAULT_TRACK_STYLE = {
    orientation: "horizontal", // 'horizontal' | 'vertical'
    namePos: "top",        // 'top' | 'bottom' | 'left' | 'right'
    deltaPos: "top",       // 'top' | 'bottom' | 'left' | 'right'
    nameFontSize: 17,      // px
    deltaFontSize: 15,     // px
    barHeight: 6,          // px
    dotSize: 15,           // px
    ghostPinLength: 16,    // px (0 to 36)
    bgOpacity: 55,         // % (0 to 95)
    bgBlur: 8,             // px (0 to 20)
    bgTitle: true,         // boolean
    bgTimers: true,        // boolean
    bgTrack: true          // boolean
  };

  let layoutState = null;
  let currentTrackStyle = null;
  let isEditMode = false;
  let activePointerOp = null; // { type: 'drag'|'scale', compId, startX, startY, origX, origY, origScale }

  function getDefaultLayout() {
    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;

    return {
      title: {
        x: 42,
        y: 20,
        scale: 1.0,
        visible: true,
        docked: "none"
      },
      timers: {
        x: Math.max(42, w - 460),
        y: 20,
        scale: 1.0,
        visible: true,
        docked: "none"
      },
      track: {
        x: 0,
        y: Math.max(0, h - 90),
        scale: 1.0,
        visible: true,
        docked: "bottom"
      }
    };
  }

  function loadSavedLayout() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const defaults = getDefaultLayout();
        const merged = {};
        for (const id of COMPONENTS) {
          merged[id] = Object.assign({}, defaults[id], parsed[id] || {});
        }
        return merged;
      }
    } catch (e) {
      console.warn("Failed to load saved layout, using defaults", e);
    }
    return getDefaultLayout();
  }

  function saveLayout() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutState));
    } catch (e) {
      console.warn("Failed to save layout to localStorage", e);
    }
  }

  function loadSavedTrackStyle() {
    try {
      const saved = localStorage.getItem(TRACK_STYLE_KEY);
      if (saved) {
        return Object.assign({}, DEFAULT_TRACK_STYLE, JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Failed to load saved track style", e);
    }
    return Object.assign({}, DEFAULT_TRACK_STYLE);
  }

  function saveTrackStyle() {
    try {
      localStorage.setItem(TRACK_STYLE_KEY, JSON.stringify(currentTrackStyle));
    } catch (e) {
      console.warn("Failed to save track style", e);
    }
  }

  function enforceOpposingTrackPositions() {
    if (!currentTrackStyle) return;
    if (currentTrackStyle.orientation === "vertical") return;
    const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";
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

  function setTrackOrientation(orient) {
    if (!currentTrackStyle) return;
    const newOrient = (orient === "vertical") ? "vertical" : "horizontal";
    currentTrackStyle.orientation = newOrient;

    if (newOrient === "vertical") {
      if (currentTrackStyle.namePos === "top" || currentTrackStyle.namePos === "bottom") {
        currentTrackStyle.namePos = (currentTrackStyle.namePos === "bottom") ? "right" : "left";
      }
      if (currentTrackStyle.deltaPos === "top" || currentTrackStyle.deltaPos === "bottom") {
        currentTrackStyle.deltaPos = "right";
      }
      if (layoutState && layoutState.track && layoutState.track.docked === "bottom") {
        layoutState.track.docked = "left";
        layoutState.track.x = 0;
        layoutState.track.y = 0;
        saveLayout();
      }
    } else {
      if (currentTrackStyle.namePos === "left" || currentTrackStyle.namePos === "right") {
        currentTrackStyle.namePos = (currentTrackStyle.namePos === "right") ? "bottom" : "top";
      }
      if (currentTrackStyle.deltaPos === "left" || currentTrackStyle.deltaPos === "right") {
        currentTrackStyle.deltaPos = "top";
      }
      if (layoutState && layoutState.track && (layoutState.track.docked === "left" || layoutState.track.docked === "right")) {
        layoutState.track.docked = "bottom";
        layoutState.track.x = 0;
        layoutState.track.y = Math.max(0, (window.innerHeight || 1080) - 90);
        saveLayout();
      }
    }

    applyTrackStyle();
    applyComponentLayout("track");
    saveTrackStyle();
    syncTrackModalUI();
  }
  window.setTrackOrientation = setTrackOrientation;

  function applyTrackStyle() {
    if (!currentTrackStyle) return;
    const root = document.documentElement;
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
    const pinLength = (currentTrackStyle.ghostPinLength != null ? currentTrackStyle.ghostPinLength : 16);
    root.style.setProperty("--ghost-needle-length", `${pinLength}px`);
    track.classList.toggle("ghost-on-track", pinLength === 0);

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

    // Remove existing positional classes and set active ones
    track.classList.remove(
      "pos-name-top", "pos-name-bottom", "pos-name-left", "pos-name-right",
      "pos-delta-top", "pos-delta-bottom", "pos-delta-left", "pos-delta-right"
    );
    track.classList.add(`pos-name-${currentTrackStyle.namePos}`, `pos-delta-${currentTrackStyle.deltaPos}`);

    syncTrackModalUI();

    if (window.updateTrackDensityAndAngle) {
      window.updateTrackDensityAndAngle();
    }
  }

  function setVisibleSplits(val) {
    if (val === "all" || val === "auto") {
      localStorage.setItem("livesplit_visible_splits", val);
    } else {
      let num = parseInt(val, 10);
      if (isNaN(num) || num < 2) num = 2;
      if (num > 60) num = 60;
      localStorage.setItem("livesplit_visible_splits", String(num));
    }
    if (window.updateTrackDensityAndAngle) {
      window.updateTrackDensityAndAngle();
    }
    syncTrackModalUI();
  }
  window.setVisibleSplits = setVisibleSplits;

  function syncTrackModalUI() {
    if (!currentTrackStyle) return;

    const isVert = (currentTrackStyle.orientation === "vertical");
    const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";
    const track = document.getElementById("track");
    const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));

    // Track Orientation segmented control sync
    document.querySelectorAll("#ctrl-track-orient .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === (isVert ? "vertical" : "horizontal"));
    });

    // Track Orient footer badge sync
    const orientBadge = document.getElementById("track-orient-badge");
    if (orientBadge) {
      orientBadge.innerText = isVert ? "Orient: Vert" : "Orient: Horiz";
      orientBadge.style.color = isVert ? "#a78bfa" : "#38bdf8";
    }

    // Opposing hint visibility
    const hint = document.getElementById("opposing-hint");
    if (hint) {
      if (isVert) {
        hint.style.display = "block";
        hint.innerText = "💡 Position split names and deltas on either side of the vertical timeline node.";
      } else {
        hint.innerText = "💡 When 40° angle is active, timers stay horizontal on the opposite side to eliminate overlap.";
        hint.style.display = isAngled ? "block" : "none";
      }
    }

    // Background Opacity & Blur sync
    const opacityVal = (currentTrackStyle.bgOpacity != null ? currentTrackStyle.bgOpacity : 55);
    const sBgOpacity = document.getElementById("slider-bg-opacity");
    const vBgOpacity = document.getElementById("val-bg-opacity");
    if (sBgOpacity && vBgOpacity) {
      sBgOpacity.value = opacityVal;
      vBgOpacity.innerText = (opacityVal === 0) ? "0% (Off)" : `${opacityVal}%`;
    }

    const blurPx = (currentTrackStyle.bgBlur != null ? currentTrackStyle.bgBlur : 8);
    const sBgBlur = document.getElementById("slider-bg-blur");
    const vBgBlur = document.getElementById("val-bg-blur");
    if (sBgBlur && vBgBlur) {
      sBgBlur.value = blurPx;
      vBgBlur.innerText = `${blurPx}px`;
    }

    // Preset buttons highlight
    document.querySelectorAll(".preset-pill-btn").forEach((btn) => {
      const pVal = parseInt(btn.getAttribute("data-preset-bg"), 10);
      btn.classList.toggle("active", pVal === opacityVal);
    });

    // Checkboxes for individual component background
    const cbTitle = document.getElementById("cb-bg-title");
    if (cbTitle) cbTitle.checked = currentTrackStyle.bgTitle !== false;
    const cbTimers = document.getElementById("cb-bg-timers");
    if (cbTimers) cbTimers.checked = currentTrackStyle.bgTimers !== false;
    const cbTrack = document.getElementById("cb-bg-track");
    if (cbTrack) cbTrack.checked = currentTrackStyle.bgTrack !== false;

    // Footer badge sync
    const bgBadge = document.getElementById("bg-opacity-badge");
    if (bgBadge) {
      bgBadge.innerText = (opacityVal === 0) ? "BG: Off" : `BG: ${opacityVal}%`;
      bgBadge.style.color = (opacityVal > 0) ? "#38bdf8" : "rgba(148, 163, 184, 0.7)";
    }

    // Toggle button visibility between horizontal (Top/Bottom) and vertical (Left/Right)
    document.querySelectorAll(".seg-btn-horiz").forEach((btn) => {
      btn.style.display = isVert ? "none" : "";
    });
    document.querySelectorAll(".seg-btn-vert").forEach((btn) => {
      btn.style.display = isVert ? "" : "none";
    });

    // Segmented buttons for Name and Delta
    document.querySelectorAll("#ctrl-name-pos .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === currentTrackStyle.namePos);
    });
    document.querySelectorAll("#ctrl-delta-pos .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === currentTrackStyle.deltaPos);
    });

    // Angle buttons in modal and toolbar select
    document.querySelectorAll("#ctrl-modal-angle .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === anglePref);
    });
    const angleSelect = document.getElementById("select-split-angle");
    if (angleSelect) angleSelect.value = anglePref;

    // Visible splits sync across toolbar and modal
    const splitPref = localStorage.getItem("livesplit_visible_splits") || "auto";
    const spinInput = document.getElementById("input-visible-splits");
    const modalSpinInput = document.getElementById("modal-input-visible-splits");
    const valBadge = document.getElementById("val-visible-splits");
    const btnAll = document.getElementById("btn-splits-fit-all");
    const btnAuto = document.getElementById("btn-splits-auto");
    const modalBtnAll = document.getElementById("modal-btn-splits-all");
    const modalBtnAuto = document.getElementById("modal-btn-splits-auto");

    const isAll = (splitPref === "all");
    const isAuto = (splitPref === "auto");
    const intVal = parseInt(splitPref, 10);
    const isNum = !isNaN(intVal) && intVal > 0;

    if (btnAll) btnAll.classList.toggle("active", isAll);
    if (modalBtnAll) modalBtnAll.classList.toggle("active", isAll);
    if (btnAuto) btnAuto.classList.toggle("active", isAuto);
    if (modalBtnAuto) modalBtnAuto.classList.toggle("active", isAuto);

    if (isNum) {
      if (spinInput) spinInput.value = intVal;
      if (modalSpinInput) modalSpinInput.value = intVal;
      if (valBadge) valBadge.innerText = `${intVal} splits`;
    } else if (isAll) {
      if (valBadge) valBadge.innerText = "Fit All";
    } else {
      if (valBadge) valBadge.innerText = "Auto";
    }

    // Range sliders & badges
    const sNameFont = document.getElementById("slider-name-font");
    const vNameFont = document.getElementById("val-name-font");
    if (sNameFont && vNameFont) {
      sNameFont.value = currentTrackStyle.nameFontSize;
      vNameFont.innerText = `${currentTrackStyle.nameFontSize}px`;
    }

    const sDeltaFont = document.getElementById("slider-delta-font");
    const vDeltaFont = document.getElementById("val-delta-font");
    if (sDeltaFont && vDeltaFont) {
      sDeltaFont.value = currentTrackStyle.deltaFontSize;
      vDeltaFont.innerText = `${currentTrackStyle.deltaFontSize}px`;
    }

    const sBarHeight = document.getElementById("slider-bar-height");
    const vBarHeight = document.getElementById("val-bar-height");
    if (sBarHeight && vBarHeight) {
      sBarHeight.value = currentTrackStyle.barHeight;
      vBarHeight.innerText = `${currentTrackStyle.barHeight}px`;
    }

    const sDotSize = document.getElementById("slider-dot-size");
    const vDotSize = document.getElementById("val-dot-size");
    if (sDotSize && vDotSize) {
      sDotSize.value = currentTrackStyle.dotSize;
      vDotSize.innerText = `${currentTrackStyle.dotSize}px`;
    }

    // Discard in-run golds on reset checkbox
    const cbDiscard = document.getElementById("cb-discard-golds-reset");
    if (cbDiscard) {
      cbDiscard.checked = (localStorage.getItem("livesplit_discard_golds_on_reset") !== "false");
    }

    // Active Comparison dropdown sync
    const selComp = document.getElementById("select-active-comparison");
    if (selComp && window.getComparisonsList) {
      const comps = window.getComparisonsList();
      const curComp = window.getCurrentComparison ? window.getCurrentComparison() : "Personal Best";
      selComp.innerHTML = "";
      comps.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        let label = c;
        if (c === "Personal Best") label = "Personal Best (PB)";
        else if (c === "Best Segments") label = "Best Segments (Sum of Best)";
        opt.innerText = label;
        if (c === curComp) opt.selected = true;
        selComp.appendChild(opt);
      });
    }

    // Auto-sync with LiveSplit hotkeys checkbox
    const cbSync = document.getElementById("cb-sync-livesplit-hotkeys");
    if (cbSync) {
      cbSync.checked = (localStorage.getItem("livesplit_sync_hotkeys") !== "false");
    }

    // Ghost Runner pills & dropdown sync
    const activeGhosts = window.getActiveGhostComparisons ? window.getActiveGhostComparisons() : (localStorage.getItem("livesplit_active_ghosts") ? JSON.parse(localStorage.getItem("livesplit_active_ghosts")) : [(localStorage.getItem("livesplit_ghost_comparison") || "off")]);
    const activeList = Array.isArray(activeGhosts) ? activeGhosts.filter(g => g && g !== "off") : [];
    const activeKey = activeList.length === 0 ? "off" : activeList.join(",");

    // Sync modal pills
    const pillRow = document.getElementById("ghost-pill-row");
    if (pillRow) {
      const pillBtns = pillRow.querySelectorAll(".preset-pill-btn");
      pillBtns.forEach((btn) => {
        const pillVal = btn.getAttribute("data-ghost-pill");
        if (pillVal === "off") {
          btn.classList.toggle("active", activeList.length === 0);
        } else {
          btn.classList.toggle("active", activeList.includes(pillVal));
        }
      });
    }

    // Ghost Runner dropdown sync
    const selGhost = document.getElementById("select-ghost-comparison");
    if (selGhost) {
      selGhost.innerHTML = "";

      const defaultGhostOpts = [
        { val: "off", label: "Off (Disabled)" },
        { val: "wr", label: "World Record (🏆)" },
        { val: "pb", label: "Personal Best (🥈)" },
        { val: "wr,pb", label: "Dual: WR (🏆) + PB (🥈)" },
        { val: "best", label: "Best Segments (⭐)" },
        { val: "wr,best", label: "Dual: WR (🏆) + Best (⭐)" },
        { val: "average", label: "Average Segments (📊)" },
        { val: "worst", label: "Worst Segments (🐢)" }
      ];

      let optionMatched = false;
      defaultGhostOpts.forEach(o => {
        const opt = document.createElement("option");
        opt.value = o.val;
        opt.innerText = o.label;
        const optList = o.val === "off" ? [] : o.val.split(",");
        const isMatch = (o.val === "off" && activeList.length === 0) ||
          (optList.length === activeList.length && optList.every(id => activeList.includes(id)));
        if (isMatch) {
          opt.selected = true;
          optionMatched = true;
        }
        selGhost.appendChild(opt);
      });

      // Add custom comparisons if present (skipping default and WR matches)
      if (window.getComparisonsList) {
        const comps = window.getComparisonsList();
        comps.forEach(c => {
          const low = c.toLowerCase();
          if (
            !["personal best", "best segments", "average segments", "worst segments"].includes(low) &&
            !low.includes("world record") && low !== "wr"
          ) {
            const opt = document.createElement("option");
            opt.value = c;
            opt.innerText = `👤 ${c}`;
            if (activeList.length === 1 && activeList[0] === c) {
              opt.selected = true;
              optionMatched = true;
            }
            selGhost.appendChild(opt);
          }
        });
      }

      // If activeList has custom multi-selection not in default presets, add dynamic option
      if (!optionMatched && activeList.length > 0) {
        const customOpt = document.createElement("option");
        customOpt.value = activeKey;
        customOpt.innerText = `Custom: ${activeList.join(" + ")}`;
        customOpt.selected = true;
        selGhost.appendChild(customOpt);
      }
    }

    // Ghost Runner pin length slider
    const sGhostLen = document.getElementById("slider-ghost-pin-length");
    const vGhostLen = document.getElementById("val-ghost-pin-length");
    const pinLenVal = currentTrackStyle.ghostPinLength != null ? currentTrackStyle.ghostPinLength : 16;
    if (sGhostLen && vGhostLen) {
      sGhostLen.value = pinLenVal;
      vGhostLen.innerText = (pinLenVal === 0 ? "0px (On Track)" : `${pinLenVal}px`);
    }

    // Ghost Runner opacity slider
    const sGhostOp = document.getElementById("slider-ghost-opacity");
    const vGhostOp = document.getElementById("val-ghost-opacity");
    const ghostOpVal = parseInt(localStorage.getItem("livesplit_ghost_opacity") || "85", 10);
    if (sGhostOp && vGhostOp) {
      sGhostOp.value = ghostOpVal;
      vGhostOp.innerText = `${ghostOpVal}%`;
    }
  }

  function openTrackModal() {
    const modal = document.getElementById("track-modal");
    if (modal) {
      modal.style.display = "flex";
      setTimeout(() => modal.classList.add("is-open"), 10);
      syncTrackModalUI();
    }
  }

  function closeTrackModal() {
    const modal = document.getElementById("track-modal");
    if (modal) {
      modal.classList.remove("is-open");
      setTimeout(() => {
        modal.style.display = "none";
      }, 200);
      saveTrackStyle();
    }
  }

  function resetTrackStyle() {
    currentTrackStyle = Object.assign({}, DEFAULT_TRACK_STYLE);
    saveTrackStyle();
    applyTrackStyle();
  }

  function applyComponentLayout(compId) {
    const el = document.getElementById(`hud-comp-${compId}`);
    if (!el) return;
    const state = layoutState[compId];
    if (!state) return;

    // Visibility
    if (state.visible === false) {
      if (isEditMode) {
        el.classList.add("edit-hidden");
        el.classList.remove("is-hidden");
      } else {
        el.classList.remove("edit-hidden");
        el.classList.add("is-hidden");
      }
    } else {
      el.classList.remove("edit-hidden");
      el.classList.remove("is-hidden");
    }

    // Scale display badge
    const badge = el.querySelector(".hud-scale-badge");
    if (badge) {
      badge.innerText = `${Math.round(state.scale * 100)}%`;
    }

    // Toolbar checkbox sync
    const cb = document.getElementById(`cb-toggle-${compId}`);
    if (cb) {
      cb.checked = state.visible !== false;
    }

    // Dock logic for track
    if (compId === "track") {
      const isVert = (currentTrackStyle && currentTrackStyle.orientation === "vertical");
      const dockBtn = document.getElementById("btn-dock-track");

      el.classList.remove("docked-bottom", "docked-left", "docked-right");

      if (isVert) {
        if (state.docked === "left" || state.docked === "bottom") {
          el.classList.add("docked-left");
          el.style.left = "0px";
          el.style.right = "auto";
          el.style.top = "0px";
          el.style.bottom = "0px";
          el.style.width = "340px";
          el.style.height = "100%";
          el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
          el.style.transformOrigin = "top left";
          if (dockBtn) dockBtn.innerText = "⚓ Docked";
        } else if (state.docked === "right") {
          el.classList.add("docked-right");
          el.style.right = "0px";
          el.style.left = "auto";
          el.style.top = "0px";
          el.style.bottom = "0px";
          el.style.width = "340px";
          el.style.height = "100%";
          el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
          el.style.transformOrigin = "top right";
          if (dockBtn) dockBtn.innerText = "⚓ Docked";
        } else {
          el.style.left = `${state.x}px`;
          el.style.top = `${state.y}px`;
          el.style.bottom = "";
          el.style.right = "";
          el.style.width = "340px";
          el.style.height = `${Math.min((window.innerHeight || 1080) - state.y, 800)}px`;
          el.style.transform = `scale(${state.scale})`;
          el.style.transformOrigin = "top left";
          if (dockBtn) dockBtn.innerText = "⛵ Float";
        }
        return;
      }

      if (state.docked === "bottom" || state.docked === "left" || state.docked === "right") {
        el.classList.add("docked-bottom");
        el.style.left = "0px";
        el.style.right = "auto";
        el.style.top = "";
        el.style.bottom = "0px";
        el.style.width = "100%";
        el.style.height = "";
        el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
        el.style.transformOrigin = "bottom center";
        if (dockBtn) dockBtn.innerText = "⚓ Docked";
      } else {
        el.style.left = `${state.x}px`;
        el.style.top = `${state.y}px`;
        el.style.bottom = "";
        el.style.right = "";
        el.style.width = `calc(100vw - ${Math.max(0, state.x)}px)`;
        el.style.height = "";
        el.style.transform = `scale(${state.scale})`;
        el.style.transformOrigin = "top left";
        if (dockBtn) dockBtn.innerText = "⛵ Float";
      }
      return;
    }

    // Standard floating component (title, timers)
    el.style.left = `${state.x}px`;
    el.style.top = `${state.y}px`;
    el.style.bottom = "";
    el.style.transform = `scale(${state.scale})`;
    el.style.transformOrigin = "top left";
  }

  function applyAllLayouts() {
    for (const id of COMPONENTS) {
      applyComponentLayout(id);
    }
  }

  function setEditMode(enabled) {
    isEditMode = !!enabled;
    if (isEditMode) {
      document.body.classList.add("edit-mode");
    } else {
      document.body.classList.remove("edit-mode");
      saveLayout();
    }
    applyAllLayouts();
  }

  function toggleEditMode() {
    setEditMode(!isEditMode);
  }

  function resetLayout() {
    layoutState = getDefaultLayout();
    saveLayout();
    applyAllLayouts();
  }

  function parseUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view"); // 'title' | 'timers' | 'track' | 'all'
    const edit = params.get("edit"); // '1' | 'true'
    const hide = params.get("hide"); // 'title,timers'

    if (view) {
      const lower = view.toLowerCase().trim();
      if (lower === "title") {
        layoutState.title.visible = true;
        layoutState.timers.visible = false;
        layoutState.track.visible = false;
      } else if (lower === "timers") {
        layoutState.title.visible = false;
        layoutState.timers.visible = true;
        layoutState.track.visible = false;
      } else if (lower === "track") {
        layoutState.title.visible = false;
        layoutState.timers.visible = false;
        layoutState.track.visible = true;
      }
    }

    if (hide) {
      const hideList = hide.split(",").map((s) => s.trim().toLowerCase());
      for (const id of hideList) {
        if (layoutState[id]) {
          layoutState[id].visible = false;
        }
      }
    }

    const splitsParam = params.get("splits");
    const angleParam = params.get("angle");

    if (splitsParam) {
      setVisibleSplits(splitsParam.toLowerCase().trim());
    }
    if (angleParam) {
      const a = angleParam.toLowerCase().trim();
      localStorage.setItem("livesplit_split_angle", (a === "40" || a === "angled") ? "angled" : ((a === "flat" || a === "horizontal") ? "horizontal" : "auto"));
    }

    // Track style URL parameters
    const orientParam = params.get("orient") || params.get("orientation");
    const namePosParam = params.get("namepos");
    const deltaPosParam = params.get("deltapos");
    const barSizeParam = params.get("barsize");
    const dotSizeParam = params.get("dotsize");
    const nameFontParam = params.get("namefont");
    const deltaFontParam = params.get("deltafont");

    if (currentTrackStyle) {
      if (orientParam) {
        const o = orientParam.toLowerCase().trim();
        if (o === "vertical" || o === "vert" || o === "v") {
          currentTrackStyle.orientation = "vertical";
          if (currentTrackStyle.namePos === "top" || currentTrackStyle.namePos === "bottom") currentTrackStyle.namePos = "left";
          if (currentTrackStyle.deltaPos === "top" || currentTrackStyle.deltaPos === "bottom") currentTrackStyle.deltaPos = "right";
        } else if (o === "horizontal" || o === "horiz" || o === "h") {
          currentTrackStyle.orientation = "horizontal";
        }
      }
      if (namePosParam) {
        const np = namePosParam.toLowerCase().trim();
        if (["top", "bottom", "left", "right"].includes(np)) currentTrackStyle.namePos = np;
      }
      if (deltaPosParam) {
        const dp = deltaPosParam.toLowerCase().trim();
        if (["top", "bottom", "left", "right"].includes(dp)) currentTrackStyle.deltaPos = dp;
      }
      if (barSizeParam) currentTrackStyle.barHeight = parseInt(barSizeParam, 10) || currentTrackStyle.barHeight;
      if (dotSizeParam) currentTrackStyle.dotSize = parseInt(dotSizeParam, 10) || currentTrackStyle.dotSize;
      if (nameFontParam) currentTrackStyle.nameFontSize = parseInt(nameFontParam, 10) || currentTrackStyle.nameFontSize;
      if (deltaFontParam) currentTrackStyle.deltaFontSize = parseInt(deltaFontParam, 10) || currentTrackStyle.deltaFontSize;

      const ghostLenParam = params.get("ghostlen") || params.get("ghostlength") || params.get("pinlen");
      if (ghostLenParam) {
        const num = parseInt(ghostLenParam, 10);
        if (!isNaN(num)) currentTrackStyle.ghostPinLength = Math.max(0, Math.min(60, num));
      }

      const bgParam = params.get("bg");
      const bgBlurParam = params.get("bgblur");
      if (bgParam) {
        const b = bgParam.toLowerCase().trim();
        if (b === "0" || b === "off" || b === "none" || b === "false") currentTrackStyle.bgOpacity = 0;
        else if (b === "subtle" || b === "light") currentTrackStyle.bgOpacity = 35;
        else if (b === "glass" || b === "medium") currentTrackStyle.bgOpacity = 55;
        else if (b === "dark" || b === "solid") currentTrackStyle.bgOpacity = 80;
        else {
          const num = parseInt(b, 10);
          if (!isNaN(num)) currentTrackStyle.bgOpacity = Math.max(0, Math.min(95, num));
        }
      }
      if (bgBlurParam) {
        const num = parseInt(bgBlurParam, 10);
        if (!isNaN(num)) currentTrackStyle.bgBlur = Math.max(0, Math.min(25, num));
      }
    }

    const ghostParam = params.get("ghost");
    if (ghostParam) {
      const g = ghostParam.toLowerCase().trim();
      if (window.setGhostComparison) window.setGhostComparison(g);
      else localStorage.setItem("livesplit_ghost_comparison", g);
    }

    if (edit === "1" || edit === "true") {
      setTimeout(() => setEditMode(true), 100);
    }
  }

  function setupPointerListeners() {
    COMPONENTS.forEach((id) => {
      const el = document.getElementById(`hud-comp-${id}`);
      if (!el) return;

      // Drag listener on the component
      el.addEventListener("pointerdown", (e) => {
        if (!isEditMode) return;
        // Do not drag if interacting with buttons, inputs, or resize handle
        if (e.target.closest("button") || e.target.closest("input") || e.target.classList.contains("hud-resize-handle")) {
          return;
        }

        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add("is-dragging");

        const state = layoutState[id];
        activePointerOp = {
          type: "drag",
          compId: id,
          pointerId: e.pointerId,
          element: el,
          startX: e.clientX,
          startY: e.clientY,
          origX: state.x,
          origY: state.y,
          wasDocked: state.docked
        };
      });

      // Resize handle listener
      const resizeHandle = el.querySelector(".hud-resize-handle");
      if (resizeHandle) {
        resizeHandle.addEventListener("pointerdown", (e) => {
          if (!isEditMode) return;
          e.preventDefault();
          e.stopPropagation();
          resizeHandle.setPointerCapture(e.pointerId);
          el.classList.add("is-scaling");

          const state = layoutState[id];
          activePointerOp = {
            type: "scale",
            compId: id,
            pointerId: e.pointerId,
            element: el,
            resizeHandle: resizeHandle,
            startX: e.clientX,
            origScale: state.scale
          };
        });
      }

      // Visibility toggle in header
      const toggleBtn = el.querySelector('[data-action="toggle-visibility"]');
      if (toggleBtn) {
        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const state = layoutState[id];
          state.visible = !state.visible;
          applyComponentLayout(id);
          saveLayout();
        });
      }
    });

    // Track dock toggle button
    const trackDockBtn = document.getElementById("btn-dock-track");
    if (trackDockBtn) {
      trackDockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const state = layoutState.track;
        const isVert = (currentTrackStyle && currentTrackStyle.orientation === "vertical");
        if (isVert) {
          if (state.docked === "left" || state.docked === "right" || state.docked === "bottom") {
            state.docked = "none";
            state.x = 42;
            state.y = 80;
          } else {
            state.docked = "left";
            state.x = 0;
            state.y = 0;
          }
        } else {
          if (state.docked === "bottom" || state.docked === "left" || state.docked === "right") {
            state.docked = "none";
            state.x = 42;
            state.y = Math.max(0, window.innerHeight - 150);
          } else {
            state.docked = "bottom";
            state.x = 0;
            state.y = Math.max(0, window.innerHeight - 90);
          }
        }
        applyComponentLayout("track");
        saveLayout();
      });
    }

    // Global pointermove
    window.addEventListener("pointermove", (e) => {
      if (!activePointerOp) return;

      if (activePointerOp.type === "drag") {
        const dx = e.clientX - activePointerOp.startX;
        const dy = e.clientY - activePointerOp.startY;
        const state = layoutState[activePointerOp.compId];

        const w = window.innerWidth || 1920;
        const h = window.innerHeight || 1080;

        let newX = Math.max(0, Math.min(w - 80, activePointerOp.origX + dx));
        let newY = Math.max(0, Math.min(h - 50, activePointerOp.origY + dy));

        // Snapping for track component to bottom dock or left/right dock
        if (activePointerOp.compId === "track") {
          const isVert = (currentTrackStyle && currentTrackStyle.orientation === "vertical");
          if (isVert) {
            if (newX <= 100) {
              state.docked = "left";
              newX = 0;
              newY = 0;
            } else if (newX >= w - 380) {
              state.docked = "right";
              newX = w - 340;
              newY = 0;
            } else {
              state.docked = "none";
            }
          } else {
            if (newY >= h - 140) {
              state.docked = "bottom";
              newX = 0;
              newY = h - 90;
            } else {
              state.docked = "none";
            }
          }
        }

        state.x = Math.round(newX);
        state.y = Math.round(newY);
        applyComponentLayout(activePointerOp.compId);
      } else if (activePointerOp.type === "scale") {
        const dx = e.clientX - activePointerOp.startX;
        const state = layoutState[activePointerOp.compId];
        const deltaScale = dx / 180;
        const newScale = Math.min(2.5, Math.max(0.4, activePointerOp.origScale + deltaScale));
        state.scale = Math.round(newScale * 100) / 100;
        applyComponentLayout(activePointerOp.compId);
      }
    });

    // Global pointerup
    window.addEventListener("pointerup", (e) => {
      if (!activePointerOp) return;

      if (activePointerOp.element) {
        activePointerOp.element.classList.remove("is-dragging", "is-scaling");
        try {
          if (activePointerOp.element.hasPointerCapture(e.pointerId)) {
            activePointerOp.element.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
      }
      if (activePointerOp.resizeHandle) {
        try {
          if (activePointerOp.resizeHandle.hasPointerCapture(e.pointerId)) {
            activePointerOp.resizeHandle.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
      }

      activePointerOp = null;
      saveLayout();
    });
  }

  function setupToolbarAndControls() {
    // Toolbar buttons
    document.getElementById("btn-lock-layout")?.addEventListener("click", () => setEditMode(false));
    document.getElementById("btn-reset-layout")?.addEventListener("click", resetLayout);
    document.getElementById("layout-edit-btn")?.addEventListener("click", toggleEditMode);

    // Toolbar checkboxes
    COMPONENTS.forEach((id) => {
      const cb = document.getElementById(`cb-toggle-${id}`);
      if (cb) {
        cb.addEventListener("change", () => {
          layoutState[id].visible = cb.checked;
          applyComponentLayout(id);
          saveLayout();
        });
      }
    });

    // Toolbar Spin Box & Pills for Visible Splits
    document.getElementById("btn-splits-dec")?.addEventListener("click", () => {
      const cur = parseInt(localStorage.getItem("livesplit_visible_splits"), 10) || 8;
      setVisibleSplits(Math.max(2, cur - 1));
    });
    document.getElementById("btn-splits-inc")?.addEventListener("click", () => {
      const cur = parseInt(localStorage.getItem("livesplit_visible_splits"), 10) || 8;
      setVisibleSplits(Math.min(60, cur + 1));
    });

    const spinInput = document.getElementById("input-visible-splits");
    if (spinInput) {
      spinInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 2 && val <= 60) setVisibleSplits(val);
      });
      spinInput.addEventListener("change", (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 2) val = 2;
        if (val > 60) val = 60;
        e.target.value = val;
        setVisibleSplits(val);
      });
    }

    document.getElementById("btn-splits-fit-all")?.addEventListener("click", () => setVisibleSplits("all"));
    document.getElementById("btn-splits-auto")?.addEventListener("click", () => setVisibleSplits("auto"));

    // Modal Spin Box & Pills
    document.getElementById("modal-splits-dec")?.addEventListener("click", () => {
      const cur = parseInt(localStorage.getItem("livesplit_visible_splits"), 10) || 8;
      setVisibleSplits(Math.max(2, cur - 1));
    });
    document.getElementById("modal-splits-inc")?.addEventListener("click", () => {
      const cur = parseInt(localStorage.getItem("livesplit_visible_splits"), 10) || 8;
      setVisibleSplits(Math.min(60, cur + 1));
    });

    const modalSpinInput = document.getElementById("modal-input-visible-splits");
    if (modalSpinInput) {
      modalSpinInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 2 && val <= 60) setVisibleSplits(val);
      });
      modalSpinInput.addEventListener("change", (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 2) val = 2;
        if (val > 60) val = 60;
        e.target.value = val;
        setVisibleSplits(val);
      });
    }

    document.getElementById("modal-btn-splits-all")?.addEventListener("click", () => setVisibleSplits("all"));
    document.getElementById("modal-btn-splits-auto")?.addEventListener("click", () => setVisibleSplits("auto"));

    // Toolbar Angle Select
    const angleSelect = document.getElementById("select-split-angle");
    if (angleSelect) {
      angleSelect.addEventListener("change", () => {
        const val = angleSelect.value;
        localStorage.setItem("livesplit_split_angle", val);
        if (val === "angled") {
          currentTrackStyle.deltaPos = (currentTrackStyle.namePos === "top") ? "bottom" : "top";
          saveTrackStyle();
        }
        applyTrackStyle();
        if (window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
      });
    }

    // Modal Angle Segmented Control
    document.querySelectorAll("#ctrl-modal-angle .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-val");
        localStorage.setItem("livesplit_split_angle", val);
        if (val === "angled") {
          currentTrackStyle.deltaPos = (currentTrackStyle.namePos === "top") ? "bottom" : "top";
          saveTrackStyle();
        }
        applyTrackStyle();
        if (window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
      });
    });

    // Track Orientation controls
    document.querySelectorAll("#ctrl-track-orient .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setTrackOrientation(btn.getAttribute("data-val"));
      });
    });
    document.getElementById("track-orient-badge")?.addEventListener("click", () => {
      const cur = currentTrackStyle.orientation || "horizontal";
      setTrackOrientation(cur === "vertical" ? "horizontal" : "vertical");
    });

    // Track Styler modal triggers
    document.getElementById("btn-open-track-modal")?.addEventListener("click", openTrackModal);
    document.getElementById("track-style-badge")?.addEventListener("click", openTrackModal);
    document.getElementById("btn-close-track-modal")?.addEventListener("click", closeTrackModal);
    document.getElementById("btn-save-track-style")?.addEventListener("click", closeTrackModal);
    document.getElementById("btn-reset-track-style")?.addEventListener("click", resetTrackStyle);

    // Modal backdrop click to close
    document.getElementById("track-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "track-modal") {
        closeTrackModal();
      }
    });

    // Segmented controls for Name and Delta positions (enforce opposing sides when angled)
    document.querySelectorAll("#ctrl-name-pos .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTrackStyle.namePos = btn.getAttribute("data-val");
        const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";
        const track = document.getElementById("track");
        const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));
        if (isAngled) {
          currentTrackStyle.deltaPos = (currentTrackStyle.namePos === "top") ? "bottom" : "top";
        }
        applyTrackStyle();
        saveTrackStyle();
      });
    });

    document.querySelectorAll("#ctrl-delta-pos .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const anglePref = localStorage.getItem("livesplit_split_angle") || "auto";
        const track = document.getElementById("track");
        const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));
        if (isAngled) {
          currentTrackStyle.deltaPos = btn.getAttribute("data-val");
          currentTrackStyle.namePos = (currentTrackStyle.deltaPos === "top") ? "bottom" : "top";
        } else {
          currentTrackStyle.deltaPos = btn.getAttribute("data-val");
        }
        applyTrackStyle();
        saveTrackStyle();
      });
    });

    // Background Opacity slider
    const sliderBgOpacity = document.getElementById("slider-bg-opacity");
    if (sliderBgOpacity) {
      sliderBgOpacity.addEventListener("input", () => {
        currentTrackStyle.bgOpacity = parseInt(sliderBgOpacity.value, 10);
        const vBg = document.getElementById("val-bg-opacity");
        if (vBg) vBg.innerText = (currentTrackStyle.bgOpacity === 0) ? "0% (Off)" : `${currentTrackStyle.bgOpacity}%`;
        applyTrackStyle();
      });
      sliderBgOpacity.addEventListener("change", saveTrackStyle);
    }

    // Background Blur slider
    const sliderBgBlur = document.getElementById("slider-bg-blur");
    if (sliderBgBlur) {
      sliderBgBlur.addEventListener("input", () => {
        currentTrackStyle.bgBlur = parseInt(sliderBgBlur.value, 10);
        const vBlur = document.getElementById("val-bg-blur");
        if (vBlur) vBlur.innerText = `${currentTrackStyle.bgBlur}px`;
        applyTrackStyle();
      });
      sliderBgBlur.addEventListener("change", saveTrackStyle);
    }

    // Background Preset buttons
    document.querySelectorAll(".preset-pill-btn[data-preset-bg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = parseInt(btn.getAttribute("data-preset-bg"), 10);
        if (!isNaN(val)) {
          currentTrackStyle.bgOpacity = val;
          applyTrackStyle();
          saveTrackStyle();
        }
      });
    });

    // Ghost Runner Pill Buttons
    document.querySelectorAll("#ghost-pill-row .preset-pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pillVal = btn.getAttribute("data-ghost-pill");
        if (pillVal) {
          if (window.toggleGhostComparison) {
            window.toggleGhostComparison(pillVal);
          }
        }
      });
    });

    // Component background checkboxes
    document.getElementById("cb-bg-title")?.addEventListener("change", (e) => {
      currentTrackStyle.bgTitle = e.target.checked;
      applyTrackStyle();
      saveTrackStyle();
    });
    document.getElementById("cb-bg-timers")?.addEventListener("change", (e) => {
      currentTrackStyle.bgTimers = e.target.checked;
      applyTrackStyle();
      saveTrackStyle();
    });
    document.getElementById("cb-bg-track")?.addEventListener("change", (e) => {
      currentTrackStyle.bgTrack = e.target.checked;
      applyTrackStyle();
      saveTrackStyle();
    });

    // Footer BG badge click to cycle presets: 55% -> 80% -> 0% -> 35% -> 55%
    document.getElementById("bg-opacity-badge")?.addEventListener("click", () => {
      const presets = [55, 80, 0, 35];
      const cur = currentTrackStyle.bgOpacity != null ? currentTrackStyle.bgOpacity : 55;
      const idx = presets.indexOf(cur);
      const nextVal = (idx !== -1) ? presets[(idx + 1) % presets.length] : 55;
      currentTrackStyle.bgOpacity = nextVal;
      applyTrackStyle();
      saveTrackStyle();
    });

    // Discard in-run golds on reset checkbox listener
    document.getElementById("cb-discard-golds-reset")?.addEventListener("change", (e) => {
      localStorage.setItem("livesplit_discard_golds_on_reset", e.target.checked ? "true" : "false");
    });

    // Active comparison dropdown listener
    document.getElementById("select-active-comparison")?.addEventListener("change", (e) => {
      if (window.applyActiveComparison) {
        window.applyActiveComparison(e.target.value, true);
      }
    });

    // Auto-sync with LiveSplit hotkeys listener
    document.getElementById("cb-sync-livesplit-hotkeys")?.addEventListener("change", (e) => {
      localStorage.setItem("livesplit_sync_hotkeys", e.target.checked ? "true" : "false");
    });

    // Ghost Runner dropdown listener
    document.getElementById("select-ghost-comparison")?.addEventListener("change", (e) => {
      if (window.setGhostComparison) {
        window.setGhostComparison(e.target.value);
      } else {
        localStorage.setItem("livesplit_ghost_comparison", e.target.value);
      }
    });

    // Ghost Runner pin length slider listener
    const sliderGhostLen = document.getElementById("slider-ghost-pin-length");
    if (sliderGhostLen) {
      sliderGhostLen.addEventListener("input", () => {
        const val = parseInt(sliderGhostLen.value, 10);
        currentTrackStyle.ghostPinLength = val;
        const valBadge = document.getElementById("val-ghost-pin-length");
        if (valBadge) valBadge.innerText = (val === 0 ? "0px (On Track)" : `${val}px`);
        applyTrackStyle();
      });
      sliderGhostLen.addEventListener("change", saveTrackStyle);
    }

    // Ghost Runner opacity slider listener
    const sliderGhostOp = document.getElementById("slider-ghost-opacity");
    if (sliderGhostOp) {
      sliderGhostOp.addEventListener("input", () => {
        const valBadge = document.getElementById("val-ghost-opacity");
        if (valBadge) valBadge.innerText = `${sliderGhostOp.value}%`;
        if (window.setGhostOpacity) {
          window.setGhostOpacity(sliderGhostOp.value);
        }
      });
      sliderGhostOp.addEventListener("change", () => {
        localStorage.setItem("livesplit_ghost_opacity", sliderGhostOp.value);
      });
    }

    // Live slider input listeners
    const sliderNameFont = document.getElementById("slider-name-font");
    if (sliderNameFont) {
      sliderNameFont.addEventListener("input", () => {
        currentTrackStyle.nameFontSize = parseInt(sliderNameFont.value, 10);
        document.getElementById("val-name-font").innerText = `${sliderNameFont.value}px`;
        applyTrackStyle();
      });
      sliderNameFont.addEventListener("change", saveTrackStyle);
    }

    const sliderDeltaFont = document.getElementById("slider-delta-font");
    if (sliderDeltaFont) {
      sliderDeltaFont.addEventListener("input", () => {
        currentTrackStyle.deltaFontSize = parseInt(sliderDeltaFont.value, 10);
        document.getElementById("val-delta-font").innerText = `${sliderDeltaFont.value}px`;
        applyTrackStyle();
      });
      sliderDeltaFont.addEventListener("change", saveTrackStyle);
    }

    const sliderBarHeight = document.getElementById("slider-bar-height");
    if (sliderBarHeight) {
      sliderBarHeight.addEventListener("input", () => {
        currentTrackStyle.barHeight = parseInt(sliderBarHeight.value, 10);
        document.getElementById("val-bar-height").innerText = `${sliderBarHeight.value}px`;
        applyTrackStyle();
      });
      sliderBarHeight.addEventListener("change", saveTrackStyle);
    }

    const sliderDotSize = document.getElementById("slider-dot-size");
    if (sliderDotSize) {
      sliderDotSize.addEventListener("input", () => {
        currentTrackStyle.dotSize = parseInt(sliderDotSize.value, 10);
        document.getElementById("val-dot-size").innerText = `${sliderDotSize.value}px`;
        applyTrackStyle();
      });
      sliderDotSize.addEventListener("change", saveTrackStyle);
    }

    // Keyboard Hotkeys: 'E' / 'F2' toggles edit mode, 'Escape' exits modal or edit mode
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

      if (e.key === "e" || e.key === "E" || e.key === "F2") {
        e.preventDefault();
        toggleEditMode();
      } else if (e.key === "Escape") {
        const modal = document.getElementById("track-modal");
        if (modal && modal.classList.contains("is-open")) {
          e.preventDefault();
          closeTrackModal();
        } else if (isEditMode) {
          e.preventDefault();
          setEditMode(false);
        }
      }
    });

    // Responsive window resize clamping
    window.addEventListener("resize", () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      for (const id of COMPONENTS) {
        const state = layoutState[id];
        if (state.docked === "bottom" && id === "track") {
          state.y = Math.max(0, h - 90);
        } else {
          state.x = Math.max(0, Math.min(w - 80, state.x));
          state.y = Math.max(0, Math.min(h - 50, state.y));
        }
        applyComponentLayout(id);
      }

      if (window.updateTrackDensityAndAngle) {
        window.updateTrackDensityAndAngle();
      }
    });
  }

  // Initialize layout engine
  window.addEventListener("DOMContentLoaded", () => {
    layoutState = loadSavedLayout();
    currentTrackStyle = loadSavedTrackStyle();
    parseUrlParameters();
    applyAllLayouts();
    applyTrackStyle();
    setupPointerListeners();
    setupToolbarAndControls();
  });

  // Export layout helpers globally if needed
  window.hudLayout = {
    getState: () => layoutState,
    getTrackStyle: () => currentTrackStyle,
    openTrackModal,
    closeTrackModal,
    resetTrackStyle,
    applyTrackStyle,
    saveTrackStyle,
    syncTrackModalUI,
    setVisibleSplits,
    setTrackOrientation,
    setEditMode,
    resetLayout,
    applyAllLayouts
  };
})();
