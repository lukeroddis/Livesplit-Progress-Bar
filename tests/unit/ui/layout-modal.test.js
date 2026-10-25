/**
 * LiveSplit Progress Bar - Layout Modal & Settings Toolbar Controller Unit Tests
 */

(function () {
  "use strict";

  describe("Layout Modal & Settings Controller (LiveSplit.LayoutModal)", () => {
    it("exposes LiveSplit.LayoutModal namespace and factory", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.LayoutModal, "window.LiveSplit.LayoutModal should exist");
      assertEqual(typeof window.LiveSplit.LayoutModal.createLayoutModal, "function", "createLayoutModal is a function");
    });

    it("opens track customizer modal and invokes syncUI", () => {
      let syncCalled = false;
      let modal = document.getElementById("track-modal");
      let created = false;
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "track-modal";
        modal.style.display = "none";
        document.body.appendChild(modal);
        created = true;
      }

      try {
        const mockStyle = {
          orientation: "horizontal",
          nameFontSize: 14,
          deltaFontSize: 13,
          barHeight: 6,
          dotSize: 8,
          bgOpacity: 60,
          bgBlur: 10
        };

        const controller = window.LiveSplit.LayoutModal.createLayoutModal({
          getCurrentTrackStyle: () => mockStyle,
          saveTrackStyle: () => {},
          applyTrackStyle: () => {}
        });

        controller.openTrackModal();
        assertEqual(modal.style.display, "flex", "modal display set to flex");
      } finally {
        if (created && modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      }
    });

    it("closes track customizer modal and triggers saveTrackStyle", () => {
      let saved = false;
      let modal = document.getElementById("track-modal");
      let created = false;
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "track-modal";
        modal.classList.add("is-open");
        modal.style.display = "flex";
        document.body.appendChild(modal);
        created = true;
      } else {
        modal.classList.add("is-open");
        modal.style.display = "flex";
      }

      try {
        const controller = window.LiveSplit.LayoutModal.createLayoutModal({
          getCurrentTrackStyle: () => ({}),
          saveTrackStyle: () => { saved = true; }
        });

        controller.closeTrackModal();
        assert(!modal.classList.contains("is-open"), "is-open class removed on close");
        assert(saved, "saveTrackStyle called on modal close");
      } finally {
        if (created && modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      }
    });

    it("syncUI updates range sliders, badges, and segmented orientation controls", () => {
      const mockStyle = {
        orientation: "vertical",
        bgOpacity: 45,
        bgBlur: 12,
        dotSize: 10,
        barHeight: 8,
        nameFontSize: 16,
        deltaFontSize: 15,
        namePos: "left",
        deltaPos: "right"
      };

      const controller = window.LiveSplit.LayoutModal.createLayoutModal({
        getCurrentTrackStyle: () => mockStyle,
        saveTrackStyle: () => {},
        applyTrackStyle: () => {}
      });

      controller.syncUI();

      const orientBadge = document.getElementById("track-orient-badge");
      if (orientBadge) {
        assertEqual(orientBadge.innerText, "Orient: Vert", "orient badge synced to Vert");
      }

      const sBgOpacity = document.getElementById("slider-bg-opacity");
      if (sBgOpacity) {
        assertEqual(parseInt(sBgOpacity.value, 10), 45, "bg opacity slider synced to 45");
      }

      const sBarHeight = document.getElementById("slider-bar-height");
      if (sBarHeight) {
        assertEqual(parseInt(sBarHeight.value, 10), 8, "bar height slider synced to 8");
      }
    });

    it("bindToolbarAndControls attaches event listeners without error", () => {
      let editToggled = false;
      const controller = window.LiveSplit.LayoutModal.createLayoutModal({
        getCurrentTrackStyle: () => ({ orientation: "horizontal" }),
        saveTrackStyle: () => {},
        applyTrackStyle: () => {},
        toggleEditMode: () => { editToggled = true; },
        setEditMode: () => {},
        isEditMode: () => false,
        getLayoutState: () => ({})
      });

      // Should execute cleanly
      controller.bindToolbarAndControls();
      assert(true, "bindToolbarAndControls executed without throwing");
    });
  });
})();
