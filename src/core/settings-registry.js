/**
 * src/core/settings-registry.js - Settings Registry (live controls)
 *
 * Describes each user-facing setting once, so the HUD badges, the OBS dock and
 * the per-widget settings panels all drive it the same way:
 * - SETTINGS: frozen definitions { id, label, group, where, type, ... }
 *   with get(app) / set(app, value) calling the existing controllers
 * - validateSettingValue: pure value normalisation per type
 * - describeSettings: the plain-data schema of a surface's settings (for the dock)
 * - createSettingsController(app): get / set / toggle / cycle / run / snapshot / options by id,
 *   notifying subscribers after every change made through it
 *
 * Changes made outside the controller (modal selects, ghost pills) are not
 * notified; consumers that mirror state should also re-read a snapshot.
 *
 * Types: "bool", "enum" (options: array or (app) => array), "splits"
 * ("auto" | "all" | "2".."60"), "ghosts" (array of ghost ids or comparison
 * names, [] = off), "range" (a whole number; options are the consecutive
 * allowed values, so a dock renders a slider from first to last, and values
 * outside are clamped), "action" (run(app, value) with value one of options; no
 * stored value, so no get / set and not in snapshots).
 * `optionLabels` (optional) maps option values to short display labels.
 * `showIf` (optional) { setting, equals }: only shown while another setting has that value.
 * `where` lists the surfaces a setting belongs on: "dock", "widget".
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const SPLITS_MIN = 2;
  const SPLITS_MAX = 60;
  const GHOST_IDS = Object.freeze(["wr", "pb", "best", "average", "worst"]);
  // Comparisons the built-in ghosts already cover (by name); the rest work as custom ghosts
  const BUILT_IN_COMPARISONS = ["personal best", "best segments", "average segments", "worst segments"];
  const COMPONENT_LABELS = { title: "Show title", timers: "Show timers", track: "Show track", leaderboard: "Show standings" };

  /** Pure: whether a splits comparison is offered as a ghost of its own (not PB / Best / Avg / Worst / WR). */
  function isCustomGhostComparison(name) {
    const low = String(name || "").toLowerCase();
    return !!low && !BUILT_IN_COMPARISONS.includes(low) && !low.includes("world record") && low !== "wr" && !GHOST_IDS.includes(low);
  }

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
    get: () => getLayoutEntry(compId)?.visible !== false,
    set: (app, value) => {
      window.hudLayout?.setComponentVisible?.(compId, value);
      if (compId === "leaderboard") app.refreshLeaderboard?.();
    }
  }));

  const SETTINGS = Object.freeze([
    {
      id: "profile",
      label: "Layout profile",
      group: "profile",
      where: ["dock"],
      type: "enum",
      // Quick switching between games: loads the profile like the settings menu's dropdown
      options: () => {
        const list = window.hudLayout?.getProfilesList?.() || [];
        return list.length > 0 ? list : ["Default"];
      },
      get: () => window.hudLayout?.getActiveProfileName?.() || "Default",
      set: (app, value) => window.hudLayout?.loadProfileByName?.(value)
    },
    {
      id: "comparison",
      label: "Comparison",
      group: "timers",
      where: ["dock", "widget"],
      type: "enum",
      options: (app) => app.state.comparisonsList,
      optionLabels: { "Personal Best": "Personal Best (PB)", "Best Segments": "Best Segments (Sum of Best)" },
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
      options: ["gametime", "realtime", "both"],
      optionLabels: { gametime: "Game", realtime: "Real", both: "Both" },
      get: (app) => app.state.timerDisplayMode,
      set: (app, value) => app.setTimerDisplayMode(value),
      // The badge cycles Game -> Real -> Both (Game) -> Both (Real)
      cycle: (app) => app.toggleTimingMethod()
    },
    {
      id: "timingMethod",
      label: "Primary timer",
      group: "timers",
      where: ["dock", "widget"],
      type: "enum",
      options: ["GameTime", "RealTime"],
      optionLabels: { GameTime: "Game", RealTime: "Real" },
      // Which timer leads only matters while both are shown
      showIf: { setting: "timerDisplay", equals: "both" },
      get: (app) => app.state.currentTimingMethod,
      set: (app, value) => app.setTimingMethodFocus(value)
    },
    {
      id: "golds",
      label: "Gold splits",
      group: "track",
      where: ["dock", "widget"],
      type: "bool",
      get: (app) => app.state.cachedEnableGolds !== false,
      set: (app, value) => app.setGoldSegments(value)
    },
    {
      id: "visibleSplits",
      label: "Visible splits",
      group: "track",
      where: ["dock", "widget"],
      type: "splits",
      get: () => localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto",
      set: (app, value) => app.setVisibleSplits(value),
      cycle: (app) => app.cycleVisibleSplits()
    },
    {
      id: "ghostsOn",
      label: "Ghosts on",
      group: "ghosts",
      where: ["dock", "widget"],
      type: "bool",
      // Off remembers the chosen ghosts, on brings them back
      get: (app) => app.ghostRunner.areGhostsEnabled(),
      set: (app, value) => app.setGhostsEnabled(value)
    },
    {
      id: "ghosts",
      label: "Ghosts",
      group: "ghosts",
      where: ["dock", "widget"],
      type: "ghosts",
      // Built-in ghosts plus the loaded splits' own comparisons (custom ghosts)
      options: (app) => [...GHOST_IDS, ...app.state.comparisonsList.filter(isCustomGhostComparison)],
      optionLabels: { wr: "🏆 WR", pb: "🥈 PB", best: "⭐ Best", average: "📊 Avg", worst: "🐢 Worst" },
      get: (app) => app.ghostRunner.getActiveGhostComparisons().filter((g) => g !== "off"),
      set: (app, value) => app.setGhostComparison(value.length > 0 ? value : ["off"]),
      cycle: (app) => app.cycleGhostComparison()
    },
    {
      id: "trackScroll",
      label: "Scroll splits",
      group: "track",
      where: ["dock"],
      type: "action",
      options: [-1, 0, 1],
      optionLabels: { "-1": "◀", "0": "Current", "1": "▶" },
      run: (app, value) => app.scrollTrack(value)
    },
    {
      id: "trackPosition",
      label: "Split view",
      group: "track",
      where: ["dock"],
      type: "range",
      // 0 = the start of the track; the end depends on split count, density and window
      options: (app) => Array.from({ length: app.getTrackScrollPosition().max + 1 }, (_, i) => i),
      get: (app) => app.getTrackScrollPosition().pos,
      set: (app, value) => app.setTrackScrollPosition(value)
    },
    {
      id: "racePins",
      label: "Race pins",
      group: "leaderboard",
      where: ["dock", "widget"],
      type: "bool",
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

  /** Pure: plain-data descriptions of a surface's settings, in registry order (functions dropped). */
  function describeSettings(where) {
    return listSettings(where).map((def) => {
      const out = { id: def.id, label: def.label, group: def.group, type: def.type };
      if (def.optionLabels) out.optionLabels = { ...def.optionLabels };
      if (def.showIf) out.showIf = { ...def.showIf };
      if (def.type === "splits") Object.assign(out, { min: SPLITS_MIN, max: SPLITS_MAX });
      return out;
    });
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
      case "action":
        return resolveOptions(def, app).includes(raw) ? { ok: true, value: raw } : { ok: false, error: "not an option" };
      case "splits": {
        if (raw === "auto" || raw === "all") return { ok: true, value: raw };
        const num = typeof raw === "number" ? raw : (typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? parseInt(raw, 10) : NaN);
        if (!Number.isInteger(num)) return { ok: false, error: "expected auto, all or a whole number" };
        return { ok: true, value: String(Math.max(SPLITS_MIN, Math.min(SPLITS_MAX, num))) };
      }
      case "range": {
        const num = typeof raw === "number" ? raw : (typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw) ? parseInt(raw, 10) : NaN);
        if (!Number.isInteger(num)) return { ok: false, error: "expected a whole number" };
        const opts = resolveOptions(def, app);
        if (opts.length === 0) return { ok: false, error: "no range" };
        return { ok: true, value: Math.max(opts[0], Math.min(opts[opts.length - 1], num)) };
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

    const isAction = (def) => !!def && def.type === "action";

    function get(id) {
      const def = getSettingDef(id);
      return def && !isAction(def) ? def.get(app) : undefined;
    }

    /** Validates then applies a value; returns the validation result. */
    function set(id, raw) {
      const def = getSettingDef(id);
      if (isAction(def)) return { ok: false, error: "an action, use run" };
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
      if (isAction(def)) return { ok: false, error: "an action, use run" };
      if (typeof def.cycle === "function") {
        def.cycle(app, dir);
        notify(id);
        return { ok: true, value: get(id) };
      }
      if (def.type === "bool") return toggle(id);
      const next = nextOption(resolveOptions(def, app), def.get(app), dir);
      return next === undefined ? { ok: false, error: "no options" } : set(id, next);
    }

    /** Validates then runs an action (nothing is stored, so nothing is notified). */
    function run(id, raw) {
      const def = getSettingDef(id);
      if (!isAction(def)) return { ok: false, error: "not an action" };
      const result = validateSettingValue(def, raw, app);
      if (result.ok) def.run(app, result.value);
      return result;
    }

    /** { id: value } for every setting (not action) on a surface (all settings without one). */
    function snapshot(where) {
      const out = {};
      listSettings(where).forEach((def) => {
        if (!isAction(def)) out[def.id] = def.get(app);
      });
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

    return { get, set, toggle, cycle, run, snapshot, options, subscribe };
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
    isCustomGhostComparison,
    getSettingDef,
    listSettings,
    describeSettings,
    validateSettingValue,
    nextOption,
    createSettingsController,
    installSettingsRegistry
  };
})();
