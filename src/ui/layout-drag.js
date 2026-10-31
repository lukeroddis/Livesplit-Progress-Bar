/**
 * Speedrun Overlay - Layout Pointer Drag & Scale Engine
 * 
 * Encapsulates:
 * - Pointerdown, pointermove, pointerup/cancel lifecycle for HUD components
 * - Touch & mouse unified drag positioning with pointer capture
 * - Proportional scaling via scale handle drag (clamped 0.4x to 2.5x)
 * - Track resizing via the same handle (Ctrl/Shift-drag scales instead): a vertical track's width
 *   (room for split text) and height (split spacing); a horizontal track's width (split spacing,
 *   floating only) and height (lines for split names, docked too)
 * - Viewport boundary clamping and coordinate rounding
 * - Free track dragging (docking only via the dock button; dragging a docked track undocks it),
 *   keeping its size fixed and the whole scaled track (and its resize handle) on screen
 * - Dedicated leaderboard header drag support
 * - Dock toggle button handling (#btn-dock-track): docks to the nearest edge (top/bottom, or left/right
 *   when vertical)
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

  // Smallest unscaled track sizes the resize handle allows
  const TRACK_MIN_SIZE = Object.freeze({ verticalWidth: 180, verticalHeight: 160, horizontalWidth: 320 });
  // Lines a horizontal track's split names may wrap onto (its height)
  const MAX_NAME_LINES = 4;

  /**
   * New unscaled track size for a resize-handle drag of (dx, dy) screen px, clamped to the minimums
   * and so the scaled track stays on screen. Returns { verticalWidth?, height? } for a vertical track
   * (a docked one only changes width, growing away from its edge), and { width?, nameLines } for a
   * horizontal one: height moves in whole name lines (1 to MAX_NAME_LINES, one per lineHeight px),
   * a docked track grows away from its edge and keeps spanning the screen.
   * @param {Object} op - { isVertical, docked, x, y, baseW, baseH, scale, dx, dy, viewportWidth,
   *   viewportHeight, baseLines, lineHeight }
   */
  function computeTrackResize(op) {
    const scale = op.scale || 1;
    const floating = !op.docked || op.docked === "none";
    const clamp = (v, min, max) => Math.round(Math.max(min, Math.min(Math.max(min, max), v)));

    if (op.isVertical) {
      const side = effectiveDockSide(op.docked, true);
      if (!floating) {
        const grow = side === "right" ? -op.dx : op.dx;
        return { verticalWidth: clamp(op.baseW + grow / scale, TRACK_MIN_SIZE.verticalWidth, op.viewportWidth / scale) };
      }
      return {
        verticalWidth: clamp(op.baseW + op.dx / scale, TRACK_MIN_SIZE.verticalWidth, (op.viewportWidth - op.x) / scale),
        height: clamp(op.baseH + op.dy / scale, TRACK_MIN_SIZE.verticalHeight, (op.viewportHeight - op.y) / scale)
      };
    }
    const side = effectiveDockSide(op.docked, false);
    const grow = (floating || side === "top") ? op.dy : -op.dy;
    const lineHeight = op.lineHeight > 0 ? op.lineHeight : 20;
    const nameLines = Math.max(1, Math.min(MAX_NAME_LINES, Math.round((op.baseLines || 1) + grow / scale / lineHeight)));
    if (!floating) return { nameLines };
    return {
      width: clamp(op.baseW + op.dx / scale, TRACK_MIN_SIZE.horizontalWidth, (op.viewportWidth - op.x) / scale),
      nameLines
    };
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
   * The edge a docked track actually uses in this orientation: a horizontal track docks top or bottom,
   * a vertical one left or right (a dock saved in the other orientation falls back to bottom / left).
   */
  function effectiveDockSide(docked, isVertical) {
    if (isVertical) return docked === "right" ? "right" : "left";
    return docked === "top" ? "top" : "bottom";
  }

  /**
   * Picks the edge to dock the track to from where its centre sits (rect in screen px): the top or
   * bottom half for a horizontal track, the left or right half for a vertical one.
   */
  function chooseDockSide(rect, viewportWidth, viewportHeight, isVertical) {
    if (isVertical) return rect.left + rect.width / 2 > viewportWidth / 2 ? "right" : "left";
    return rect.top + rect.height / 2 < viewportHeight / 2 ? "top" : "bottom";
  }

  // Saved position for a track docked to `side` (the dock CSS pins it; this keeps x/y meaningful)
  function dockedPosition(side, viewportWidth, viewportHeight, trackWidth = 340) {
    if (side === "right") return { x: Math.max(0, viewportWidth - trackWidth), y: 0 };
    if (side === "bottom") return { x: 0, y: Math.max(0, viewportHeight - 90) };
    return { x: 0, y: 0 };
  }

  // Where the track floats when undocked from `side`: just inside that edge
  function floatPositionFrom(side, viewportWidth, viewportHeight, trackWidth = 340) {
    if (side === "right") return { x: Math.max(0, viewportWidth - trackWidth - 42), y: 80 };
    if (side === "bottom") return { x: 42, y: Math.max(0, viewportHeight - 150) };
    return { x: 42, y: 80 };
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
            // The track resizes (LiveSplit-style) unless Ctrl/Shift is held
            const wantsResize = id === "track" && state && !(e.ctrlKey || e.metaKey || e.shiftKey);
            const trackEl = document.getElementById("track");
            const nameFont = trackEl ? parseFloat(getComputedStyle(trackEl).getPropertyValue("--name-font-size")) : NaN;
            activePointerOp = {
              type: wantsResize ? "resize" : "scale",
              compId: id,
              pointerId: e.pointerId,
              element: el,
              resizeHandle: resizeHandle,
              startX: e.clientX,
              startY: e.clientY,
              baseW: el.offsetWidth,
              baseH: el.offsetHeight,
              baseLines: (state && state.nameLines) || 1,
              lineHeight: (nameFont > 0 ? nameFont : 17) * 1.2,
              origScale: state ? state.scale : 1
            };
          });
        }

        // Hide / show button in the header (through the settings registry, so listeners hear it)
        el.querySelector('[data-action="toggle-visibility"]')?.addEventListener("click", (e) => {
          e.stopPropagation();
          window.LiveSplit.Overlay.settings?.toggle(`visible.${id}`);
        });
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

          const isVert = isVerticalTrack();
          const w = (typeof window !== "undefined" && window.innerWidth) || 1920;
          const h = (typeof window !== "undefined" && window.innerHeight) || 1080;

          // A vertical track keeps the width it was resized to, docked or floating
          const trackWidth = state.verticalWidth > 0 ? state.verticalWidth : 340;
          if (!isTrackFloating(state)) {
            // Float just inside the edge it was docked to, filling to the screen edge again
            Object.assign(state, floatPositionFrom(effectiveDockSide(state.docked, isVert), w, h, trackWidth));
            state.docked = "none";
            delete state.width;
            delete state.height;
          } else {
            // Dock to whichever edge the track is nearest
            const trackEl = document.getElementById("hud-comp-track");
            const side = trackEl
              ? chooseDockSide(trackEl.getBoundingClientRect(), w, h, isVert)
              : effectiveDockSide("", isVert);
            Object.assign(state, dockedPosition(side, w, h, trackWidth));
            state.docked = side;
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
        } else if (activePointerOp.type === "resize") {
          const size = computeTrackResize({
            isVertical: isVerticalTrack(),
            docked: state.docked,
            x: state.x,
            y: state.y,
            baseW: activePointerOp.baseW,
            baseH: activePointerOp.baseH,
            scale: state.scale,
            dx: e.clientX - activePointerOp.startX,
            dy: e.clientY - activePointerOp.startY,
            viewportWidth: w,
            viewportHeight: h,
            baseLines: activePointerOp.baseLines,
            lineHeight: activePointerOp.lineHeight
          });
          Object.assign(state, size);
          applyComponentLayout("track");
          // Width changes the room for split text (and horizontal spacing), height the vertical spacing
          window.LiveSplit.Overlay.refreshTrack?.();
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
    computeTrackResize,
    TRACK_MIN_SIZE,
    MAX_NAME_LINES,
    effectiveDockSide,
    chooseDockSide,
    createLayoutDrag
  };
})();
