/**
 * src/ui/widget-popover.js - Per-Widget Settings Popovers (Layout Mode cogs)
 *
 * A widget's settings open in a popover beside the widget instead of the big
 * Customizer modal, so the HUD stays visible (and editable) while you change it:
 * - placePopover: pure placement on the side of the widget with the most room,
 *   clamped to the screen, with the height the popover may use there
 * - createWidgetPopovers: open / close / toggle the `.widget-popover[data-widget]`
 *   element for a component (beside `hud-comp-<data-anchor or data-widget>`); repositions after changes inside it (an orientation
 *   switch reshapes the track), pointer releases (dragging the widget) and resizes.
 *   Closes on its close / Done buttons, Escape (layout-modal.js) and clicks outside
 *   it, except on HUD widgets so they can still be dragged while it is open
 * - Drag a popover by its header and resize it from its corner grip; it then keeps
 *   that place and size (kept on screen) until the page reloads. Double-clicking the
 *   header puts it back beside its widget
 */

(function () {
  "use strict";

  const GAP = 12;
  const MARGIN = 8;
  const SIDES = ["right", "left", "below", "above"];
  const MIN_WIDTH = 260;
  const MIN_HEIGHT = 160;

  /**
   * Pure: where to put a popover of `size` beside the `anchor` rect inside `viewport`.
   * Prefers the side with the most room among those it fits on (right, left, below, above
   * on ties), else the roomiest side, and shrinks the height to what that side allows.
   * `viewport.top` (optional) keeps the popover below a bar along the top (the Layout toolbar).
   * Without a visible anchor (a hidden widget) it is centred.
   * @returns {{side: string, left: number, top: number, maxHeight: number}}
   */
  function placePopover(anchor, size, viewport, gap = GAP, margin = MARGIN) {
    const minTop = (viewport.top || 0) + margin;
    // No widget on screen to sit beside (hidden standings): centre it
    if (!anchor || (anchor.width === 0 && anchor.height === 0)) {
      const maxHeight = viewport.height - minTop - margin;
      const height = Math.min(size.height, maxHeight);
      return {
        side: "center",
        left: Math.max(margin, Math.round((viewport.width - size.width) / 2)),
        top: Math.max(minTop, Math.round((viewport.height - height) / 2)),
        maxHeight
      };
    }
    const room = {
      right: viewport.width - anchor.right - gap - margin,
      left: anchor.left - gap - margin,
      below: viewport.height - anchor.bottom - gap - margin,
      above: anchor.top - gap - minTop
    };
    const fits = (side) => (side === "left" || side === "right") ? room[side] >= size.width : room[side] >= size.height;
    // Spare room once the popover is placed: bigger is better
    const spare = (side) => room[side] - ((side === "left" || side === "right") ? size.width : size.height);
    const candidates = SIDES.filter(fits);
    const pool = candidates.length > 0 ? candidates : SIDES;
    const side = pool.reduce((best, s) => (spare(s) > spare(best) ? s : best), pool[0]);

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fullHeight = viewport.height - minTop - margin;
    if (side === "left" || side === "right") {
      const maxHeight = fullHeight;
      const height = Math.min(size.height, maxHeight);
      const left = side === "right" ? anchor.right + gap : anchor.left - gap - size.width;
      return {
        side,
        left: clamp(left, margin, viewport.width - size.width - margin),
        top: clamp(anchor.top, minTop, viewport.height - height - margin),
        maxHeight
      };
    }
    const maxHeight = Math.max(120, Math.min(fullHeight, room[side]));
    const height = Math.min(size.height, maxHeight);
    const top = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;
    return {
      side,
      left: clamp(anchor.left, margin, viewport.width - size.width - margin),
      top: clamp(top, minTop, viewport.height - height - margin),
      maxHeight
    };
  }

  /**
   * Pure: a moved / resized popover box kept usable and on screen: at least the minimum
   * size, at most the viewport (below `viewport.top`), and fully inside it.
   * @returns {{left: number, top: number, width: number, height: number}}
   */
  function clampBox(box, viewport, margin = MARGIN) {
    const minTop = (viewport.top || 0) + margin;
    const width = Math.max(MIN_WIDTH, Math.min(box.width, viewport.width - 2 * margin));
    const height = Math.max(MIN_HEIGHT, Math.min(box.height, viewport.height - minTop - margin));
    return {
      left: Math.max(margin, Math.min(box.left, viewport.width - width - margin)),
      top: Math.max(minTop, Math.min(box.top, viewport.height - height - margin)),
      width,
      height
    };
  }

  /**
   * @param {Object} [options]
   * @param {Function} [options.onOpen] - (compId) after a popover opens (sync its controls)
   * @param {Function} [options.onClose] - (compId) after it closes (save)
   * @param {Function} [options.onReset] - (compId) its reset button
   */
  function createWidgetPopovers({ onOpen = () => {}, onClose = () => {}, onReset = () => {} } = {}) {
    let current = null; // { compId, el }
    let frame = 0;
    const manualBoxes = new Map(); // compId -> { left, top, width, height } once dragged / resized

    const popoverFor = (compId) => document.querySelector(`.widget-popover[data-widget="${compId}"]`);

    // The screen area popovers may use: clear of the Layout toolbar along the top while it shows
    // (its resting place: it slides in with a transform, which offsetTop ignores)
    function getViewport() {
      const toolbar = document.getElementById("layout-toolbar");
      const toolbarBottom = toolbar && document.body.classList.contains("edit-mode") ? toolbar.offsetTop + toolbar.offsetHeight : 0;
      return { width: window.innerWidth, height: window.innerHeight, top: Math.max(0, toolbarBottom) };
    }

    function applyBox(el, box) {
      el.style.left = `${box.left}px`;
      el.style.top = `${box.top}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.maxHeight = "none";
      el.dataset.side = "manual";
    }

    function reposition() {
      if (!current) return;
      const { compId, el } = current;
      const viewport = getViewport();
      if (manualBoxes.has(compId)) {
        const box = clampBox(manualBoxes.get(compId), viewport);
        manualBoxes.set(compId, box);
        applyBox(el, box);
        return;
      }
      const anchorEl = document.getElementById(`hud-comp-${el.dataset.anchor || compId}`);
      el.style.maxHeight = "";
      el.style.width = "";
      el.style.height = "";
      const placed = placePopover(
        anchorEl ? anchorEl.getBoundingClientRect() : null,
        { width: el.offsetWidth, height: el.offsetHeight },
        viewport);
      el.style.maxHeight = `${placed.maxHeight}px`;
      el.style.left = `${placed.left}px`;
      el.style.top = `${placed.top}px`;
      el.dataset.side = placed.side;
    }

    const repositionSoon = () => {
      if (!current || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; reposition(); });
    };

    function close() {
      if (!current) return;
      const { compId, el } = current;
      el.hidden = true;
      current = null;
      onClose(compId);
    }

    function open(compId) {
      const el = popoverFor(compId);
      if (!el) return false;
      if (current && current.compId !== compId) close();
      current = { compId, el };
      el.hidden = false;
      onOpen(compId);
      reposition();
      return true;
    }

    /** Opens the popover, or closes it when it is already open (the cog toggles). */
    function toggle(compId) {
      if (current && current.compId === compId) {
        close();
        return true;
      }
      return open(compId);
    }

    // Drags from the header move the popover, drags from the corner grip resize it
    function bindMoveAndResize(el) {
      const header = el.querySelector(".widget-popover-header");
      const grip = document.createElement("div");
      grip.className = "widget-popover-resize";
      grip.title = "Drag to resize";
      el.appendChild(grip);

      const startDrag = (e, mode) => {
        if (!current || current.el !== el) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, width: r.width, height: r.height };
        const target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add(mode === "move" ? "is-moving" : "is-resizing");
        const onMove = (ev) => {
          const dx = ev.clientX - start.x;
          const dy = ev.clientY - start.y;
          const box = mode === "move"
            ? { left: start.left + dx, top: start.top + dy, width: start.width, height: start.height }
            : { left: start.left, top: start.top, width: start.width + dx, height: start.height + dy };
          const clamped = clampBox(box, getViewport());
          manualBoxes.set(el.dataset.widget, clamped);
          applyBox(el, clamped);
        };
        const onUp = () => {
          target.removeEventListener("pointermove", onMove);
          target.removeEventListener("pointerup", onUp);
          target.removeEventListener("pointercancel", onUp);
          el.classList.remove("is-moving", "is-resizing");
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
      };

      header?.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        startDrag(e, "move");
      });
      header?.addEventListener("dblclick", (e) => {
        if (e.target.closest("button")) return;
        manualBoxes.delete(el.dataset.widget);
        reposition();
      });
      grip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        startDrag(e, "resize");
      });
    }

    function bind() {
      document.querySelectorAll(".widget-popover").forEach((el) => {
        bindMoveAndResize(el);
        el.querySelectorAll("[data-popover-close]").forEach((btn) => btn.addEventListener("click", close));
        el.querySelectorAll("[data-popover-reset]").forEach((btn) => btn.addEventListener("click", () => {
          onReset(el.dataset.widget);
          repositionSoon();
        }));
        ["input", "change", "click"].forEach((type) => el.addEventListener(type, repositionSoon));
      });
      document.addEventListener("pointerdown", (e) => {
        if (!current || !e.target || typeof e.target.closest !== "function") return;
        if (current.el.contains(e.target) || e.target.closest(".hud-component")) return;
        close();
      }, true);
      document.addEventListener("pointerup", repositionSoon);
      window.addEventListener("resize", repositionSoon);
    }

    return {
      open,
      close,
      toggle,
      reposition,
      bind,
      isOpen: () => !!current,
      getOpenWidget: () => (current ? current.compId : null)
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.WidgetPopover = {
    placePopover,
    clampBox,
    createWidgetPopovers
  };
})();
