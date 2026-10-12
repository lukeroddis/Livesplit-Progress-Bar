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
    namePos: "top",        // 'top' | 'bottom'
    deltaPos: "top",       // 'top' | 'bottom'
    nameFontSize: 17,      // px
    deltaFontSize: 15,     // px
    barHeight: 6,          // px
    dotSize: 15            // px
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

  function applyTrackStyle() {
    if (!currentTrackStyle) return;
    const root = document.documentElement;
    const track = document.getElementById("track");
    if (!root || !track) return;

    // Set CSS custom variables
    root.style.setProperty("--bar-height", `${currentTrackStyle.barHeight}px`);
    root.style.setProperty("--dot-size", `${currentTrackStyle.dotSize}px`);
    root.style.setProperty("--name-font-size", `${currentTrackStyle.nameFontSize}px`);
    root.style.setProperty("--delta-font-size", `${currentTrackStyle.deltaFontSize}px`);

    // Remove existing positional classes and set active ones
    track.classList.remove("pos-name-top", "pos-name-bottom", "pos-delta-top", "pos-delta-bottom");
    track.classList.add(`pos-name-${currentTrackStyle.namePos}`, `pos-delta-${currentTrackStyle.deltaPos}`);

    syncTrackModalUI();

    if (window.updateTrackDensityAndAngle) {
      window.updateTrackDensityAndAngle();
    }
  }

  function syncTrackModalUI() {
    if (!currentTrackStyle) return;

    // Segmented buttons
    document.querySelectorAll("#ctrl-name-pos .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === currentTrackStyle.namePos);
    });
    document.querySelectorAll("#ctrl-delta-pos .seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-val") === currentTrackStyle.deltaPos);
    });

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

    // Bottom dock logic for track
    if (compId === "track") {
      const dockBtn = document.getElementById("btn-dock-track");
      if (state.docked === "bottom") {
        el.classList.add("docked-bottom");
        el.style.left = "0px";
        el.style.top = "";
        el.style.bottom = "0px";
        el.style.width = "100%";
        el.style.transform = state.scale !== 1.0 ? `scale(${state.scale})` : "";
        el.style.transformOrigin = "bottom center";
        if (dockBtn) dockBtn.innerText = "⚓ Docked";
      } else {
        el.classList.remove("docked-bottom");
        el.style.left = `${state.x}px`;
        el.style.top = `${state.y}px`;
        el.style.bottom = "";
        el.style.width = `calc(100vw - ${Math.max(0, state.x)}px)`;
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
      localStorage.setItem("livesplit_visible_splits", splitsParam.toLowerCase().trim());
    }
    if (angleParam) {
      const a = angleParam.toLowerCase().trim();
      localStorage.setItem("livesplit_split_angle", (a === "40" || a === "angled") ? "angled" : ((a === "flat" || a === "horizontal") ? "horizontal" : "auto"));
    }

    // Track style URL parameters
    const namePosParam = params.get("namepos");
    const deltaPosParam = params.get("deltapos");
    const barSizeParam = params.get("barsize");
    const dotSizeParam = params.get("dotsize");
    const nameFontParam = params.get("namefont");
    const deltaFontParam = params.get("deltafont");

    if (currentTrackStyle) {
      if (namePosParam) currentTrackStyle.namePos = namePosParam.toLowerCase() === "bottom" ? "bottom" : "top";
      if (deltaPosParam) currentTrackStyle.deltaPos = deltaPosParam.toLowerCase() === "bottom" ? "bottom" : "top";
      if (barSizeParam) currentTrackStyle.barHeight = parseInt(barSizeParam, 10) || currentTrackStyle.barHeight;
      if (dotSizeParam) currentTrackStyle.dotSize = parseInt(dotSizeParam, 10) || currentTrackStyle.dotSize;
      if (nameFontParam) currentTrackStyle.nameFontSize = parseInt(nameFontParam, 10) || currentTrackStyle.nameFontSize;
      if (deltaFontParam) currentTrackStyle.deltaFontSize = parseInt(deltaFontParam, 10) || currentTrackStyle.deltaFontSize;
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
        if (state.docked === "bottom") {
          state.docked = "none";
          state.x = 42;
          state.y = Math.max(0, window.innerHeight - 150);
        } else {
          state.docked = "bottom";
          state.x = 0;
          state.y = Math.max(0, window.innerHeight - 90);
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

        // Snapping for track component to bottom dock
        if (activePointerOp.compId === "track") {
          if (newY >= h - 140) {
            state.docked = "bottom";
            newX = 0;
            newY = h - 90;
          } else {
            state.docked = "none";
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

    // Toolbar selects
    const splitSelect = document.getElementById("select-visible-splits");
    if (splitSelect) {
      splitSelect.addEventListener("change", () => {
        localStorage.setItem("livesplit_visible_splits", splitSelect.value);
        if (window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
      });
    }

    const angleSelect = document.getElementById("select-split-angle");
    if (angleSelect) {
      angleSelect.addEventListener("change", () => {
        localStorage.setItem("livesplit_split_angle", angleSelect.value);
        if (window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
      });
    }

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

    // Segmented controls for Name and Delta positions
    document.querySelectorAll("#ctrl-name-pos .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTrackStyle.namePos = btn.getAttribute("data-val");
        applyTrackStyle();
        saveTrackStyle();
      });
    });

    document.querySelectorAll("#ctrl-delta-pos .seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTrackStyle.deltaPos = btn.getAttribute("data-val");
        applyTrackStyle();
        saveTrackStyle();
      });
    });

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
    setEditMode,
    resetLayout,
    applyAllLayouts
  };
})();
