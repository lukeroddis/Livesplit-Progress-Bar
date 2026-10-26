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
          applyTrackStyle: () => {},
          syncTimerAnchorUI: () => { syncCalled = true; }
        });

        controller.openTrackModal();
        assertEqual(modal.style.display, "flex", "modal display set to flex");
        assert(syncCalled, "opening the modal syncs the settings UI");
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

      controller.bindToolbarAndControls();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "F2" }));
      assert(editToggled, "F2 hotkey toggles edit mode");
    });
  });
  describe("Layout Modal: toolbar, triggers, hotkeys and resize clamp", () => {
    const { mountHtml, captureWindowListeners, withFakeTimers, stubOverlay } = window.TestUtils;

    const MODAL_HTML = `
      <button id="btn-lock-layout"></button><button id="btn-reset-layout"></button><button id="layout-edit-btn"></button>
      <input type="checkbox" id="cb-toggle-title"><input type="checkbox" id="cb-toggle-track">
      <button id="btn-open-track-modal"></button><button id="track-style-badge"></button>
      <div id="track-modal" style="display: none;"><div class="dialog">
        <button id="btn-close-track-modal"></button><button id="btn-save-track-style"></button><button id="btn-reset-track-style"></button>
        <input type="range" id="slider-logo-height" min="20" max="200"><span id="val-logo-height"></span>
        <input type="text" id="lm-text-input">
      </div></div>
      <div id="layout-import-modal"></div><div id="layout-export-modal"></div>
      <div id="hud-comp-timers" style="position: absolute; width: 300px;"></div>`;

    // Mounts the toolbar / modal DOM, binds a controller with recording callbacks and captures
    // its window listeners (keydown, resize) so specs can fire them directly
    function withModal(fn, overrides = {}) {
      const dom = mountHtml(MODAL_HTML);
      const log = { calls: [], applied: [] };
      const rec = (name) => (...args) => { log.calls.push([name, ...args]); };
      const style = { logoHeight: 80 };
      const layout = {
        title: { x: 5000, y: 5000, visible: true, docked: "none" },
        timers: { x: 5000, y: -50, visible: true, docked: "none" },
        track: { x: 0, y: 5000, visible: true, docked: "bottom" }
      };
      const logo = { synced: [], bound: 0, syncModalUI(h) { this.synced.push(h); }, bindEvents() { this.bound++; } };
      // The profiles panel's document click listener outlives the test, so unknown methods are no-ops
      const profiles = new Proxy({ closeImportModal: rec("closeImport"), closeExportModal: rec("closeExport") },
        { get: (t, k) => (k in t ? t[k] : () => {}) });
      let editMode = false;
      const opts = Object.assign({
        getCurrentTrackStyle: () => style,
        saveTrackStyle: rec("saveStyle"),
        applyTrackStyle: rec("applyStyle"),
        resetTrackStyle: rec("resetStyle"),
        getLayoutState: () => layout,
        saveLayout: rec("saveLayout"),
        resetLayout: rec("resetLayout"),
        setEditMode: rec("setEdit"),
        toggleEditMode: rec("toggleEdit"),
        isEditMode: () => editMode,
        applyComponentLayout: (id) => log.applied.push(id),
        getTimerAnchor: () => "auto",
        syncTimerAnchorUI: rec("syncAnchor"),
        getGameLogoController: () => logo,
        getProfilesEngine: () => profiles
      }, overrides);
      const ctrl = window.LiveSplit.LayoutModal.createLayoutModal(opts);
      const win = captureWindowListeners(() => ctrl.bindToolbarAndControls());
      const called = (name) => log.calls.filter((c) => c[0] === name);
      const key = (k, target = document.body) => win.fire("keydown", { key: k, target, preventDefault: () => {} });
      try {
        return fn({ dom, el: dom.el, ctrl, log, called, layout, style, logo, win, key, setEdit: (v) => { editMode = v; } });
      } finally {
        dom.remove();
      }
    }

    it("toolbar buttons lock, reset and toggle edit mode", () => withModal(({ el, called }) => {
      el("btn-lock-layout").click();
      el("btn-reset-layout").click();
      el("layout-edit-btn").click();
      assertEqual(called("setEdit")[0], ["setEdit", false]);
      assertEqual(called("resetLayout").length, 1);
      assertEqual(called("toggleEdit").length, 1);
    }));

    it("visibility checkboxes show or hide a component and save", () => withModal(({ el, log, layout, called }) => {
      const cb = el("cb-toggle-title");
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
      assertEqual(layout.title.visible, false);
      assertEqual(log.applied, ["title"]);
      assertEqual(called("saveLayout").length, 1);
    }));

    it("modal triggers open, close (buttons and backdrop) and reset styles", () => withFakeTimers((clock) => withModal(({ dom, el, called, logo }) => {
      const modal = el("track-modal");
      el("track-style-badge").click();
      assertEqual(modal.style.display, "flex");
      clock.tick(10);
      assert(modal.classList.contains("is-open"), "fades in");
      assertEqual(logo.synced, [80], "logo controls synced to the style's logo height");

      dom.root.querySelector("#track-modal .dialog").click();
      assert(modal.classList.contains("is-open"), "clicks inside the dialog keep it open");
      modal.click();
      assert(!modal.classList.contains("is-open"), "backdrop click closes");
      clock.tick(200);
      assertEqual(modal.style.display, "none");

      el("btn-open-track-modal").click();
      el("btn-close-track-modal").click();
      el("btn-open-track-modal").click();
      el("btn-save-track-style").click();
      assertEqual(called("saveStyle").length, 3, "every close saves the style");
      el("btn-reset-track-style").click();
      assertEqual(called("resetStyle").length, 1);
    })));

    it("binds the logo controller and its height slider", () => withModal(({ el, logo, style, called }) => {
      assertEqual(logo.bound, 1);
      const slider = el("slider-logo-height");
      slider.value = "120";
      slider.dispatchEvent(new Event("input"));
      assertEqual(style.logoHeight, 120);
      assertEqual(el("val-logo-height").innerText, "120px");
      assertEqual(called("applyStyle").length, 1);
    }));

    it("syncUI does nothing without a track style", () => withModal(({ ctrl, logo }) => {
      ctrl.syncUI();
      assertEqual(logo.synced.length, 0);
    }, { getCurrentTrackStyle: () => null }));

    it("E and F2 toggle edit mode, except while typing", () => withModal(({ el, key, called }) => {
      key("e");
      key("E");
      key("F2");
      assertEqual(called("toggleEdit").length, 3);
      key("e", el("lm-text-input"));
      assertEqual(called("toggleEdit").length, 3, "ignored in text inputs");
    }));

    it("Escape closes the import modal, then export, then the track modal, then leaves edit mode", () => withFakeTimers(() => withModal(({ el, key, called, setEdit }) => {
      const importModal = el("layout-import-modal");
      const exportModal = el("layout-export-modal");
      const trackModal = el("track-modal");
      importModal.classList.add("is-open");
      exportModal.classList.add("is-open");
      trackModal.classList.add("is-open");
      setEdit(true);

      key("Escape");
      assertEqual(called("closeImport").length, 1, "import modal first");
      assertEqual(called("closeExport").length, 0);
      importModal.classList.remove("is-open");

      key("Escape");
      assertEqual(called("closeExport").length, 1, "export modal next");
      exportModal.classList.remove("is-open");

      key("Escape");
      assert(!trackModal.classList.contains("is-open"), "track modal closed");
      assertEqual(called("setEdit").length, 0, "edit mode untouched while a modal was open");

      key("Escape");
      assertEqual(called("setEdit")[0], ["setEdit", false], "finally leaves edit mode");
      setEdit(false);
      key("Escape");
      assertEqual(called("setEdit").length, 1, "nothing left to close");
    })));

    it("resize keeps components on screen and re-docks the bottom track", () => stubOverlay({ refreshTrack: () => {} }, () => withModal(({ win, layout, log, called }) => {
      win.fire("resize");
      const w = window.innerWidth;
      const h = window.innerHeight;
      assertEqual([layout.title.x, layout.title.y], [w - 80, h - 50], "title clamped");
      assertEqual(layout.track.y, Math.max(0, h - 90), "docked track snapped to the new bottom");
      assertEqual(layout.timers.y, 0, "timers clamped vertically");
      assertEqual(layout.timers.right, Math.max(0, w - (layout.timers.x + 300)), "timers right offset kept in sync");
      assertEqual(log.applied.sort(), ["timers", "title", "track"]);
      assertEqual(called("syncAnchor").length >= 2, true, "anchor UI re-synced");
    })));

    it("resize keeps right-anchored timers on their right edge", () => stubOverlay({ refreshTrack: () => {} }, () => withModal(({ win, layout }) => {
      layout.timers = { x: 10, y: 10, right: 40, visible: true };
      win.fire("resize");
      assertEqual(layout.timers.right, 40, "right offset preserved");
      assertEqual(layout.timers.x, Math.max(0, window.innerWidth - (40 + 300)), "x follows the right edge");

      layout.timers = { x: 10, y: 10, visible: true };
      win.fire("resize");
      assertEqual(typeof layout.timers.right, "number", "right offset derived when missing");
    }, { getTimerAnchor: () => "right" })));

    it("resize keeps left-anchored timers on their left edge", () => stubOverlay({ refreshTrack: () => {} }, () => withModal(({ win, layout }) => {
      layout.timers = { x: 20, y: 10, right: 5, visible: true };
      win.fire("resize");
      assertEqual(layout.timers.x, 20, "x preserved");
      assertEqual(layout.timers.right, Math.max(0, window.innerWidth - 320), "right recomputed from x");
    }, { getTimerAnchor: () => "left" })));

    it("resize refreshes the track through the overlay API", () => {
      let refreshed = 0;
      stubOverlay({ refreshTrack: () => { refreshed++; } }, () => withModal(({ win }) => {
        win.fire("resize");
      }));
      assertEqual(refreshed, 1);
    });
  });
})();
