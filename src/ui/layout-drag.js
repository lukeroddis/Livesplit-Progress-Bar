/**
 * LiveSplit Progress Bar - Layout Pointer Drag & Scale Engine
 * 
 * Encapsulates:
 * - Pointerdown, pointermove, pointerup/cancel lifecycle for HUD components
 * - Touch & mouse unified drag positioning with pointer capture
 * - Proportional scaling via scale handle drag (clamped 0.4x to 2.5x)
 * - Viewport boundary clamping and coordinate rounding
 * - Track docking snapping (bottom dock vs vertical left/right dock)
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
   * Resolves track docking and snapped coordinates based on position and orientation.
   */
  function computeTrackDocking(rawX, rawY, viewportWidth, viewportHeight, isVertical) {
    const w = viewportWidth || (typeof window !== "undefined" ? window.innerWidth : 1920);
    const h = viewportHeight || (typeof window !== "undefined" ? window.innerHeight : 1080);
    let docked = "none";
    let x = rawX;
    let y = rawY;

    if (isVertical) {
      if (rawX <= 100) {
        docked = "left";
        x = 0;
        y = 0;
      } else if (rawX >= w - 380) {
        docked = "right";
        x = w - 340;
        y = 0;
      }
    } else {
      if (rawY >= h - 140) {
        docked = "bottom";
        x = 0;
        y = h - 90;
      }
    }

    return { docked, x: Math.round(x), y: Math.round(y) };
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
          activePointerOp = {
            type: "drag",
            compId: id,
            pointerId: e.pointerId,
            element: el,
            startX: e.clientX,
            startY: e.clientY,
            origX: el.offsetLeft,
            origY: el.offsetTop,
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
            activePointerOp = {
              type: "scale",
              compId: id,
              pointerId: e.pointerId,
              element: el,
              resizeHandle: resizeHandle,
              startX: e.clientX,
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
            } else {
              state.docked = "bottom";
              state.x = 0;
              state.y = Math.max(0, h - 90);
            }
          }

          applyComponentLayout("track");
          saveLayout();
          if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) {
            window.updateTrackDensityAndAngle();
          }
          if (typeof window !== "undefined" && window.updateTrackStatus) {
            window.updateTrackStatus(window.getCurrentIndex ? window.getCurrentIndex() : -1);
          }
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

          // Snapping for track component to bottom dock or left/right dock
          if (activePointerOp.compId === "track") {
            const currentTrackStyle = getCurrentTrackStyle();
            const isVert = (currentTrackStyle && currentTrackStyle.orientation === "vertical");
            const docking = computeTrackDocking(newX, newY, w, h, isVert);
            state.docked = docking.docked;
            newX = docking.x;
            newY = docking.y;
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
          state.scale = computeScale(activePointerOp.origScale, dx);
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
      computeTrackDocking,
      getActiveOp,
      initPointerListeners
    };
  }

  // Global namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutDrag = {
    clampCoordinates,
    computeScale,
    computeTrackDocking,
    createLayoutDrag
  };
})();
