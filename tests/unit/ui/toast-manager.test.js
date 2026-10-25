/**
 * tests/unit/ui/toast-manager.test.js
 * Unit tests for LiveSplit.ToastManager HUD notification controller
 */

(function () {
  "use strict";

  describe("HUD Toast Manager: LiveSplit.ToastManager", () => {
    it("exports complete public API on window.LiveSplit.ToastManager", () => {
      const tm = window.LiveSplit && window.LiveSplit.ToastManager;
      assert(tm !== undefined && tm !== null, "ToastManager is exposed on window.LiveSplit");
      assertEqual(typeof tm.getToastElement, "function", "getToastElement is a function");
      assertEqual(typeof tm.showToast, "function", "showToast is a function");
      assertEqual(typeof tm.hideToast, "function", "hideToast is a function");
      assertEqual(typeof tm.showComparisonToast, "function", "showComparisonToast is a function");
      assertEqual(typeof tm.showDevModeToast, "function", "showDevModeToast is a function");
    });

    it("getToastElement retrieves existing #hud-toast or creates it if missing", () => {
      const tm = window.LiveSplit.ToastManager;
      const el = tm.getToastElement();
      assert(el !== null, "Toast element is returned");
      assertEqual(el.id, "hud-toast", "Has correct id #hud-toast");
      assert(el.classList.contains("hud-toast"), "Has .hud-toast class");
    });

    it("showToast updates content, adds .show class, and can be cleared via hideToast", () => {
      const tm = window.LiveSplit.ToastManager;
      const testContent = "<span>Test Notification</span>";
      const toast = tm.showToast(testContent, 5000);
      assert(toast.classList.contains("show"), "Toast has .show class after showToast");
      assertEqual(toast.innerHTML, testContent, "Toast innerHTML matches provided markup");

      tm.hideToast();
      assert(!toast.classList.contains("show"), "Toast lacks .show class after hideToast");
    });

    it("showComparisonToast formats comparison notification with escaped text", () => {
      const tm = window.LiveSplit.ToastManager;
      const toast = tm.showComparisonToast("Personal & Best <100%>");
      assert(toast !== null, "Returns toast element");
      assert(toast.classList.contains("show"), "Toast has .show class");
      assert(toast.innerHTML.includes("⚖️ Comparison:"), "Includes comparison icon and label");
      assert(toast.innerHTML.includes("Personal &amp; Best &lt;100%&gt;"), "Sanitizes comparison name");

      // Returns null on falsy comparison
      const emptyToast = tm.showComparisonToast("");
      assertEqual(emptyToast, null, "Returns null when comparison name is empty");

      tm.hideToast();
    });

    it("showDevModeToast displays formatted enabled and disabled alerts", () => {
      const tm = window.LiveSplit.ToastManager;

      // Enabled state
      const toastOn = tm.showDevModeToast(true);
      assert(toastOn.classList.contains("show"), "Toast is visible for enabled dev mode");
      assert(toastOn.innerHTML.includes("Developer Mode:"), "Includes Developer Mode title");
      assert(toastOn.innerHTML.includes("Enabled"), "Contains Enabled text");

      // Disabled state
      const toastOff = tm.showDevModeToast(false);
      assert(toastOff.classList.contains("show"), "Toast is visible for disabled dev mode");
      assert(toastOff.innerHTML.includes("Disabled"), "Contains Disabled text");

      tm.hideToast();
    });

    it("window.showComparisonToast and window.showDevModeToast delegate to ToastManager", () => {
      assert(typeof window.showComparisonToast === "function", "window.showComparisonToast exists");
      assert(typeof window.showDevModeToast === "function", "window.showDevModeToast exists");

      const t1 = window.showComparisonToast("Average Segments");
      assert(t1 !== null, "window.showComparisonToast returns toast element");
      assert(t1.innerHTML.includes("Average Segments"), "Toast contains Average Segments");

      const t2 = window.showDevModeToast(true);
      assert(t2 !== null, "window.showDevModeToast returns toast element");
      assert(t2.innerHTML.includes("Developer Mode:"), "Toast contains Developer Mode");

      window.LiveSplit.ToastManager.hideToast();
    });
  });
})();
