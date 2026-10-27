/**
 * tests/unit/ui/hud-bindings.test.js
 * Unit tests for hud-bindings (badge clicks and comparison hotkeys)
 */

(function () {
  "use strict";

  describe("HUD Bindings: comparison badge and hotkeys", () => {
    const list = () => window.getComparisonsList();
    const current = () => window.getCurrentComparison();
    const startAt = (name) => window.applyActiveComparison(name, false, false);
    const next = (name, step) => {
      const comps = list();
      return comps[(comps.indexOf(name) + step + comps.length) % comps.length];
    };
    const press = (init) => window.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ bubbles: true }, init)));

    it("clicking the comparison badge cycles forward", () => {
      startAt("Personal Best");
      document.getElementById("comparison-badge").click();
      assertEqual(current(), next("Personal Best", 1));
      startAt("Personal Best");
    });

    it("C cycles forward and Shift+C cycles backward", () => {
      startAt("Personal Best");
      press({ key: "c" });
      assertEqual(current(), next("Personal Best", 1), "C moves forward");
      startAt("Personal Best");
      press({ key: "C", shiftKey: true });
      assertEqual(current(), next("Personal Best", -1), "Shift+C moves backward");
      startAt("Personal Best");
    });
  });
})();
