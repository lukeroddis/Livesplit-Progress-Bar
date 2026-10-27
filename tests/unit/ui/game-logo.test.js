/**
 * Speedrun Overlay - Custom Game Logo Unit Tests
 */

(function () {
  "use strict";

  function withCleanLogoEnv(fn) {
    const origStorage = localStorage.getItem("livesplit_custom_logo");
    try {
      fn();
    } finally {
      if (origStorage) {
        localStorage.setItem("livesplit_custom_logo", origStorage);
      } else {
        localStorage.removeItem("livesplit_custom_logo");
      }
      if (window.LiveSplit && window.LiveSplit.GameLogo) {
        const ctrl = window.LiveSplit.GameLogo.createGameLogo();
        ctrl.applyGameLogo(origStorage);
      }
    }
  }

  describe("Custom Game Logo Controller (LiveSplit.GameLogo)", () => {
    it("exposes LiveSplit.GameLogo namespace and createGameLogo factory", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.GameLogo, "window.LiveSplit.GameLogo should exist");
      assertEqual(typeof window.LiveSplit.GameLogo.createGameLogo, "function", "createGameLogo should be a function");
      assertEqual(window.LiveSplit.GameLogo.DEFAULT_LOGO_STORAGE_KEY, "livesplit_custom_logo", "default storage key matches");
    });

    it("applies logo image src, updates CSS variable, and adds .has-logo class", () => {
      withCleanLogoEnv(() => {
        const ctrl = window.LiveSplit.GameLogo.createGameLogo();
        const testSrc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        
        ctrl.applyGameLogo(testSrc, 80);

        const titleComp = document.getElementById("hud-comp-title");
        const logoImg = document.getElementById("game-logo");
        const previewImg = document.getElementById("game-logo-preview");
        const previewWrap = document.getElementById("game-logo-preview-wrap");
        const removeBtn = document.getElementById("btn-remove-game-logo");

        if (titleComp) assert(titleComp.classList.contains("has-logo"), "titleComp has .has-logo class");
        if (logoImg) {
          assertEqual(logoImg.src, testSrc, "logoImg has correct src");
          assertEqual(logoImg.style.display, "block", "logoImg is visible");
        }
        if (previewImg) assertEqual(previewImg.src, testSrc, "previewImg has correct src");
        if (previewWrap) assertEqual(previewWrap.style.display, "flex", "previewWrap is visible");
        if (removeBtn) assertEqual(removeBtn.style.display, "inline-flex", "removeBtn is visible");
        
        const cssH = document.documentElement.style.getPropertyValue("--game-logo-height");
        assertEqual(cssH, "80px", "CSS variable --game-logo-height set to 80px");
      });
    });

    it("clears logo state when null is applied", () => {
      withCleanLogoEnv(() => {
        const ctrl = window.LiveSplit.GameLogo.createGameLogo();
        ctrl.applyGameLogo(null);

        const titleComp = document.getElementById("hud-comp-title");
        const logoImg = document.getElementById("game-logo");
        const previewWrap = document.getElementById("game-logo-preview-wrap");
        const removeBtn = document.getElementById("btn-remove-game-logo");

        if (titleComp) assert(!titleComp.classList.contains("has-logo"), "titleComp has-logo removed");
        if (logoImg) assertEqual(logoImg.style.display, "none", "logoImg display hidden");
        if (previewWrap) assertEqual(previewWrap.style.display, "none", "previewWrap display hidden");
        if (removeBtn) assertEqual(removeBtn.style.display, "none", "removeBtn display hidden");
      });
    });

    it("saves logo to localStorage and triggers onLogoChange callback", () => {
      withCleanLogoEnv(() => {
        let notifiedSrc = null;
        const ctrl = window.LiveSplit.GameLogo.createGameLogo({
          onLogoChange: (src) => { notifiedSrc = src; }
        });

        const dummySrc = "data:image/png;base64,sampleLogoData123";
        ctrl.saveGameLogo(dummySrc);

        assertEqual(localStorage.getItem("livesplit_custom_logo"), dummySrc, "localStorage saved dummySrc");
        assertEqual(notifiedSrc, dummySrc, "onLogoChange callback received dummySrc");
        assertEqual(ctrl.getSavedLogo(), dummySrc, "getSavedLogo returned dummySrc");
      });
    });

    it("removes logo from localStorage and clears file input", () => {
      withCleanLogoEnv(() => {
        let notifiedSrc = "initial";
        const ctrl = window.LiveSplit.GameLogo.createGameLogo({
          onLogoChange: (src) => { notifiedSrc = src; }
        });

        localStorage.setItem("livesplit_custom_logo", "data:dummy");
        ctrl.removeGameLogo();

        assertEqual(localStorage.getItem("livesplit_custom_logo"), null, "localStorage item cleared");
        assertEqual(notifiedSrc, null, "onLogoChange callback received null");
        assertEqual(ctrl.getSavedLogo(), null, "getSavedLogo returned null");
      });
    });

    it("syncs modal preview and range slider to effective height", () => {
      withCleanLogoEnv(() => {
        const ctrl = window.LiveSplit.GameLogo.createGameLogo({
          getLogoHeight: () => 75
        });

        ctrl.syncModalUI(75);
        const sLogoH = document.getElementById("slider-logo-height");
        const vLogoH = document.getElementById("val-logo-height");

        if (sLogoH) assertEqual(sLogoH.value, "75", "slider-logo-height value set to 75");
        if (vLogoH) assertEqual(vLogoH.innerText, "75px", "val-logo-height text set to 75px");
      });
    });
  });
})();
