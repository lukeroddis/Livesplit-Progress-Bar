/**
 * layout.js - Interactive HUD Component Layout & Positioning Engine
 * Supports drag & drop positioning, proportional scaling, visibility toggling,
 * persistence via localStorage, and standalone OBS URL views (?view=title|timers|track).
 */

(function () {
  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const STORAGE_KEY = STORAGE_KEYS.HUD_LAYOUT;
  const TRACK_STYLE_KEY = STORAGE_KEYS.TRACK_STYLE;
  const COMPONENTS = window.LiveSplit.LayoutEngine.COMPONENTS;

  const DEFAULT_TRACK_STYLE = window.LiveSplit.TrackStyle.DEFAULT_TRACK_STYLE;

  const LOGO_STORAGE_KEY = STORAGE_KEYS.CUSTOM_LOGO;

  let layoutState = null;
  let currentTrackStyle = null;
  let isEditMode = false;

  let gameLogoController = null;
  function getGameLogoController() {
    if (!gameLogoController && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.GameLogo) {
      gameLogoController = window.LiveSplit.GameLogo.createGameLogo({
        storageKey: LOGO_STORAGE_KEY,
        getLogoHeight: () => (currentTrackStyle && currentTrackStyle.logoHeight) || 60
      });
    }
    return gameLogoController;
  }

  function applyGameLogo(src, height) {
    const c = getGameLogoController();
    return c ? c.applyGameLogo(src, height) : undefined;
  }

  function removeGameLogo() {
    const c = getGameLogoController();
    if (c) c.removeGameLogo();
  }

  function saveGameLogo(src) {
    const c = getGameLogoController();
    if (c) c.saveGameLogo(src);
  }

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
        docked: "none",
        anchor: "auto"
      },
      track: {
        x: 0,
        y: Math.max(0, h - 90),
        scale: 1.0,
        visible: true,
        docked: "bottom"
      },
      leaderboard: {
        x: 42,
        y: 110,
        scale: 1.0,
        visible: true,
        docked: "none"
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
        if (!parsed.leaderboard) {
          try {
            const dedicated = localStorage.getItem(STORAGE_KEYS.LEADERBOARD_LAYOUT);
            if (dedicated) {
              merged.leaderboard = Object.assign({}, defaults.leaderboard, JSON.parse(dedicated));
            }
          } catch (_) {}
        }
        const savedAnchor = localStorage.getItem(STORAGE_KEYS.TIMER_ANCHOR);
        if (savedAnchor && merged.timers) {
          merged.timers.anchor = savedAnchor;
        }
        return merged;
      }
    } catch (e) {
      console.warn("Failed to load saved layout, using defaults", e);
    }
    const def = getDefaultLayout();
    try {
      const dedicated = localStorage.getItem(STORAGE_KEYS.LEADERBOARD_LAYOUT);
      if (dedicated) {
        def.leaderboard = Object.assign({}, def.leaderboard, JSON.parse(dedicated));
      }
    } catch (_) {}
    return def;
  }

  function saveLayout() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layoutState));
      if (layoutState && layoutState.leaderboard) {
        localStorage.setItem(STORAGE_KEYS.LEADERBOARD_LAYOUT, JSON.stringify(layoutState.leaderboard));
      }
      const activeProf = getActiveProfileName();
      if (activeProf && activeProf !== "Default") {
        const profData = getProfileData(activeProf);
        if (profData) {
          profData.components = Object.assign({}, profData.components || {}, layoutState);
          saveProfileToStorage(activeProf, profData);
        }
      }
    } catch (e) {
      console.warn("Failed to save layout to localStorage", e);
    }
  }

  let trackStyleEngine = null;
  function getTrackStyleEngine() {
    if (!trackStyleEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.TrackStyle) {
      trackStyleEngine = window.LiveSplit.TrackStyle.createTrackStyle({
        getCurrentStyle: () => currentTrackStyle,
        setCurrentStyle: (s) => { currentTrackStyle = s; },
        getLayoutState: () => layoutState,
        saveLayout,
        applyComponentLayout: (id) => applyComponentLayout(id),
        syncTrackModalUI,
        removeGameLogo,
        fitTrackOnScreen,
        storageKey: TRACK_STYLE_KEY
      });
    }
    return trackStyleEngine;
  }

  function loadSavedTrackStyle() {
    const e = getTrackStyleEngine();
    return e ? e.loadSavedStyle() : Object.assign({}, DEFAULT_TRACK_STYLE);
  }

  function saveTrackStyle() {
    const e = getTrackStyleEngine();
    if (e) e.saveStyle(currentTrackStyle);
    else {
      try {
        localStorage.setItem(TRACK_STYLE_KEY, JSON.stringify(currentTrackStyle));
      } catch (err) {
        console.warn("Failed to save track style", err);
      }
    }
  }

  // ============================================================
  // EXTENSIBLE LAYOUT PROFILES & BACKWARD-COMPATIBLE SCHEMAS
  // ============================================================
  let profilesEngine = null;
  function getProfilesEngine() {
    if (!profilesEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.LayoutProfiles) {
      profilesEngine = window.LiveSplit.LayoutProfiles.createLayoutProfiles({
        getDefaultLayout,
        getLayoutState: () => layoutState,
        setLayoutState: (s) => { layoutState = s; },
        getDefaultTrackStyle: () => DEFAULT_TRACK_STYLE,
        getCurrentTrackStyle: () => currentTrackStyle,
        setCurrentTrackStyle: (s) => { currentTrackStyle = s; },
        saveLayout,
        applyAllLayouts,
        saveTrackStyle,
        applyTrackStyle,
        getTimerAnchor,
        setTimerAnchor,
        setVisibleSplits,
        syncTrackModalUI,
        saveGameLogo,
        removeGameLogo,
        COMPONENTS,
        LOGO_STORAGE_KEY
      });
    }
    return profilesEngine;
  }

  function getProfilesList() {
    const e = getProfilesEngine();
    return e ? e.getProfilesList() : ["Default"];
  }

  function getActiveProfileName() {
    const e = getProfilesEngine();
    return e ? e.getActiveProfileName() : "Default";
  }

  function getProfileData(name) {
    const e = getProfilesEngine();
    return e ? e.getProfileData(name) : null;
  }

  function saveProfileToStorage(name, data) {
    const e = getProfilesEngine();
    if (e) e.saveProfileToStorage(name, data);
  }

  function deleteProfileFromStorage(name) {
    const e = getProfilesEngine();
    return e ? e.deleteProfileFromStorage(name) : false;
  }

  function createProfileExport(profileName) {
    const e = getProfilesEngine();
    return e ? e.createProfileExport(profileName) : null;
  }

  function applyProfileData(data, saveAsName) {
    const e = getProfilesEngine();
    if (e) e.applyProfileData(data, saveAsName);
  }

  function loadProfileByName(name) {
    const e = getProfilesEngine();
    return e ? e.loadProfileByName(name) : false;
  }

  function exportProfileToFile(profileName) {
    const e = getProfilesEngine();
    if (e) e.exportProfileToFile(profileName);
  }

  function importProfileFromFile(file) {
    const e = getProfilesEngine();
    return e ? e.importProfileFromFile(file) : Promise.reject(new Error("Profiles engine unavailable"));
  }

  function syncProfileUI() {
    const e = getProfilesEngine();
    if (e) e.syncProfileUI();
  }

  function autoLoadProfileForGame(gameName) {
    const e = getProfilesEngine();
    return e ? e.autoLoadProfileForGame(gameName) : false;
  }

  function setTrackOrientation(orient) {
    const e = getTrackStyleEngine();
    if (e) {
      e.setOrientation(orient);
      return;
    }
    // Fallback if engine not initialized
    if (!currentTrackStyle) currentTrackStyle = loadSavedTrackStyle();
    if (!layoutState) layoutState = loadSavedLayout();
    currentTrackStyle.orientation = (orient === "vertical") ? "vertical" : "horizontal";
    applyComponentLayout("track");
    applyTrackStyle();
    saveTrackStyle();
    syncTrackModalUI();
    const viewport = document.getElementById("track-viewport");
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
    window.LiveSplit.Overlay.refreshTrack?.();
    requestAnimationFrame(() => {
      window.LiveSplit.Overlay.refreshTrack?.();
    });
  }
  window.setTrackOrientation = setTrackOrientation;

  function applyTrackStyle() {
    const e = getTrackStyleEngine();
    if (e) e.applyStyle();
  }

  function setVisibleSplits(val) {
    const e = getTrackStyleEngine();
    if (e) e.setVisibleSplits(val);
  }
  window.setVisibleSplits = setVisibleSplits;

  let layoutModalController = null;
  function getLayoutModalController() {
    if (!layoutModalController && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.LayoutModal) {
      layoutModalController = window.LiveSplit.LayoutModal.createLayoutModal({
        getCurrentTrackStyle: () => currentTrackStyle,
        saveTrackStyle,
        applyTrackStyle,
        resetTrackStyle,
        setTrackOrientation,
        setVisibleSplits,
        getLayoutState: () => layoutState,
        resetLayout,
        setEditMode,
        toggleEditMode,
        isEditMode: () => isEditMode,
        applyComponentLayout: (id) => applyComponentLayout(id),
        getTimerAnchor,
        syncTimerAnchorUI,
        getGameLogoController,
        getProfilesEngine,
        COMPONENTS
      });
    }
    return layoutModalController;
  }

  function syncTrackModalUI() {
    const ctrl = getLayoutModalController();
    if (ctrl) ctrl.syncUI();
  }

  let timerAnchorEngine = null;
  function getTimerAnchorEngine() {
    if (!timerAnchorEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.TimerAnchor) {
      timerAnchorEngine = window.LiveSplit.TimerAnchor.createTimerAnchor({
        getLayoutState: () => layoutState,
        getDefaultLayout,
        saveLayout,
        applyComponentLayout: (id) => applyComponentLayout(id)
      });
    }
    return timerAnchorEngine;
  }

  function getTimerAnchor() {
    const e = getTimerAnchorEngine();
    return e ? e.getAnchor() : ((layoutState && layoutState.timers && layoutState.timers.anchor) || localStorage.getItem(STORAGE_KEYS.TIMER_ANCHOR) || "auto");
  }

  function setTimerAnchor(anchor) {
    const e = getTimerAnchorEngine();
    if (e) {
      e.setAnchor(anchor);
    } else {
      if (anchor !== "auto" && anchor !== "right" && anchor !== "left") return;
      if (!layoutState.timers) layoutState.timers = getDefaultLayout().timers;
      layoutState.timers.anchor = anchor;
      localStorage.setItem(STORAGE_KEYS.TIMER_ANCHOR, anchor);
      applyComponentLayout("timers");
      saveLayout();
      syncTimerAnchorUI();
    }
  }

  function cycleTimerAnchor() {
    const e = getTimerAnchorEngine();
    if (e) e.cycleAnchor();
  }

  function syncTimerAnchorUI() {
    const e = getTimerAnchorEngine();
    if (e) e.syncUI();
  }

  function openWidgetSettings(compId) {
    getLayoutModalController()?.openWidgetSettings(compId);
  }

  function openTrackModal() {
    const ctrl = getLayoutModalController();
    if (ctrl) {
      ctrl.openTrackModal();
      return;
    }
    const modal = document.getElementById("track-modal");
    if (modal) {
      modal.style.display = "flex";
      setTimeout(() => modal.classList.add("is-open"), 10);
      syncTrackModalUI();
    }
  }

  function closeTrackModal() {
    const ctrl = getLayoutModalController();
    if (ctrl) {
      ctrl.closeTrackModal();
      return;
    }
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
    const e = getTrackStyleEngine();
    if (e) {
      e.resetStyle();
    } else {
      currentTrackStyle = Object.assign({}, DEFAULT_TRACK_STYLE);
      saveTrackStyle();
      applyTrackStyle();
      removeGameLogo();
    }
  }

  // Moves/shrinks the track back on screen so its resize handle stays reachable (e.g. after an
  // orientation switch kept a scale that suited the other shape)
  function fitTrackOnScreen() {
    const el = document.getElementById("hud-comp-track");
    const state = layoutState && layoutState.track;
    const drag = window.LiveSplit.LayoutDrag;
    if (!el || !state || !drag) return;
    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;
    const fits = (f) => f.x === state.x && f.y === state.y && f.scale === state.scale;
    if (fits(drag.fitTrackBox(state, el.offsetWidth, el.offsetHeight, w, h))) return;

    // A floating track's size follows its position, so fix it before moving it
    if (!state.docked || state.docked === "none") {
      drag.freezeTrackSize(state, el, !!(currentTrackStyle && currentTrackStyle.orientation === "vertical"));
      applyComponentLayout("track");
    }
    Object.assign(state, drag.fitTrackBox(state, el.offsetWidth, el.offsetHeight, w, h));
    applyComponentLayout("track");
    saveLayout();
  }

  // Shows or hides a HUD component and saves (settings registry visible.* entries)
  function setComponentVisible(compId, visible) {
    if (!COMPONENTS.includes(compId)) return;
    if (!layoutState) layoutState = loadSavedLayout();
    if (!layoutState[compId]) layoutState[compId] = getDefaultLayout()[compId];
    layoutState[compId].visible = !!visible;
    applyComponentLayout(compId);
    saveLayout();
  }

  function applyComponentLayout(compId) {
    const el = document.getElementById(`hud-comp-${compId}`);
    if (!el) return;
    if (!layoutState) layoutState = loadSavedLayout();
    const state = layoutState ? layoutState[compId] : null;
    if (!state) return;

    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;

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
    const badge = document.getElementById(`badge-scale-${compId}`) || el.querySelector(".hud-scale-badge:not(#badge-anchor-timers)");
    if (badge) {
      badge.innerText = `${Math.round(state.scale * 100)}%`;
    }

    // Toolbar checkbox and header hide / show button sync
    const cb = document.getElementById(`cb-toggle-${compId}`);
    if (cb) {
      cb.checked = state.visible !== false;
    }
    const visBtn = el.querySelector('[data-action="toggle-visibility"]');
    if (visBtn) {
      const label = state.visible === false ? "Show widget" : "Hide widget";
      visBtn.textContent = state.visible === false ? "👁" : "✕";
      visBtn.title = label;
      visBtn.setAttribute("aria-label", label);
    }

    // Dock logic for track
    if (compId === "track") {
      const isVert = (currentTrackStyle && currentTrackStyle.orientation === "vertical");
      const dockBtn = document.getElementById("btn-dock-track");

      // A horizontal track's height (set by the resize handle) is the lines its split names may use
      const trackInner = document.getElementById("track");
      if (trackInner) {
        const nameLines = Math.max(1, Math.min(window.LiveSplit.LayoutDrag.MAX_NAME_LINES, Math.round(state.nameLines || 1)));
        trackInner.style.setProperty("--name-lines", String(nameLines));
        trackInner.classList.toggle("wrap-names", !isVert && nameLines > 1);
      }

      el.classList.remove("docked-bottom", "docked-top", "docked-left", "docked-right");
      const isDocked = !!state.docked && state.docked !== "none";
      const side = isDocked ? window.LiveSplit.LayoutDrag.effectiveDockSide(state.docked, isVert) : "none";

      if (isVert) {
        // Width set by the resize handle (room for split text); 340px until resized
        const trackWidth = state.verticalWidth > 0 ? state.verticalWidth : 340;
        el.style.setProperty("--track-width", `${trackWidth}px`);
        if (side === "left") {
          el.classList.add("docked-left");
          el.style.left = "0px";
          el.style.right = "auto";
          el.style.top = "0px";
          el.style.bottom = "0px";
          el.style.width = `${trackWidth}px`;
          el.style.height = "100%";
          el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
          el.style.transformOrigin = "top left";
          if (dockBtn) dockBtn.innerText = "⚓ Docked";
        } else if (side === "right") {
          el.classList.add("docked-right");
          el.style.right = "0px";
          el.style.left = "auto";
          el.style.top = "0px";
          el.style.bottom = "0px";
          el.style.width = `${trackWidth}px`;
          el.style.height = "100%";
          el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
          el.style.transformOrigin = "top right";
          if (dockBtn) dockBtn.innerText = "⚓ Docked";
        } else {
          el.style.left = `${state.x}px`;
          el.style.top = `${state.y}px`;
          el.style.bottom = "";
          el.style.right = "";
          el.style.width = `${trackWidth}px`;
          // A size frozen by dragging/resizing wins; until then it fills down from its position
          el.style.height = `${state.height > 0 ? state.height : Math.min(h - state.y, 800)}px`;
          el.style.transform = `scale(${state.scale})`;
          el.style.transformOrigin = "top left";
          if (dockBtn) dockBtn.innerText = "⛵ Float";
        }
        return;
      }

      if (side === "top" || side === "bottom") {
        el.classList.add(side === "top" ? "docked-top" : "docked-bottom");
        el.style.left = "0px";
        el.style.right = "auto";
        el.style.top = side === "top" ? "0px" : "";
        el.style.bottom = side === "top" ? "" : "0px";
        el.style.width = "100%";
        el.style.height = "";
        el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
        el.style.transformOrigin = `${side} center`;
        if (dockBtn) dockBtn.innerText = "⚓ Docked";
      } else {
        el.style.left = `${state.x}px`;
        el.style.top = `${state.y}px`;
        el.style.bottom = "";
        el.style.right = "";
        // A size frozen by dragging/resizing wins; until then it fills to the right edge
        el.style.width = state.width > 0 ? `${state.width}px` : `calc(100vw - ${Math.max(0, state.x)}px)`;
        el.style.height = "";
        el.style.transform = `scale(${state.scale})`;
        el.style.transformOrigin = "top left";
        if (dockBtn) dockBtn.innerText = "⛵ Float";
      }
      return;
    }

    // Standard floating component (title, timers)
    if (compId === "timers") {
      const anchorPref = getTimerAnchor();
      const compWidth = el.offsetWidth || 300;
      let isRight = false;
      if (anchorPref === "right") {
        isRight = true;
      } else if (anchorPref === "left") {
        isRight = false;
      } else {
        // "auto": intelligently anchor to right if widget center is on right half of screen
        const midPoint = state.x + (compWidth / 2);
        isRight = (midPoint > w / 2);
      }

      if (isRight) {
        const rightPx = (typeof state.right === "number")
          ? state.right
          : Math.max(0, w - (state.x + compWidth));
        el.style.left = "auto";
        el.style.right = `${rightPx}px`;
        el.style.top = `${state.y}px`;
        el.style.bottom = "";
        el.style.transform = `scale(${state.scale})`;
        el.style.transformOrigin = "top right";
      } else {
        el.style.left = `${state.x}px`;
        el.style.right = "auto";
        el.style.top = `${state.y}px`;
        el.style.bottom = "";
        el.style.transform = `scale(${state.scale})`;
        el.style.transformOrigin = "top left";
      }
      return;
    }

    el.style.left = `${state.x}px`;
    el.style.right = "auto";
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
    const rtaBlock = document.getElementById("block-rta");
    const igtBlock = document.getElementById("block-igt");
    if (isEditMode) {
      document.body.classList.add("edit-mode");
      if (rtaBlock) {
        if (!rtaBlock.dataset.origTitle && rtaBlock.title) rtaBlock.dataset.origTitle = rtaBlock.title;
        rtaBlock.removeAttribute("title");
      }
      if (igtBlock) {
        if (!igtBlock.dataset.origTitle && igtBlock.title) igtBlock.dataset.origTitle = igtBlock.title;
        igtBlock.removeAttribute("title");
      }
    } else {
      document.body.classList.remove("edit-mode");
      if (rtaBlock && rtaBlock.dataset.origTitle) {
        rtaBlock.title = rtaBlock.dataset.origTitle;
      }
      if (igtBlock && igtBlock.dataset.origTitle) {
        igtBlock.title = igtBlock.dataset.origTitle;
      }
      saveLayout();
    }
    applyAllLayouts();
    const rc = window.LiveSplit.RaceClient ? (window.LiveSplit.RaceClient.instance || window.LiveSplit.RaceClient) : null;
    if (typeof window.LiveSplit.Leaderboard?.renderLeaderboard === "function") {
      const isSim = rc ? (typeof rc.isSimulating === "function" ? rc.isSimulating() : !!rc.isSimulating) : false;
      const isConn = rc ? (typeof rc.isConnected === "function" ? rc.isConnected() : !!rc.isConnected) : false;
      const entrants = rc ? rc.getRankedEntrants() : [];
      window.LiveSplit.Leaderboard.renderLeaderboard(entrants, isSim, isConn, isEditMode);
    }
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
    if (typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.LayoutParams) {
      window.LiveSplit.LayoutParams.parseUrlParameters({
        getLayoutState: () => layoutState,
        getCurrentTrackStyle: () => currentTrackStyle,
        loadProfileByName,
        setVisibleSplits,
        setTimerAnchor,
        setEditMode,
        applyGameLogo,
        removeGameLogo
      });
      return;
    }
  }

  let layoutDragEngine = null;
  function getLayoutDragEngine() {
    if (!layoutDragEngine && typeof window !== "undefined" && window.LiveSplit && window.LiveSplit.LayoutDrag) {
      layoutDragEngine = window.LiveSplit.LayoutDrag.createLayoutDrag({
        getLayoutState: () => layoutState,
        getCurrentTrackStyle: () => currentTrackStyle,
        isEditMode: () => isEditMode,
        saveLayout,
        applyComponentLayout: (id) => applyComponentLayout(id),
        syncTimerAnchorUI,
        components: COMPONENTS
      });
    }
    return layoutDragEngine;
  }

  function setupPointerListeners() {
    const e = getLayoutDragEngine();
    if (e) {
      e.initPointerListeners();
    }
  }

  function setupToolbarAndControls() {
    const ctrl = getLayoutModalController();
    if (ctrl) {
      ctrl.bindToolbarAndControls();
    }
  }

  // Initialize layout engine
  window.addEventListener("DOMContentLoaded", () => {
    const activeProf = getActiveProfileName();
    const activeData = (activeProf && activeProf !== "Default") ? getProfileData(activeProf) : null;
    if (activeData) {
      applyProfileData(activeData, activeProf);
    } else {
      layoutState = loadSavedLayout();
      currentTrackStyle = loadSavedTrackStyle();
      applyAllLayouts();
      applyTrackStyle();
      const savedLogo = localStorage.getItem(LOGO_STORAGE_KEY);
      if (savedLogo) {
        applyGameLogo(savedLogo);
      }
    }
    parseUrlParameters();
    setupPointerListeners();
    setupToolbarAndControls();
    syncProfileUI();
  });

  // Export layout helpers globally if needed
  window.hudLayout = {
    getState: () => layoutState || (layoutState = loadSavedLayout()),
    getTrackStyle: () => {
      if (!currentTrackStyle) currentTrackStyle = loadSavedTrackStyle();
      return currentTrackStyle;
    },
    saveLayout,
    loadSavedLayout,
    applyComponentLayout,
    setComponentVisible,
    openTrackModal,
    openWidgetSettings,
    closeTrackModal,
    resetTrackStyle,
    applyTrackStyle,
    saveTrackStyle,
    syncTrackModalUI,
    setVisibleSplits,
    setTrackOrientation,
    fitTrackOnScreen,
    setEditMode,
    isEditMode: () => isEditMode,
    resetLayout,
    applyAllLayouts,
    applyGameLogo,
    removeGameLogo,
    saveGameLogo,
    getProfilesList,
    getActiveProfileName,
    loadProfileByName,
    saveProfileToStorage,
    deleteProfileFromStorage,
    createProfileExport,
    applyProfileData,
    exportProfileToFile,
    importProfileFromFile,
    autoLoadProfileForGame,
    syncProfileUI,
    getTimerAnchor,
    setTimerAnchor,
    cycleTimerAnchor,
    syncTimerAnchorUI
  };

  window.setTimerAnchor = setTimerAnchor;
  window.getTimerAnchor = getTimerAnchor;
  window.cycleTimerAnchor = cycleTimerAnchor;
})();
