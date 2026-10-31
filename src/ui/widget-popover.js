/**
 * src/ui/widget-popover.js - Per-Widget Settings Popovers (Layout Mode cogs)
 *
 * A widget's settings open in a popover beside the widget instead of the big
 * Customizer modal, so the HUD stays visible (and editable) while you change it:
 * - placePopover: pure placement on the side of the widget with the most room,
 *   clamped to the screen, with the height the popover may use there
 * - createWidgetPopovers: open / close / toggle the `.widget-popover[data-widget]`
 *   element for a component; repositions after changes inside it (an orientation
 *   switch reshapes the track), pointer releases (dragging the widget) and resizes.
 *   Closes on its close / Done buttons, Escape (layout-modal.js) and clicks outside
 *   it, except on HUD widgets so they can still be dragged while it is open
 */

(function () {
  "use strict";

  const GAP = 12;
  const MARGIN = 8;
  const SIDES = ["right", "left", "below", "above"];

  /**
   * Pure: where to put a popover of `size` beside the `anchor` rect inside `viewport`.
   * Prefers the side with the most room among those it fits on (right, left, below, above
   * on ties), else the roomiest side, and shrinks the height to what that side allows.
   * `viewport.top` (optional) keeps the popover below a bar along the top (the Layout toolbar).
   * @returns {{side: string, left: number, top: number, maxHeight: number}}
   */
  function placePopover(anchor, size, viewport, gap = GAP, margin = MARGIN) {
    const minTop = (viewport.top || 0) + margin;
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
   * @param {Object} [options]
   * @param {Function} [options.onOpen] - (compId) after a popover opens (sync its controls)
   * @param {Function} [options.onClose] - (compId) after it closes (save)
   * @param {Function} [options.onReset] - (compId) its reset button
   */
  function createWidgetPopovers({ onOpen = () => {}, onClose = () => {}, onReset = () => {} } = {}) {
    let current = null; // { compId, el }
    let frame = 0;

    const popoverFor = (compId) => document.querySelector(`.widget-popover[data-widget="${compId}"]`);

    function reposition() {
      if (!current) return;
      const anchorEl = document.getElementById(`hud-comp-${current.compId}`);
      if (!anchorEl) return;
      const { el } = current;
      el.style.maxHeight = "";
      // Stay clear of the Layout toolbar along the top while it shows (its resting place: it slides in
      // with a transform, which offsetTop ignores)
      const toolbar = document.getElementById("layout-toolbar");
      const toolbarBottom = toolbar && document.body.classList.contains("edit-mode") ? toolbar.offsetTop + toolbar.offsetHeight : 0;
      const placed = placePopover(
        anchorEl.getBoundingClientRect(),
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight, top: Math.max(0, toolbarBottom) });
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

    function bind() {
      document.querySelectorAll(".widget-popover").forEach((el) => {
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
    createWidgetPopovers
  };
})();
