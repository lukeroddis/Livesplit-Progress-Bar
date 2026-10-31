/**
 * Speedrun Overlay - Layout Modal & Settings Toolbar Controller Unit Tests
 */

(function () {
  "use strict";

  describe("Layout Modal & Settings Controller (LiveSplit.LayoutModal)", () => {
    it("exposes LiveSplit.LayoutModal namespace and factory", () => {
      assert(window.LiveSplit, "window.LiveSplit namespace should exist");
      assert(window.LiveSplit.LayoutModal, "window.LiveSplit.LayoutModal should exist");
      assertEqual(typeof window.LiveSplit.LayoutModal.createLayoutModal, "function", "createLayoutModal is a function");
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
      <input type="range" id="slider-logo-height" min="20" max="200"><span id="val-logo-height"></span>
      <input type="text" id="lm-text-input">
      <div id="layout-import-modal"></div><div id="layout-export-modal"></div>
      <div id="hud-comp-timers" class="hud-component" data-component-id="timers" style="position: absolute; width: 300px;">
        <button data-action="open-settings" id="lm-cog-timers"></button>
      </div>
      <div class="hud-component" data-component-id="title"><button data-action="open-settings" id="lm-cog-title"></button></div>
      <div class="hud-component" data-component-id="leaderboard"><button data-action="open-settings" id="lm-cog-lb"></button></div>
      <div id="hud-comp-track" class="hud-component" data-component-id="track"><button data-action="open-settings" id="lm-cog-track"></button></div>
      <div class="widget-popover" id="lm-popover-track" data-widget="track" hidden>
        <button data-popover-reset id="lm-popover-reset"></button><button data-popover-close id="lm-popover-done"></button>
      </div>
      <div class="widget-popover" id="lm-popover-timers" data-widget="timers" hidden><button data-popover-reset id="lm-timers-reset"></button></div>
      <div class="widget-popover" data-widget="lm-no-style" hidden><button data-popover-reset id="lm-lb-reset"></button></div>
      <button id="lm-open-track" data-open-widget-popover="track"></button>
      <input type="checkbox" data-setting="golds" id="lm-golds">
      <div class="lm-section" data-widget-settings="title"></div>
      <div class="lm-section" data-widget-settings="leaderboard"></div>`;

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

    it("visibility checkboxes set the component's visible.* setting", () => withModal(({ el }) => {
      const sets = [];
      stubOverlay({ settings: { set: (id, value) => sets.push([id, value]) } }, () => {
        const cb = el("cb-toggle-title");
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
      });
      assertEqual(sets, [["visible.title", false]]);
    }));

    it("the leaderboard cog opens the settings menu at its race section; a cog without a popover does nothing else", () => withModal(({ el, dom }) => {
      const opened = [];
      const [titleSection, lbSection] = dom.root.querySelectorAll(".lm-section");
      stubOverlay({ toggleSettingsMenu: (v) => opened.push(["menu", v]) }, () => {
        el("lm-cog-title").click();
        assertEqual(opened, [], "no popover in this fixture: nothing opens");
        assert(!titleSection.classList.contains("widget-settings-flash"));

        el("lm-cog-lb").click();
        assertEqual(opened, [["menu", true]], "settings menu opened");
        assert(lbSection.classList.contains("widget-settings-flash"));
      });
    }));

    it("the track cog toggles its popover; Done saves, Reset restores only the track's keys", () => withModal(({ el, called }) => {
      const pop = el("lm-popover-track");
      el("lm-cog-track").click();
      assert(!pop.hidden, "popover opened");

      el("lm-popover-reset").click();
      assertEqual(called("resetStyle")[0], ["resetStyle", window.LiveSplit.TrackStyle.WIDGET_STYLE_KEYS.track]);

      const saves = called("saveStyle").length;
      el("lm-popover-done").click();
      assert(pop.hidden, "closed");
      assertEqual(called("saveStyle").length, saves + 1, "closing saves the style");

      el("lm-cog-track").click();
      el("lm-cog-track").click();
      assert(pop.hidden, "the cog toggles it closed");
    }));

    it("Escape closes the popover first; the settings menu's Widget Settings button opens it in Layout Mode", () => withModal(({ el, key, called }) => {
      const pop = el("lm-popover-track");
      const menu = [];
      stubOverlay({ toggleSettingsMenu: (v) => menu.push(v) }, () => el("lm-open-track").click());
      assert(!pop.hidden, "opened from the button");
      assertEqual(menu, [false], "the settings menu gets out of the way");
      assertEqual(called("setEdit"), [["setEdit", true]], "entered Layout Mode");
      key("Escape");
      assert(pop.hidden, "Escape closed it");
      assertEqual(called("setEdit").length, 1, "without leaving Layout Mode");
    }));

    it("the timers cog opens its popover; resets only reach a widget's own style keys", () => withModal(({ el, called }) => {
      el("lm-cog-timers").click();
      assert(!el("lm-popover-timers").hidden, "timers popover opened");
      el("lm-timers-reset").click();
      assertEqual(called("resetStyle"), [["resetStyle", window.LiveSplit.TrackStyle.WIDGET_STYLE_KEYS.timers]], "the timers' plate");
      el("lm-lb-reset").click();
      assertEqual(called("resetStyle").length, 1, "a widget without style keys never resets the whole style");
    }));

    it("data-setting checkboxes drive registry settings and follow changes made elsewhere", () => {
      const values = { golds: false };
      const listeners = [];
      const settings = {
        get: (id) => values[id],
        set: (id, v) => { values[id] = v; listeners.forEach((fn) => fn(id, v)); return { ok: true, value: v }; },
        subscribe: (fn) => { listeners.push(fn); return () => {}; }
      };
      stubOverlay({ settings }, () => withModal(({ el, ctrl }) => {
        const cb = el("lm-golds");
        ctrl.syncUI();
        assertEqual(cb.checked, false, "synced from the registry");
        cb.checked = true;
        cb.dispatchEvent(new Event("change"));
        assertEqual(values.golds, true, "set through the registry");
        settings.set("golds", false);
        assertEqual(cb.checked, false, "a change from the dock shows up");
      }));
    });

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

    it("Escape closes the import modal, then export, then the popover, then leaves edit mode", () => withFakeTimers(() => withModal(({ el, key, called, setEdit }) => {
      const importModal = el("layout-import-modal");
      const exportModal = el("layout-export-modal");
      const pop = el("lm-popover-track");
      importModal.classList.add("is-open");
      exportModal.classList.add("is-open");
      el("lm-cog-track").click();
      setEdit(true);

      key("Escape");
      assertEqual(called("closeImport").length, 1, "import modal first");
      assertEqual(called("closeExport").length, 0);
      importModal.classList.remove("is-open");

      key("Escape");
      assertEqual(called("closeExport").length, 1, "export modal next");
      exportModal.classList.remove("is-open");

      key("Escape");
      assert(pop.hidden, "popover closed");
      assertEqual(called("setEdit").length, 0, "edit mode untouched while something was open");

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
