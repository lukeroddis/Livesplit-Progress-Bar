/**
 * src/ui/leaderboard-marquee.js - Scrolling Labels for Fixed-Width Leaderboard Columns
 *
 * Long runner / split names scroll back and forth inside their column. Labels
 * whose text changed are queued and measured once after all row writes (never
 * every frame); labels measured while hidden (0 width) stay queued for a later render.
 */

(function () {
  "use strict";

  const MARQUEE_SPEED_PX_PER_SEC = 24;
  const MARQUEE_PAUSE_SEC = 3;

  function createMarqueeQueue() {
    const pending = new Set();

    function queue(el) {
      pending.add(el);
    }

    /** Sets a label's text (inside its .marquee-text span) and queues an overflow check when it changed. */
    function setText(el, text) {
      const inner = el.querySelector(".marquee-text");
      if (!inner) {
        if (el.textContent !== text) el.textContent = text;
        return;
      }
      if (inner.textContent !== text) {
        inner.textContent = text;
        pending.add(el);
      }
    }

    function measure() {
      if (pending.size === 0) return;
      pending.forEach((el) => {
        if (!el.isConnected) {
          pending.delete(el);
          return;
        }
        const inner = el.querySelector(".marquee-text");
        const boxWidth = el.clientWidth;
        if (!inner || boxWidth === 0) return;
        pending.delete(el);
        const overflow = Math.ceil(inner.scrollWidth - boxWidth);
        if (overflow > 1) {
          const travelSec = overflow / MARQUEE_SPEED_PX_PER_SEC;
          el.style.setProperty("--marquee-shift", `-${overflow}px`);
          el.style.setProperty("--marquee-duration", `${(2 * (travelSec + MARQUEE_PAUSE_SEC)).toFixed(2)}s`);
          el.setAttribute("data-marquee", "on");
        } else if (el.hasAttribute("data-marquee")) {
          el.removeAttribute("data-marquee");
          el.style.removeProperty("--marquee-shift");
          el.style.removeProperty("--marquee-duration");
        }
      });
    }

    return { queue, setText, measure };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LeaderboardMarquee = {
    createMarqueeQueue
  };
})();
