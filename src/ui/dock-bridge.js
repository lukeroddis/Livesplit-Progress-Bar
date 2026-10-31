/**
 * src/ui/dock-bridge.js - OBS Custom Browser Dock Bridge
 *
 * Lets a separate page (dock.html, loaded as an OBS Custom Browser Dock) drive
 * the overlay without interacting with the browser source:
 * - The dock writes a command to localStorage (DOCK_COMMAND); the overlay hears
 *   it through the `storage` event, which only fires in *other* documents.
 *   Commands: connect / disconnect (race code), set (a dock setting from the
 *   settings registry, validated there before anything changes) and run (a
 *   registry action such as split scrolling)
 * - The overlay is the only writer of settings. It publishes a full status
 *   snapshot (DOCK_STATUS) after every command, every settings change, race
 *   events and on a heartbeat, so the dock renders purely from the snapshot and
 *   can tell whether the overlay is reachable at all
 *
 * Status v2 carries the dock settings' schema (labels, types, groups), values and
 * options, so dock.html builds its controls from it and needs no copy of the
 * registry. It keeps the v1 race fields (state, raceId, lastCommandId, lastResult,
 * at) at the top level so older dock.html files keep working.
 *
 * Experimental: only works if OBS gives the dock and the browser source the
 * same storage (same origin and browser profile).
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const HEARTBEAT_MS = 2000;
  const STATUS_VERSION = 2;
  const ACTIONS = ["connect", "disconnect", "set", "run"];

  /** Pure: the dock-facing status for a race client. */
  function describeRaceStatus(raceClient) {
    const call = (name) => typeof raceClient?.[name] === "function" && raceClient[name]();
    if (call("isSimulating")) return { state: "sim", raceId: "" };
    if (call("isConnected")) return { state: "connected", raceId: String(raceClient.getRaceId?.() || "") };
    if (call("isStandby")) return { state: "standby", raceId: "" };
    return { state: "off", raceId: "" };
  }

  /** Pure: parses a DOCK_COMMAND value, or null if it is not a usable command. */
  function parseDockCommand(raw) {
    if (!raw || typeof raw !== "string") return null;
    let cmd;
    try { cmd = JSON.parse(raw); } catch (_) { return null; }
    if (!cmd || typeof cmd !== "object" || !ACTIONS.includes(cmd.action)) return null;
    const id = cmd.id ?? null;
    if (cmd.action === "set" || cmd.action === "run") {
      if (typeof cmd.setting !== "string" || !cmd.setting) return null;
      return { action: cmd.action, setting: cmd.setting, value: cmd.value, id };
    }
    return { action: cmd.action, code: typeof cmd.code === "string" ? cmd.code.trim() : "", id };
  }

  /** Pure: whether the dock may change a setting (registered and listed for the dock). */
  function isDockSetting(id) {
    const def = window.LiveSplit.SettingsRegistry.getSettingDef(id);
    return !!def && def.where.includes("dock");
  }

  /**
   * @param {Object} options
   * @param {Object} options.settings - Settings controller (app.settings)
   * @param {Object|null} [options.raceClient]
   * @param {{connectWithCode: Function, disconnect: Function}|null} [options.controls] - from RaceControls.bindRaceControls
   * @param {Function} [options.getProfileName] - Active layout profile, shown by the dock
   * @param {Storage} [options.storage]
   * @param {Window} [options.target] - where `storage` events are heard
   */
  function createDockBridge({
    settings,
    raceClient = null,
    controls = null,
    getProfileName = () => "",
    storage = window.localStorage,
    target = window
  } = {}) {
    let lastCommandId = null;
    let lastResult = "";
    let heartbeat = null;
    let unsubscribe = null;
    let unsubscribeRace = null;

    function describeSettings() {
      const schema = window.LiveSplit.SettingsRegistry.describeSettings("dock");
      const options = {};
      schema.forEach(({ id }) => {
        const opts = settings.options(id);
        if (opts.length > 0) options[id] = opts;
      });
      return { schema, values: settings.snapshot("dock"), options };
    }

    const publishStatus = () => {
      const race = describeRaceStatus(raceClient);
      const status = {
        v: STATUS_VERSION,
        ...race,
        race,
        settings: describeSettings(),
        profile: String(getProfileName() || ""),
        lastCommandId,
        lastResult,
        at: Date.now()
      };
      try { storage.setItem(STORAGE_KEYS.DOCK_STATUS, JSON.stringify(status)); } catch (_) {}
      return status;
    };

    function runRaceCommand(cmd) {
      if (!raceClient || !controls) return "race unavailable";
      if (cmd.action === "disconnect") {
        controls.disconnect();
        return "disconnected";
      }
      if (!window.LiveSplit.RaceIdentity.isValidRaceCode(cmd.code)) return "invalid code";
      // Already in that race (e.g. an older dock's Connect): reconnecting would reset the standings
      const now = describeRaceStatus(raceClient);
      if (now.state === "connected" && now.raceId === cmd.code) return "already connected";
      controls.connectWithCode(cmd.code);
      return describeRaceStatus(raceClient).state === "connected" ? "connected" : "not connected (cooldown?)";
    }

    // set changes a setting, run triggers an action (split scrolling)
    function runSettingCommand(cmd) {
      if (!isDockSetting(cmd.setting)) return "unknown setting";
      const result = cmd.action === "run" ? settings.run(cmd.setting, cmd.value) : settings.set(cmd.setting, cmd.value);
      return result.ok ? "ok" : `invalid value: ${result.error}`;
    }

    const handleCommand = (raw) => {
      const cmd = parseDockCommand(raw);
      if (!cmd) return;
      lastCommandId = cmd.id;
      lastResult = (cmd.action === "set" || cmd.action === "run") ? runSettingCommand(cmd) : runRaceCommand(cmd);
      publishStatus();
    };

    const onStorage = (e) => {
      if (e && e.key === STORAGE_KEYS.DOCK_COMMAND) handleCommand(e.newValue);
    };

    return {
      publishStatus,
      handleCommand,
      start() {
        if (!settings || heartbeat) return;
        target.addEventListener("storage", onStorage);
        unsubscribe = settings.subscribe(() => publishStatus());
        if (typeof raceClient?.subscribe === "function") {
          unsubscribeRace = raceClient.subscribe((event) => {
            if (event === "race_connected" || event === "race_disconnected" || event === "race_standby_changed") publishStatus();
          });
        }
        publishStatus();
        heartbeat = setInterval(publishStatus, HEARTBEAT_MS);
      },
      stop() {
        target.removeEventListener("storage", onStorage);
        unsubscribe?.();
        if (typeof unsubscribeRace === "function") unsubscribeRace();
        unsubscribe = unsubscribeRace = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      }
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.DockBridge = {
    HEARTBEAT_MS,
    STATUS_VERSION,
    describeRaceStatus,
    parseDockCommand,
    isDockSetting,
    createDockBridge
  };
})();
