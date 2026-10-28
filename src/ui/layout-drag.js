/**
 * Speedrun Overlay - Layout Pointer Drag & Scale Engine
 * 
 * Encapsulates:
 * - Pointerdown, pointermove, pointerup/cancel lifecycle for HUD components
 * - Touch & mouse unified drag positioning with pointer capture
 * - Proportional scaling via scale handle drag (clamped 0.4x to 2.5x)
 * - Viewport boundary clamping and coordinate rounding
 * - Free track dragging (docking only via the dock button; dragging a docked track undocks it),
 *   keeping its size fixed and the whole scaled track (and its resize handle) on screen
 * - Dedicated leaderboard header drag support
 * - Dock toggle button handling (#btn-dock-track)
 */

(function () {
  "use strict";

  /**
   * Pure calculation helper for coordinate displacement and viewport clamping.
   */
  function clampCoordinates(origX, origY, dx, dy, viewportWidth, viewportHeight) {
    const w = viewportWidth || (typeof window !== "undefined" ? window.innerWidth : 1920);
    const h = viewportHeight || (typeof window !== "undefined" ? window.innerHeight : 1080);
    const clampedX = Math.max(0, Math.min(w - 80, origX + dx));
    const clampedY = Math.max(0, Math.min(h - 50, origY + dy));
    return { x: Math.round(clampedX), y: Math.round(clampedY) };
  }

  /**
   * Pure calculation helper for delta-based scale factor adjustments.
   */
  function computeScale(origScale, dx) {
    const deltaScale = dx / 180;
    const newScale = Math.min(2.5, Math.max(0.4, origScale + deltaScale));
    return Math.round(newScale * 100) / 100;
  }

  /**
   * Clamps a box's top-left so the whole box (boxW x boxH, already scaled) stays on screen.
   * A box larger than the viewport is pinned to 0 on that axis.
   */
  function clampBoxToViewport(x, y, boxW, boxH, viewportWidth, viewportHeight) {
    return {
      x: Math.round(Math.max(0, Math.min(viewportWidth - boxW, x))),
      y: Math.round(Math.max(0, Math.min(viewportHeight - boxH, y)))
    };
  }

  /**
   * Largest scale (floored to 0.01, within 0.4x-2.5x) at which a top-left-anchored box of unscaled
   * size baseW x baseH placed at (x, y) still fits on screen, so its resize handle stays reachable.
   */
  function maxScaleToFit(x, y, baseW, baseH, viewportWidth, viewportHeight) {
    const fits = [2.5];
    if (baseW > 0) fits.push((viewportWidth - x) / baseW);
    if (baseH > 0) fits.push((viewportHeight - y) / baseH);
    return Math.max(0.4, Math.floor(Math.min(...fits) * 100) / 100);
  }

  function isTrackFloating(state) {
    return !state.docked || state.docked === "none";
  }

  /**
   * Largest scale at which the track (unscaled baseW x baseH) stays on screen: a floating track from
   * its position, a docked one (already spanning the screen edge to edge) anywhere.
   */
  function maxTrackScale(state, baseW, baseH, viewportWidth, viewportHeight) {
    return isTrackFloating(state)
      ? maxScaleToFit(state.x, state.y, baseW, baseH, viewportWidth, viewportHeight)
      : maxScaleToFit(0, 0, baseW, baseH, viewportWidth, viewportHeight);
  }

  /**
   * Moves a floating track back on screen, then shrinks it if it is still too big, so its resize
   * handle is always reachable (e.g. after an orientation switch). Returns { x, y, scale }.
   */
  function fitTrackBox(state, baseW, baseH, viewportWidth, viewportHeight) {
    const scale = state.scale || 1;
    const pos = isTrackFloating(state)
      ? clampBoxToViewport(state.x, state.y, baseW * scale, baseH * scale, viewportWidth, viewportHeight)
      : { x: state.x, y: state.y };
    const maxScale = maxTrackScale(Object.assign({}, state, pos), baseW, baseH, viewportWidth, viewportHeight);
    return { x: pos.x, y: pos.y, scale: Math.min(scale, maxScale) };
  }

  /**
   * Fixes a floating track's stretched dimension (horizontal width / vertical height) at its current
   * unscaled size. Floating, it otherwise fills to the screen edge from its position, so moving it
   * resized it.
   */
  function freezeTrackSize(state, el, isVertical) {
    if (isVertical) {
      if (el.offsetHeight > 0) state.height = el.offsetHeight;
    } else if (el.offsetWidth > 0) {
      state.width = el.offsetWidth;
    }
  }

  function createLayoutDrag(options = {}) {
    const {
      getLayoutState = () => ({}),
      getCurrentTrackStyle = () => null,
      isEditMode = () => false,
      saveLayout = () => {},
      applyComponentLayout = () => {},
      syncTimerAnchorUI = () => {},
      components = window.LiveSplit.LayoutEngine.COMPONENTS
    } = options;

    let activePointerOp = null;

    function getActiveOp() {
      return activePointerOp;
    }

    function isVerticalTrack() {
      const style = getCurrentTrackStyle();
      return !!(style && style.orientation === "vertical");
    }

    function initPointerListeners() {
      components.forEach((id) => {
        const el = document.getElementById(`hud-comp-${id}`);
        if (!el) return;

        // Drag listener on the component
        el.addEventListener("pointerdown", (e) => {
          if (!isEditMode()) return;
          // Do not drag if interacting with buttons, inputs, or resize handle
          if (e.target.closest("button") || e.target.closest("input") || e.target.classList.contains("hud-resize-handle")) {
            return;
          }

          e.preventDefault();
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          el.classList.add("is-dragging");

          const state = getLayoutState()[id];
          if (id === "track" && state) freezeTrackSize(state, el, isVerticalTrack());
          const scale = (state && state.scale) || 1;
          activePointerOp = {
            type: "drag",
            compId: id,
            pointerId: e.pointerId,
            element: el,
            startX: e.clientX,
            startY: e.clientY,
            origX: el.offsetLeft,
            origY: el.offsetTop,
            boxW: el.offsetWidth * scale,
            boxH: el.offsetHeight * scale,
            wasDocked: state ? state.docked : "none"
          };
        });

        // Resize handle listener
        const resizeHandle = el.querySelector(".hud-resize-handle");
        if (resizeHandle) {
          resizeHandle.addEventListener("pointerdown", (e) => {
            if (!isEditMode()) return;
            e.preventDefault();
            e.stopPropagation();
            try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) {}
            el.classList.add("is-scaling");

            const state = getLayoutState()[id];
            if (id === "track" && state) freezeTrackSize(state, el, isVerticalTrack());
            activePointerOp = {
              type: "scale",
              compId: id,
              pointerId: e.pointerId,
              element: el,
              resizeHandle: resizeHandle,
              startX: e.clientX,
              baseW: el.offsetWidth,
              baseH: el.offsetHeight,
              origScale: state ? state.scale : 1
            };
          });
        }

        // Visibility toggle in header
        const toggleBtn = el.querySelector('[data-action="toggle-visibility"]');
        if (toggleBtn) {
          toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const state = getLayoutState()[id];
            if (state) {
              state.visible = !state.visible;
              applyComponentLayout(id);
              saveLayout();
            }
          });
        }
      });

      // Direct drag listener on leaderboard header (.leaderboard-header) anytime
      const lbHeader = document.querySelector(".leaderboard-header");
      const lbComp = document.getElementById("hud-comp-leaderboard");
      if (lbHeader && lbComp) {
        lbHeader.addEventListener("pointerdown", (e) => {
          if (e.target.closest("button") || e.target.closest(".leaderboard-status")) {
            return;
          }

          e.preventDefault();
          try { lbHeader.setPointerCapture(e.pointerId); } catch (_) {}
          lbComp.classList.add("is-dragging");

          const state = getLayoutState().leaderboard;
          activePointerOp = {
            type: "drag",
            compId: "leaderboard",
            pointerId: e.pointerId,
            element: lbComp,
            dragHandle: lbHeader,
            startX: e.clientX,
            startY: e.clientY,
            origX: lbComp.offsetLeft,
            origY: lbComp.offsetTop,
            wasDocked: state ? state.docked : "none"
          };
        });
      }

      // Track dock toggle button
      const trackDockBtn = document.getElementById("btn-dock-track");
      if (trackDockBtn) {
        trackDockBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const layoutState = getLayoutState();
          const state = layoutState ? layoutState.track : null;
          if (!state) return;

          const currentTrackStyle = getCurrentTrackStyle();
          const isVert = (currentTrackStyle && currentTrackStyle.orientation === "vertical");
          const h = (typeof window !== "undefined" && window.innerHeight) || 1080;

          if (isVert) {
            if (state.docked === "left" || state.docked === "right" || state.docked === "bottom") {
              state.docked = "none";
              state.x = 42;
              state.y = 80;
              delete state.height;
            } else {
              state.docked = "left";
              state.x = 0;
              state.y = 0;
            }
          } else {
            if (state.docked === "bottom" || state.docked === "left" || state.docked === "right") {
              state.docked = "none";
              state.x = 42;
              state.y = Math.max(0, h - 150);
              delete state.width;
            } else {
              state.docked = "bottom";
              state.x = 0;
              state.y = Math.max(0, h - 90);
            }
          }

          applyComponentLayout("track");
          saveLayout();
          window.LiveSplit.Overlay.refreshTrack?.();
        });
      }

      // Global pointermove
      window.addEventListener("pointermove", (e) => {
        if (!activePointerOp) return;

        const layoutState = getLayoutState();
        const state = layoutState[activePointerOp.compId];
        if (!state) return;

        const w = (typeof window !== "undefined" && window.innerWidth) || 1920;
        const h = (typeof window !== "undefined" && window.innerHeight) || 1080;

        if (activePointerOp.type === "drag") {
          const dx = e.clientX - activePointerOp.startX;
          const dy = e.clientY - activePointerOp.startY;

          let newX = Math.max(0, Math.min(w - 80, activePointerOp.origX + dx));
          let newY = Math.max(0, Math.min(h - 50, activePointerOp.origY + dy));

          // The track moves freely: no edge snapping. Docking is only done via the dock button,
          // and dragging a docked track floats it from where it is. It stays fully on screen.
          if (activePointerOp.compId === "track") {
            state.docked = "none";
            const pos = clampBoxToViewport(activePointerOp.origX + dx, activePointerOp.origY + dy,
              activePointerOp.boxW, activePointerOp.boxH, w, h);
            newX = pos.x;
            newY = pos.y;
          }

          state.x = Math.round(newX);
          state.y = Math.round(newY);

          if (activePointerOp.compId === "timers") {
            const compWidth = activePointerOp.element ? activePointerOp.element.offsetWidth || 300 : 300;
            state.right = Math.max(0, w - (state.x + compWidth));
          }
          applyComponentLayout(activePointerOp.compId);
        } else if (activePointerOp.type === "scale") {
          const dx = e.clientX - activePointerOp.startX;
          let scale = computeScale(activePointerOp.origScale, dx);
          // The track may not grow past the screen edge, which would hide its resize handle
          if (activePointerOp.compId === "track") {
            scale = Math.min(scale, maxTrackScale(state, activePointerOp.baseW, activePointerOp.baseH, w, h));
          }
          state.scale = scale;
          applyComponentLayout(activePointerOp.compId);
        }
      });

      // Global pointerup
      window.addEventListener("pointerup", (e) => {
        if (!activePointerOp) return;

        if (activePointerOp.element) {
          activePointerOp.element.classList.remove("is-dragging", "is-scaling");
          try {
            if (activePointerOp.element.hasPointerCapture && activePointerOp.element.hasPointerCapture(e.pointerId)) {
              activePointerOp.element.releasePointerCapture(e.pointerId);
            }
          } catch (_) {}
        }
        if (activePointerOp.dragHandle) {
          try {
            if (activePointerOp.dragHandle.hasPointerCapture && activePointerOp.dragHandle.hasPointerCapture(e.pointerId)) {
              activePointerOp.dragHandle.releasePointerCapture(e.pointerId);
            }
          } catch (_) {}
        }
        if (activePointerOp.resizeHandle) {
          try {
            if (activePointerOp.resizeHandle.hasPointerCapture && activePointerOp.resizeHandle.hasPointerCapture(e.pointerId)) {
              activePointerOp.resizeHandle.releasePointerCapture(e.pointerId);
            }
          } catch (_) {}
        }

        if (activePointerOp.compId === "timers") {
          syncTimerAnchorUI();
        }
        activePointerOp = null;
        saveLayout();
      });
    }

    return {
      clampCoordinates,
      computeScale,
      getActiveOp,
      initPointerListeners
    };
  }

  // Global namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutDrag = {
    clampCoordinates,
    computeScale,
    clampBoxToViewport,
    maxScaleToFit,
    maxTrackScale,
    fitTrackBox,
    freezeTrackSize,
    createLayoutDrag
  };
})();
