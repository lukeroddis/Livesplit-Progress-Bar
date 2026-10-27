/**
 * tests/unit/ui/layout.test.js
 * Unit tests for layout
 */

(function () {
  "use strict";


    describe("Layout Profiles & Extensible Schema v1", () => {
      it("exports layout profile helper functions on window.hudLayout", () => {
        assertEqual(typeof window.hudLayout.getProfilesList, "function");
        assertEqual(typeof window.hudLayout.getActiveProfileName, "function");
        assertEqual(typeof window.hudLayout.createProfileExport, "function");
        assertEqual(typeof window.hudLayout.applyProfileData, "function");
        assertEqual(typeof window.hudLayout.saveProfileToStorage, "function");
        assertEqual(typeof window.hudLayout.deleteProfileFromStorage, "function");
      });
      it("generates schema v1 export object with required properties", () => {
        const exp = window.hudLayout.createProfileExport("TestProfile");
        assertEqual(exp.version, 1);
        assertEqual(exp.$schema, undefined);
        assertEqual(exp.name, "TestProfile");
        assertEqual(typeof exp.components, "object");
        assertEqual(typeof exp.style, "object");
        assertEqual(typeof exp.preferences, "object");
      });
      it("deep merges older layouts gracefully for backward compatibility", () => {
        const legacy = {
          schemaVersion: 1,
          name: "Old Profile",
          components: {
            title: { x: 50, y: 50, visible: true }
          },
          style: {
            orientation: "horizontal",
            bgOpacity: 75
          }
        };
        window.hudLayout.applyProfileData(legacy, "Old Profile");
        const style = window.hudLayout.getTrackStyle();
        assertEqual(style.bgOpacity, 75);
        assertEqual(typeof style.barHeight, "number");
        assertEqual(typeof style.logoHeight, "number");
      });
    });
})();
