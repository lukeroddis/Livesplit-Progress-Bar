/**
 * tests/unit/ui/leaderboard-marquee.test.js
 * LiveSplit.LeaderboardMarquee: text writes queue a single overflow measurement;
 * long labels get the scroll animation, short ones lose it, hidden ones wait.
 */

(function () {
  "use strict";

  const { mountHtml } = window.TestUtils;

  const label = (id, width) =>
    `<div id="${id}" style="width: ${width}px; overflow: hidden; white-space: nowrap; font: 14px monospace;"><span class="marquee-text" style="display: inline-block;"></span></div>`;

  function withLabels(fn) {
    const dom = mountHtml(label("mq-a", 60) + label("mq-b", 400) + '<div id="mq-plain"></div>');
    try {
      return fn({ dom, q: window.LiveSplit.LeaderboardMarquee.createMarqueeQueue(), el: dom.el });
    } finally {
      dom.remove();
    }
  }

  describe("Leaderboard Marquee (LiveSplit.LeaderboardMarquee)", () => {
    it("animates a label whose text overflows its column", () => withLabels(({ q, el }) => {
      const a = el("mq-a");
      q.setText(a, "A very long runner name that cannot fit");
      assertEqual(a.querySelector(".marquee-text").textContent, "A very long runner name that cannot fit");
      q.measure();
      assertEqual(a.getAttribute("data-marquee"), "on");
      const shift = parseInt(a.style.getPropertyValue("--marquee-shift"), 10);
      assert(shift < -1, `scrolls left by the overflow (got ${shift})`);
      const duration = parseFloat(a.style.getPropertyValue("--marquee-duration"));
      assertEqual(duration.toFixed(2), (2 * (-shift / 24 + 3)).toFixed(2), "there-and-back at 24px/s with 3s pauses");
    }));

    it("leaves short labels static and removes the animation when text shrinks", () => withLabels(({ q, el }) => {
      const a = el("mq-a");
      q.setText(el("mq-b"), "Short");
      q.setText(a, "A very long runner name that cannot fit");
      q.measure();
      assert(!el("mq-b").hasAttribute("data-marquee"), "fits, no animation");

      q.setText(a, "Al");
      q.measure();
      assert(!a.hasAttribute("data-marquee"), "animation removed");
      assertEqual(a.style.getPropertyValue("--marquee-shift"), "");
    }));

    it("only re-measures labels whose text changed", () => withLabels(({ q, el }) => {
      const a = el("mq-a");
      q.setText(a, "A very long runner name that cannot fit");
      q.measure();
      a.removeAttribute("data-marquee");
      q.setText(a, "A very long runner name that cannot fit");
      q.measure();
      assert(!a.hasAttribute("data-marquee"), "unchanged text is not queued again");
      q.queue(a);
      q.measure();
      assertEqual(a.getAttribute("data-marquee"), "on", "an explicit queue() re-measures");
    }));

    it("keeps hidden labels queued until they have a width", () => withLabels(({ q, el }) => {
      const a = el("mq-a");
      a.style.display = "none";
      q.setText(a, "A very long runner name that cannot fit");
      q.measure();
      assert(!a.hasAttribute("data-marquee"), "not measured while hidden");
      a.style.display = "";
      q.measure();
      assertEqual(a.getAttribute("data-marquee"), "on", "measured once visible");
    }));

    it("drops labels removed from the page and handles labels without an inner span", () => withLabels(({ q, el }) => {
      const a = el("mq-a");
      q.setText(a, "A very long runner name that cannot fit");
      a.remove();
      q.measure();
      assert(!a.hasAttribute("data-marquee"), "detached label skipped");

      const plain = el("mq-plain");
      q.setText(plain, "Plain text");
      assertEqual(plain.textContent, "Plain text", "written directly");
      q.setText(plain, "Plain text");
      q.measure();
    }));
  });
})();
