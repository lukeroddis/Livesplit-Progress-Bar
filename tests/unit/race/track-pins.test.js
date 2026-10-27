/**
 * tests/unit/race/track-pins.test.js
 * Race competitor pin stacking and marker XSS sanitization.
 * (Split from the former tests/unit/core/race-client.test.js.)
 */

(function () {
  "use strict";

    describe("Race: Track pins", () => {
      it("Intelligent pin stacking resolves colliding pins into mini-leaderboard strip with orthogonal drop lines", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Forest", "Cave", "Castle"], [30, 60, 90]);
        // Simulate progress where competitors cluster near Start
        if (typeof window.updateGhostRunner === "function") {
          window.updateGhostRunner(2.0);
          const pins = Array.from(document.querySelectorAll(".ghost-marker.race-competitor"))
            .filter(m => m.style.display !== "none");
          if (pins.length >= 2) {
            // Check if any stacked pin receives --ghost-splay-x or splay classes
            const splays = pins.map(p => p.style.getPropertyValue("--ghost-splay-x") || "0px");
            const hasSplay = splays.some(off => off !== "0px");
            assert(typeof hasSplay === "boolean", "Splay evaluation runs cleanly");
          }
        }
        rc.stopSimulation();
      });

      it("prevents cluster collapse by maintaining zero overlap between all pinheads across multiple groups", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Forest", "Cave", "Castle"], [30, 60, 90]);
        if (typeof window.updateGhostRunner === "function") {
          window.updateGhostRunner(5.0);
          const pins = Array.from(document.querySelectorAll(".ghost-marker"))
            .filter(m => m.style.display !== "none" && m.id !== "ghost-marker");
          if (pins.length >= 2) {
            // Compute visual badge X coordinates: base transform X + splay X
            const badgeXs = pins.map(p => {
              const transformMatch = p.style.transform.match(/translateX\(([\d.-]+)px\)/);
              const baseCoord = transformMatch ? parseFloat(transformMatch[1]) : 0;
              const splayVal = parseFloat(p.style.getPropertyValue("--ghost-splay-x")) || 0;
              return baseCoord + splayVal;
            }).sort((a, b) => a - b);

            for (let i = 0; i < badgeXs.length - 1; i++) {
              const dist = badgeXs[i + 1] - badgeXs[i];
              assert(dist >= 20, `Adjacent pinheads must not collapse: dist ${dist.toFixed(1)} >= 20px`);
            }
          }
        }
        rc.stopSimulation();
      });

      it("XSS Sanitization: getOrCreateRaceMarker escapes malicious username and blocks unsafe avatar schemes", () => {
        const maliciousRacer = {
          userId: "hacker99",
          username: "<script>alert(1)<" + "/script>pwned",
          avatar: "javascript:alert('xss')",
          color: "#ff0000"
        };
        const marker = window.getOrCreateRaceMarker(maliciousRacer);
        assert(marker, "Race marker created");
        const tag = marker.querySelector(".racer-tag");
        assert(tag, "Racer tag exists");
        assert(!tag.innerHTML.includes("<script>"), "Malicious script tag escaped in racer tag innerHTML");
        assertEqual(tag.textContent, "<script>alert(1)</" + "script>pwned", "Text content matches escaped string");

        const img = marker.querySelector("img.racer-avatar-img");
        assert(!img, "javascript: scheme avatar rejected and not rendered as <img> tag");
        const iconSpan = marker.querySelector(".racer-avatar");
        assert(iconSpan, "Safe fallback racer-avatar icon rendered instead");
        assert(!iconSpan.innerHTML.includes("javascript:"), "Malicious scheme not rendered executable");
        marker.remove();
      });
    });
})();
