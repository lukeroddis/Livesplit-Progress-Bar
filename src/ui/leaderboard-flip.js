/**
 * src/ui/leaderboard-flip.js - Leaderboard Overtake Reorder Animation (FLIP)
 *
 * Moves rows into rank order with targeted DOM reconciliation (rows already in
 * their slot are never detached, so running glow animations do not restart),
 * then animates the swap with FLIP: First (measure), Last (reorder), Invert
 * (counter-transform), Play (transition back to 0).
 */

(function () {
  "use strict";

  const SWAP_TRANSITION = "transform 0.4s cubic-bezier(0.2, 0, 0, 1)";
  const SWAP_CLEANUP_MS = 450;
  const SPLIT_FLASH_MS = 4000;

  /** Removes the inline styles a swap animation leaves on a row. */
  function clearSwapStyles(row) {
    row.classList.remove("is-swapping");
    row.style.removeProperty("transform");
    row.style.removeProperty("transition");
    row.style.removeProperty("z-index");
    row.style.removeProperty("--swap-y");
  }

  /**
   * @param {HTMLElement} rowsEl - Rows container
   * @param {Array} orderedEntrants - Entrants in desired slot order (uses userId, lastSplitEffect)
   * @param {Map} rowElementMap - userId -> row element
   */
  function reorderRowsWithFlip(rowsEl, orderedEntrants, rowElementMap) {
    // 1. FIRST: record visual positions before rearranging
    const prevTops = new Map();
    rowElementMap.forEach((row, uId) => {
      if (row && row.isConnected) {
        prevTops.set(uId, row.getBoundingClientRect().top);
      }
    });

    // Clear any previous swap transforms so layout positions can be accurately measured
    rowElementMap.forEach((row) => {
      if (row.classList.contains("is-swapping")) clearSwapStyles(row);
    });

    // 2. LAST: slot rows into their new positions, moving only rows that are out of place
    let currentChild = rowsEl.firstElementChild;
    orderedEntrants.forEach((racer) => {
      const row = rowElementMap.get(racer.userId);
      if (!row) return;
      if (currentChild === row) {
        currentChild = currentChild.nextElementSibling;
        return;
      }
      rowsEl.insertBefore(row, currentChild);
      // A moved row mid split-glow keeps its elapsed animation progress
      const fx = racer.lastSplitEffect;
      const fxAge = fx ? (Date.now() - (fx.timestamp || 0)) : Infinity;
      if (fx && fx.type && fxAge >= 0 && fxAge < SPLIT_FLASH_MS) {
        row.style.animationDelay = `-${(fxAge / 1000).toFixed(2)}s`;
      }
    });

    // 3. INVERT: counter-transform each moved row back to where it was
    const movingRows = [];
    orderedEntrants.forEach((racer) => {
      const row = rowElementMap.get(racer.userId);
      if (!row || !row.isConnected) return;
      const oldTop = prevTops.get(racer.userId);
      if (oldTop === undefined) return;
      const dy = oldTop - row.getBoundingClientRect().top;

      // Sub-pixel shifts within 0.5px are ignored to prevent micro-jitter
      if (Math.abs(dy) > 0.5) {
        row.style.setProperty("transition", "none", "important");
        row.style.setProperty("transform", `translateY(${dy}px)`, "important");
        row.style.setProperty("--swap-y", `${dy}px`);
        // Climbing overtakers (moving up, dy > 0) render above rows moving down
        row.style.zIndex = dy > 0 ? "4" : "2";
        movingRows.push(row);
      }
    });

    if (movingRows.length === 0) return;

    // 4. PLAY: flush layout so the inverted transform is locked, then transition to 0
    void rowsEl.offsetHeight;
    const raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    raf(() => {
      movingRows.forEach((row) => {
        row.classList.add("is-swapping");
        row.style.setProperty("transition", SWAP_TRANSITION, "important");
        row.style.setProperty("transform", "translateY(0px)", "important");
        row.style.setProperty("--swap-y", "0px");

        const cleanup = (e) => {
          if (e && e.propertyName && e.propertyName !== "transform") return;
          row.removeEventListener("transitionend", cleanup);
          clearSwapStyles(row);
        };
        row.addEventListener("transitionend", cleanup, { once: true });
        setTimeout(cleanup, SWAP_CLEANUP_MS);
      });
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LeaderboardFlip = {
    clearSwapStyles,
    reorderRowsWithFlip
  };
})();
