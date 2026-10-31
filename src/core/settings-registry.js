/**
 * src/core/settings-registry.js - Settings Registry (live controls)
 *
 * Describes each user-facing setting once, so the HUD badges, the OBS dock and
 * the per-widget settings panels all drive it the same way:
 * - SETTINGS: frozen definitions { id, label, group, where, type, apply, ... }
 *   with get(app) / set(app, value) calling the existing controllers
 * - validateSettingValue: pure value normalisation per type
 * - createSettingsController(app): get / set / toggle / cycle / snapshot / options by id,
 *   notifying subscribers after every change made through it
 *
 * Changes made outside the controller (modal selects, ghost pills) are not
 * notified; consumers that mirror state should also re-read a snapshot.
 *
 * Types: "bool", "enum" (options: array or (app) => array), "splits"
 * ("auto" | "all" | "2".."60"), "ghosts" (array of ghost ids or comparison
 * names, [] = off).
 * `where` lists the surfaces a setting belongs on: "dock", "widget".
 * `apply` is "instant" (applied on change) or "draft" (preview, then save / revert).
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const SPLITS_MIN = 2;
  const SPLITS_MAX = 60;
  const GHOST_IDS = Object.freeze(["wr", "pb", "best", "average", "worst"]);
  const COMPONENT_LABELS = { title: "Show title", timers: "Show timers", track: "Show track", leaderboard: "Show standings" };

  const raceClientOf = (app) => (typeof app.getRaceClient === "function" ? app.getRaceClient() : null);

  function getLayoutEntry(id) {
    const layout = window.hudLayout?.getState?.();
    return layout ? layout[id] : null;
  }

  const componentSettings = window.LiveSplit.LayoutEngine.COMPONENTS.map((compId) => ({
    id: `visible.${compId}`,
    label: COMPONENT_LABELS[compId] || `Show ${compId}`,
    group: compId === "leaderboard" ? "leaderboard" : "visibility",
    where: ["dock"],
    type: "bool",
    apply: "instant",
    get: () => getLayoutEntry(compId)?.visible !== false,
    set: (app, value) => {
      window.hudLayout?.setComponentVisible?.(compId, value);
      if (compId === "leaderboard") app.refreshLeaderboard?.();
    }
  }));

  const SETTINGS = Object.freeze([
    {
      id: "comparison",
      label: "Comparison",
      group: "timers",
      where: ["dock", "widget"],
      type: "enum",
      apply: "instant",
      options: (app) => app.state.comparisonsList,
      get: (app) => app.state.currentComparison,
      set: (app, value) => app.applyActiveComparison(value, true),
      cycle: (app, dir) => app.cycleComparison(dir < 0)
    },
    {
      id: "timerDisplay",
      label: "Timers shown",
      group: "timers",
      where: ["dock", "widget"],
      type: "enum",
      apply: "instant",
      options: ["gametime", "realtime", "both"],
      get: (app) => app.state.timerDisplayMode,
      set: (app, value) => app.setTimerDisplayMode(value),
      // The badge cycles Game -> Real -> Both (Game) -> Both (Real)
      cycle: (app) => app.toggleTimingMethod()
    },
    {
      id: "timingMethod",
      label: "Timing method",
      group: "timers",
      where: ["dock", "widget"],
      type: "enum",
      apply: "instant",
      options: ["GameTime", "RealTime"],
      get: (app) => app.state.currentTimingMethod,
      set: (app, value) => app.setTimingMethodFocus(value)
    },
    {
      id: "golds",
      label: "Gold splits",
      group: "track",
      where: ["dock", "widget"],
      type: "bool",
      apply: "instant",
      get: (app) => app.state.cachedEnableGolds !== false,
      set: (app, value) => app.setGoldSegments(value)
    },
    {
      id: "visibleSplits",
      label: "Visible splits",
      group: "track",
      where: ["dock", "widget"],
      type: "splits",
      apply: "instant",
      get: () => localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto",
      set: (app, value) => app.setVisibleSplits(value),
      cycle: (app) => app.cycleVisibleSplits()
    },
    {
      id: "ghosts",
      label: "Ghosts",
      group: "track",
      where: ["dock", "widget"],
      type: "ghosts",
      apply: "instant",
      // Built-in ghosts plus the loaded splits' own comparisons (custom ghosts)
      options: (app) => [...GHOST_IDS, ...app.state.comparisonsList.filter((c) => !GHOST_IDS.includes(c))],
      get: (app) => app.ghostRunner.getActiveGhostComparisons().filter((g) => g !== "off"),
      set: (app, value) => app.setGhostComparison(value.length > 0 ? value : ["off"]),
      cycle: (app) => app.cycleGhostComparison()
    },
    {
      id: "racePins",
      label: "Race pins",
      group: "leaderboard",
      where: ["dock", "widget"],
      type: "bool",
      apply: "instant",
      get: (app) => {
        const rc = raceClientOf(app);
        return typeof rc?.areRacePinsVisible === "function" ? rc.areRacePinsVisible() : true;
      },
      // The race client's race_pins_visibility_changed event re-renders the markers
      set: (app, value) => raceClientOf(app)?.setRacePinsVisible?.(value)
    },
    ...componentSettings
  ].map((def) => Object.freeze(def)));

  const BY_ID = new Map(SETTINGS.map((def) => [def.id, def]));

  function getSettingDef(id) {
    return BY_ID.get(id) || null;
  }

  /** Settings for one surface ("dock" / "widget"), optionally one group, in registry order. */
  function listSettings(where, group) {
    return SETTINGS.filter((def) => (!where || def.where.includes(where)) && (!group || def.group === group));
  }

  function resolveOptions(def, app) {
    const opts = typeof def.options === "function" ? def.options(app) : def.options;
    return Array.isArray(opts) ? opts : [];
  }

  /**
   * Pure (given the app for dynamic options): normalises a raw value for a setting.
   * @returns {{ok: true, value: *}|{ok: false, error: string}}
   */
  function validateSettingValue(def, raw, app) {
    if (!def) return { ok: false, error: "unknown setting" };
    switch (def.type) {
      case "bool":
        if (raw === true || raw === "true") return { ok: true, value: true };
        if (raw === false || raw === "false") return { ok: true, value: false };
        return { ok: false, error: "expected true or false" };
      case "enum":
        return resolveOptions(def, app).includes(raw) ? { ok: true, value: raw } : { ok: false, error: "not an option" };
      case "splits": {
        if (raw === "auto" || raw === "all") return { ok: true, value: raw };
        const num = typeof raw === "number" ? raw : (typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? parseInt(raw, 10) : NaN);
        if (!Number.isInteger(num)) return { ok: false, error: "expected auto, all or a whole number" };
        return { ok: true, value: String(Math.max(SPLITS_MIN, Math.min(SPLITS_MAX, num))) };
      }
      case "ghosts": {
        const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? raw.split(",") : null);
        if (!list) return { ok: false, error: "expected a list of ghosts" };
        const ids = [];
        for (const item of list) {
          const id = typeof item === "string" ? item.trim() : "";
          if (!id || id === "off") continue;
          if (!resolveOptions(def, app).includes(id)) return { ok: false, error: `unknown ghost ${id}` };
          if (!ids.includes(id)) ids.push(id);
        }
        return { ok: true, value: ids };
      }
      default:
        return { ok: false, error: "unknown type" };
    }
  }

  /** Pure: the option after `current` in `options`, wrapping (first option if `current` is not listed). */
  function nextOption(options, current, dir = 1) {
    if (!options.length) return undefined;
    const idx = options.indexOf(current);
    if (idx === -1) return options[0];
    return options[(idx + (dir < 0 ? -1 : 1) + options.length) % options.length];
  }

  function createSettingsController(app) {
    const listeners = new Set();

    const notify = (id) => {
      const value = get(id);
      listeners.forEach((fn) => {
        try { fn(id, value); } catch (e) { console.error("[Settings] listener failed", e); }
      });
    };

    function get(id) {
      const def = getSettingDef(id);
      return def ? def.get(app) : undefined;
    }

    /** Validates then applies a value; returns the validation result. */
    function set(id, raw) {
      const def = getSettingDef(id);
      const result = validateSettingValue(def, raw, app);
      if (!result.ok) return result;
      def.set(app, result.value);
      notify(id);
      return result;
    }

    function toggle(id) {
      const def = getSettingDef(id);
      if (!def || def.type !== "bool") return { ok: false, error: "not a toggle" };
      return set(id, !def.get(app));
    }

    /** Steps a setting the way its HUD badge does (custom cycle, else the next enum option). */
    function cycle(id, dir = 1) {
      const def = getSettingDef(id);
      if (!def) return { ok: false, error: "unknown setting" };
      if (typeof def.cycle === "function") {
        def.cycle(app, dir);
        notify(id);
        return { ok: true, value: get(id) };
      }
      if (def.type === "bool") return toggle(id);
      const next = nextOption(resolveOptions(def, app), def.get(app), dir);
      return next === undefined ? { ok: false, error: "no options" } : set(id, next);
    }

    /** { id: value } for every setting on a surface (all settings without one). */
    function snapshot(where) {
      const out = {};
      listSettings(where).forEach((def) => { out[def.id] = def.get(app); });
      return out;
    }

    /** The current options of an enum / ghosts setting ([] for other types). */
    function options(id) {
      const def = getSettingDef(id);
      return def ? [...resolveOptions(def, app)] : [];
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return { get, set, toggle, cycle, snapshot, options, subscribe };
  }

  /** Registers the overlay's settings controller as app.settings. */
  function installSettingsRegistry(app) {
    return Object.assign(app, {
      settings: createSettingsController(app)
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsRegistry = {
    SETTINGS,
    GHOST_IDS,
    getSettingDef,
    listSettings,
    validateSettingValue,
    nextOption,
    createSettingsController,
    installSettingsRegistry
  };
})();
