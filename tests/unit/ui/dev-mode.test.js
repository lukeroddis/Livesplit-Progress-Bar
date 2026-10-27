/**
 * tests/unit/ui/dev-mode.test.js
 * Unit tests for dev-mode
 */

(function () {
  "use strict";


    describe("Developer & Diagnostics Mode (Feature Gating)", () => {
      it("window.isDevMode, window.setDevMode, and window.toggleDevMode are exported", () => {
        assert(typeof window.isDevMode === "function", "window.isDevMode is function");
        assert(typeof window.setDevMode === "function", "window.setDevMode is function");
        assert(typeof window.toggleDevMode === "function", "window.toggleDevMode is function");
      });

      it("setDevMode(true) adds dev-mode class and persists to storage", () => {
        window.setDevMode(true, true);
        assertEqual(window.isDevMode(), true, "isDevMode returns true");
        assert(document.body.classList.contains("dev-mode"), "document.body has dev-mode class");
        assertEqual(localStorage.getItem("livesplit_dev_mode"), "true", "stored as true in localStorage");
      });

      it("setDevMode(false) removes dev-mode class and persists to storage", () => {
        window.setDevMode(false, true);
        assertEqual(window.isDevMode(), false, "isDevMode returns false");
        assert(!document.body.classList.contains("dev-mode"), "document.body removes dev-mode class");
        assertEqual(localStorage.getItem("livesplit_dev_mode"), "false", "stored as false in localStorage");
      });

      it("toggleDevMode() inverts active state correctly", () => {
        window.setDevMode(false, false);
        const res1 = window.toggleDevMode();
        assertEqual(res1, true, "toggle from false returns true");
        assert(document.body.classList.contains("dev-mode"), "body has dev-mode class");

        const res2 = window.toggleDevMode();
        assertEqual(res2, false, "toggle from true returns false");
        assert(!document.body.classList.contains("dev-mode"), "body does not have dev-mode class");
      });

      it("Ctrl+Shift+D keyboard shortcut toggles developer mode", () => {
        window.setDevMode(false, false);
        const ev = new KeyboardEvent("keydown", {
          key: "D",
          code: "KeyD",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true
        });
        window.dispatchEvent(ev);
        assertEqual(window.isDevMode(), true, "Ctrl+Shift+D enabled dev mode");

        window.dispatchEvent(ev);
        assertEqual(window.isDevMode(), false, "Ctrl+Shift+D disabled dev mode");
      });

      it("5 clicks on #overlay-version unlocks developer mode", () => {
        window.setDevMode(false, false);
        const verEl = document.getElementById("overlay-version");
        assert(verEl !== null, "#overlay-version exists");
        for (let i = 0; i < 5; i++) {
          verEl.click();
        }
        assertEqual(window.isDevMode(), true, "5 clicks on version unlocked dev mode");
        window.setDevMode(false, true); // Clean up
      });
    });
})();
