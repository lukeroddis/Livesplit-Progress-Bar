/**
 * tests/unit/ui/layout-api.test.js
 * layout.js through its public window.hudLayout API: saved layout loading / merging,
 * component positioning (docked / floating track, anchored timers, edit-mode hiding),
 * edit mode, timer anchor cycling and the profile / logo / split-count wrappers.
 * Every test snapshots and restores the live layout state, track style and storage.
 */

(function () {
  "use strict";

  const { mountHtml } = window.TestUtils;
  const KEYS = window.LiveSplit.Storage.KEYS;
  const HL = () => window.hudLayout;
  const SNAPSHOT_KEYS = [KEYS.HUD_LAYOUT, KEYS.LEADERBOARD_LAYOUT, KEYS.TIMER_ANCHOR, KEYS.TRACK_STYLE,
    KEYS.CUSTOM_LOGO, KEYS.VISIBLE_SPLITS, KEYS.PROFILES_INDEX, KEYS.ACTIVE_PROFILE];

  const replaceContents = (target, source) => {
    Object.keys(target).forEach((k) => delete target[k]);
    Object.assign(target, JSON.parse(JSON.stringify(source)));
  };

  // Runs fn with the live layout restored afterwards (state objects, edit mode, storage)
  function withLayoutSnapshot(fn) {
    const state = HL().getState();
    const style = HL().getTrackStyle();
    const savedState = JSON.parse(JSON.stringify(state));
    const savedStyle = JSON.parse(JSON.stringify(style));
    const savedKeys = SNAPSHOT_KEYS.map((k) => [k, localStorage.getItem(k)]);
    const wasEdit = HL().isEditMode();
    try {
      return fn({ state, style });
    } finally {
      replaceContents(state, savedState);
      replaceContents(style, savedStyle);
      if (HL().isEditMode() !== wasEdit) HL().setEditMode(wasEdit);
      savedKeys.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)));
    }
  }

  describe("Layout API: saved layout loading", () => {
    it("merges a saved layout over the defaults and applies the saved timer anchor", () => withLayoutSnapshot(() => {
      localStorage.setItem(KEYS.HUD_LAYOUT, JSON.stringify({ title: { x: 7, y: 8 }, leaderboard: { x: 3, y: 4, scale: 1, visible: true } }));
      localStorage.setItem(KEYS.TIMER_ANCHOR, "left");
      const loaded = HL().loadSavedLayout();
      assertEqual([loaded.title.x, loaded.title.y, loaded.title.visible], [7, 8, true], "saved fields win, defaults fill the rest");
      assertEqual(loaded.track.docked, "bottom", "missing components come from the defaults");
      assertEqual(loaded.timers.anchor, "left");
      assertEqual(loaded.leaderboard.x, 3);
    }));

    it("falls back to the dedicated leaderboard key when the layout has no leaderboard", () => withLayoutSnapshot(() => {
      localStorage.setItem(KEYS.HUD_LAYOUT, JSON.stringify({ title: { x: 1, y: 1 } }));
      localStorage.setItem(KEYS.LEADERBOARD_LAYOUT, JSON.stringify({ x: 99, y: 77 }));
      const loaded = HL().loadSavedLayout();
      assertEqual([loaded.leaderboard.x, loaded.leaderboard.y], [99, 77]);
      assertEqual(loaded.leaderboard.scale, 1, "rest of the leaderboard from the defaults");
    }));

    it("uses the defaults (plus a saved leaderboard) when nothing or corrupt data is saved", () => withLayoutSnapshot(() => {
      localStorage.removeItem(KEYS.HUD_LAYOUT);
      localStorage.setItem(KEYS.LEADERBOARD_LAYOUT, JSON.stringify({ x: 55 }));
      assertEqual(HL().loadSavedLayout().leaderboard.x, 55, "no saved layout");

      localStorage.setItem(KEYS.HUD_LAYOUT, "{not json");
      const realWarn = console.warn;
      console.warn = () => {};
      try {
        const loaded = HL().loadSavedLayout();
        assertEqual(loaded.title.x, 42, "corrupt layout falls back to defaults");
        assertEqual(loaded.leaderboard.x, 55);
      } finally {
        console.warn = realWarn;
      }
    }));

    it("resetLayout restores the default positions and saves them", () => withLayoutSnapshot(() => {
      HL().getState().title.x = 900;
      HL().resetLayout();
      assertEqual(HL().getState().title.x, 42);
      assertEqual(JSON.parse(localStorage.getItem(KEYS.HUD_LAYOUT)).title.x, 42);
    }));
  });

  describe("Layout API: component positioning", () => {
    const HUD_HTML = `
      <div id="hud-comp-track" style="position: absolute;"></div>
      <div id="hud-comp-timers" style="position: absolute; width: 300px;"></div>
      <div id="hud-comp-title" style="position: absolute;"><span class="hud-scale-badge"></span></div>
      <button id="btn-dock-track"></button>
      <input type="checkbox" id="cb-toggle-title">`;

    function withHud(fn) {
      return withLayoutSnapshot((snap) => {
        const dom = mountHtml(HUD_HTML);
        try {
          return fn(Object.assign({ el: dom.el }, snap));
        } finally {
          dom.remove();
        }
      });
    }

    it("docks the horizontal track to the bottom, or floats it at its position", () => withHud(({ el, state, style }) => {
      style.orientation = "horizontal";
      Object.assign(state.track, { docked: "bottom", scale: 1.2, x: 0, y: 900 });
      HL().applyComponentLayout("track");
      const track = el("hud-comp-track");
      assert(track.classList.contains("docked-bottom"));
      assertEqual(track.style.transform, "scale(1.2)");
      assertEqual(el("btn-dock-track").innerText, "⚓ Docked");

      Object.assign(state.track, { docked: "none", scale: 1, x: 40, y: 300 });
      HL().applyComponentLayout("track");
      assert(!track.classList.contains("docked-bottom"));
      assertEqual([track.style.left, track.style.top], ["40px", "300px"]);
      assert(/100vw/.test(track.style.width) && /40px/.test(track.style.width), `width spans the rest of the screen (got ${track.style.width})`);
      assertEqual(el("btn-dock-track").innerText, "⛵ Float");
    }));

    it("docks the vertical track left or right, or floats it", () => withHud(({ el, state, style }) => {
      style.orientation = "vertical";
      const track = el("hud-comp-track");

      Object.assign(state.track, { docked: "left", scale: 1 });
      HL().applyComponentLayout("track");
      assert(track.classList.contains("docked-left"));
      assertEqual([track.style.left, track.style.width, track.style.transform], ["0px", "340px", ""]);

      Object.assign(state.track, { docked: "right", scale: 0.8 });
      HL().applyComponentLayout("track");
      assert(track.classList.contains("docked-right") && !track.classList.contains("docked-left"));
      assertEqual([track.style.right, track.style.transformOrigin], ["0px", "right top"]);

      Object.assign(state.track, { docked: "none", scale: 1, x: 60, y: 20 });
      HL().applyComponentLayout("track");
      assertEqual([track.style.left, track.style.top], ["60px", "20px"]);
      assertEqual(el("btn-dock-track").innerText, "⛵ Float");
    }));

    it("positions the timers from their right edge when right-anchored, left edge when left-anchored", () => withHud(({ el, state }) => {
      const timers = el("hud-comp-timers");
      Object.assign(state.timers, { x: 100, y: 30, scale: 1, anchor: "right", right: 25 });
      HL().applyComponentLayout("timers");
      assertEqual([timers.style.left, timers.style.right, timers.style.transformOrigin], ["auto", "25px", "right top"]);

      delete state.timers.right;
      HL().applyComponentLayout("timers");
      assertEqual(timers.style.right, `${Math.max(0, window.innerWidth - 400)}px`, "right offset derived from x");

      state.timers.anchor = "left";
      HL().applyComponentLayout("timers");
      assertEqual([timers.style.left, timers.style.right], ["100px", "auto"]);
    }));

    it("hidden components are dimmed in edit mode and removed outside it", () => withHud(({ el, state }) => {
      const title = el("hud-comp-title");
      Object.assign(state.title, { visible: false, scale: 1.5 });
      HL().applyComponentLayout("title");
      assert(title.classList.contains("is-hidden"));
      assertEqual(title.querySelector(".hud-scale-badge").innerText, "150%");
      assert(!el("cb-toggle-title").checked, "toolbar checkbox synced");

      HL().setEditMode(true);
      assert(title.classList.contains("edit-hidden") && !title.classList.contains("is-hidden"), "edit mode shows it dimmed");
    }));
  });

  describe("Layout API: edit mode, anchors and wrappers", () => {
    it("edit mode suppresses timer tooltips and restores them afterwards", () => withLayoutSnapshot(() => {
      const rta = document.getElementById("block-rta");
      const igt = document.getElementById("block-igt");
      const saved = [rta.title, igt.title, rta.dataset.origTitle, igt.dataset.origTitle];
      rta.title = "Real time";
      igt.title = "Game time";
      delete rta.dataset.origTitle;
      delete igt.dataset.origTitle;
      try {
        HL().setEditMode(true);
        assert(document.body.classList.contains("edit-mode"));
        assert(!rta.hasAttribute("title") && !igt.hasAttribute("title"), "tooltips removed while editing");
        HL().setEditMode(false);
        assert(!document.body.classList.contains("edit-mode"));
        assertEqual([rta.title, igt.title], ["Real time", "Game time"], "tooltips restored");
      } finally {
        [rta.title, igt.title] = saved;
        if (saved[2] === undefined) delete rta.dataset.origTitle; else rta.dataset.origTitle = saved[2];
        if (saved[3] === undefined) delete igt.dataset.origTitle; else igt.dataset.origTitle = saved[3];
      }
    }));

    it("cycleTimerAnchor goes auto -> right -> left -> auto", () => withLayoutSnapshot(() => {
      HL().setTimerAnchor("auto");
      const seen = [];
      for (let i = 0; i < 3; i++) { window.cycleTimerAnchor(); seen.push(HL().getTimerAnchor()); }
      assertEqual(seen, ["right", "left", "auto"]);
    }));

    it("setVisibleSplits persists the split count", () => withLayoutSnapshot(() => {
      HL().setVisibleSplits(10);
      assertEqual(localStorage.getItem(KEYS.VISIBLE_SPLITS), "10");
    }));

    it("profile wrappers reach the profiles engine", async () => {
      assert(HL().getProfilesList().includes("Default"));
      assertEqual(HL().deleteProfileFromStorage("Default"), false, "Default can never be deleted");
      assertEqual(HL().autoLoadProfileForGame("No Such Game At All"), false, "no matching profile");
      HL().syncProfileUI();
      let rejected = null;
      try {
        await HL().importProfileFromFile(null);
      } catch (e) {
        rejected = e.message;
      }
      assertEqual(rejected, "No file selected");
    });

    it("logo wrappers save and remove the custom logo", () => withLayoutSnapshot(() => {
      const realWarn = console.warn;
      console.warn = () => {};
      try {
        HL().saveGameLogo("data:image/png;base64,AAAA");
        assertEqual(localStorage.getItem(KEYS.CUSTOM_LOGO), "data:image/png;base64,AAAA");
        HL().removeGameLogo();
        assertEqual(localStorage.getItem(KEYS.CUSTOM_LOGO), null);
      } finally {
        console.warn = realWarn;
      }
    }));
  });
})();
