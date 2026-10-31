/**
 * tests/unit/ui/ghost-runner.test.js
 * Off-screen edge pills (LiveSplit.GhostRunner.renderEdgePill) and the track's has-pins flag
 */

(function () {
  "use strict";

  describe("Ghost Runner: off-screen edge pills", () => {
    it("renders a race competitor's avatar URL as an image, not text", () => {
      const el = document.createElement("div");
      const url = "https://static-cdn.jtvnw.net/jtv_user_pictures/racer-profile_image-150x150.png";
      window.LiveSplit.GhostRunner.renderEdgePill(el, [
        { ghostInfo: { id: "racer", icon: url, color: "#f59e0b" }, deltaStr: "+3.2", isAhead: false }
      ], "❮", true);

      const img = el.querySelector("img.ghost-edge-avatar");
      assert(img !== null, "avatar rendered as an image");
      assertEqual(img.getAttribute("src"), url);
      assert(!el.textContent.includes("https://"), "URL is not shown as text");
    });

    it("keeps emoji ghost icons and escapes anything else", () => {
      const el = document.createElement("div");
      window.LiveSplit.GhostRunner.renderEdgePill(el, [
        { ghostInfo: { id: "wr", icon: "🏆" }, deltaStr: "-1.0", isAhead: true },
        { ghostInfo: { id: "bad", icon: "<b>x</b>" }, deltaStr: "+2.0", isAhead: false }
      ], "❯", false);

      assert(el.textContent.includes("🏆"), "emoji icon kept");
      assert(el.querySelector("b") === null, "icon text is escaped");
    });
  });

  describe("Ghost Runner: ghosts on / off", () => {
    it("off remembers the chosen ghosts and on brings them back, also across reloads", () => {
      const KEYS = window.LiveSplit.Storage.KEYS;
      const keys = [KEYS.ACTIVE_GHOSTS, KEYS.GHOST_COMPARISON, KEYS.LAST_GHOSTS];
      const saved = keys.map((k) => [k, localStorage.getItem(k)]);
      const runner = () => window.LiveSplit.GhostRunner.createGhostRunner({ getSplitsList: () => ["A", "B"], getLastElapsedSec: () => 0 });
      try {
        keys.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(KEYS.ACTIVE_GHOSTS, JSON.stringify(["wr", "best"]));
        const r = runner();
        assert(r.areGhostsEnabled());
        r.setGhostsEnabled(false);
        assertEqual(r.getActiveGhostComparisons(), ["off"]);
        r.setGhostsEnabled(true);
        assertEqual(r.getActiveGhostComparisons(), ["wr", "best"], "selection restored");

        r.setGhostsEnabled(false);
        const reloaded = runner();
        assert(!reloaded.areGhostsEnabled());
        reloaded.setGhostsEnabled(true);
        assertEqual(reloaded.getActiveGhostComparisons(), ["wr", "best"], "remembered in storage");

        localStorage.removeItem(KEYS.LAST_GHOSTS);
        localStorage.setItem(KEYS.ACTIVE_GHOSTS, JSON.stringify(["off"]));
        const fresh = runner();
        fresh.setGhostsEnabled(true);
        assertEqual(fresh.getActiveGhostComparisons(), ["pb"], "PB when nothing was ever chosen");
      } finally {
        saved.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)));
      }
    });
  });

  describe("Ghost Runner: pin lane flag", () => {
    it("marks the track has-pins only while ghost pins are switched on", () => {
      const KEYS = window.LiveSplit.Storage.KEYS;
      const track = document.getElementById("track");
      const savedGhosts = localStorage.getItem(KEYS.ACTIVE_GHOSTS);
      const hadFlag = track.classList.contains("has-pins");
      const runnerWith = (ghosts) => {
        localStorage.setItem(KEYS.ACTIVE_GHOSTS, JSON.stringify(ghosts));
        return window.LiveSplit.GhostRunner.createGhostRunner({ getSplitsList: () => ["A", "B"] });
      };
      try {
        runnerWith(["off"]).updateGhostRunner(null);
        assert(!track.classList.contains("has-pins"), "no lane with ghosts off");
        runnerWith(["wr"]).updateGhostRunner(null);
        assert(track.classList.contains("has-pins"), "lane reserved before the run starts, so text does not jump");
      } finally {
        if (savedGhosts === null) localStorage.removeItem(KEYS.ACTIVE_GHOSTS); else localStorage.setItem(KEYS.ACTIVE_GHOSTS, savedGhosts);
        track.classList.toggle("has-pins", hadFlag);
      }
    });
  });
})();
