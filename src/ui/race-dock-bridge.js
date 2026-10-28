/**
 * src/ui/race-dock-bridge.js - OBS Custom Browser Dock Bridge
 *
 * Lets a separate page (dock.html, loaded as an OBS Custom Browser Dock) drive
 * the race connection without interacting with the browser source:
 * - The dock writes a command to localStorage (DOCK_COMMAND); the overlay hears
 *   it through the `storage` event, which only fires in *other* documents
 * - The overlay writes its race status (DOCK_STATUS) on race events and on a
 *   heartbeat, so the dock can show whether the overlay is reachable at all
 *
 * Experimental: only works if OBS gives the dock and the browser source the
 * same storage (same origin and browser profile).
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const HEARTBEAT_MS = 2000;

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
    if (!cmd || typeof cmd !== "object") return null;
    if (cmd.action !== "connect" && cmd.action !== "disconnect") return null;
    return { action: cmd.action, code: typeof cmd.code === "string" ? cmd.code.trim() : "", id: cmd.id ?? null };
  }

  /**
   * @param {Object} options
   * @param {Object} options.raceClient
   * @param {{connectWithCode: Function, disconnect: Function}} options.controls - from RaceControls.bindRaceControls
   * @param {Storage} [options.storage]
   * @param {Window} [options.target] - where `storage` events are heard
   */
  function createRaceDockBridge({ raceClient, controls, storage = window.localStorage, target = window } = {}) {
    let lastCommandId = null;
    let lastResult = "";
    let heartbeat = null;

    const publishStatus = () => {
      const status = { ...describeRaceStatus(raceClient), lastCommandId, lastResult, at: Date.now() };
      try { storage.setItem(STORAGE_KEYS.DOCK_STATUS, JSON.stringify(status)); } catch (_) {}
      return status;
    };

    const handleCommand = (raw) => {
      const cmd = parseDockCommand(raw);
      if (!cmd) return;
      lastCommandId = cmd.id;
      if (cmd.action === "disconnect") {
        controls.disconnect();
        lastResult = "disconnected";
      } else if (!window.LiveSplit.RaceIdentity.isValidRaceCode(cmd.code)) {
        lastResult = "invalid code";
      } else {
        controls.connectWithCode(cmd.code);
        lastResult = describeRaceStatus(raceClient).state === "connected" ? "connected" : "not connected (cooldown?)";
      }
      publishStatus();
    };

    const onStorage = (e) => {
      if (e && e.key === STORAGE_KEYS.DOCK_COMMAND) handleCommand(e.newValue);
    };

    return {
      publishStatus,
      handleCommand,
      start() {
        if (!raceClient || !controls) return;
        target.addEventListener("storage", onStorage);
        raceClient.subscribe((event) => {
          if (event === "race_connected" || event === "race_disconnected" || event === "race_standby_changed") publishStatus();
        });
        publishStatus();
        heartbeat = setInterval(publishStatus, HEARTBEAT_MS);
      },
      stop() {
        target.removeEventListener("storage", onStorage);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      }
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceDockBridge = {
    HEARTBEAT_MS,
    describeRaceStatus,
    parseDockCommand,
    createRaceDockBridge
  };
})();
