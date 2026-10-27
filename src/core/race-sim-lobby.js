/**
 * src/core/race-sim-lobby.js - Simulated Race Lobby, Countdown & Start
 *
 * Scripted pre-race flow for the local simulation:
 * - Progressive lobby: rivals join one by one (~0.5-5s) then ready up (~5.5-10s)
 * - Quick lobby: everyone already joined, ready-ups in three waves
 * - 3-second countdown (3, 2, 1, GO!) and the race start
 * Every scheduled step is cancelled when the simulation stops or the lobby
 * closes, so stale timers never touch a newer race.
 */

(function () {
  "use strict";

  const { SIMULATED_COMPETITORS } = window.LiveSplit.RaceSimRoster;

  const JOIN_DELAYS_MS = [500, 1000, 1600, 2100, 2700, 3200, 3800, 4400, 5000];
  const READY_DELAYS_MS = [5500, 6000, 6600, 7100, 7700, 8200, 8800, 9400, 10000];
  const PROGRESSIVE_COUNTDOWN_AT_MS = 10500;
  const QUICK_COUNTDOWN_AT_MS = 2300;
  const GO_BANNER_MS = 1500;

  /**
   * @param {Object} sim - Simulation context from race-simulation.js: { state, ctx, getStatus, setStatus,
   *   setCountdownTargetMs, setCountdownSeconds, getCountdownSeconds, pushRaceEvent, notifyListeners,
   *   getEntrants, getHostState, createEntrant }
   */
  function createSimLobby(sim) {
    const { state } = sim;

    function clearTimers() {
      state.simLobbyTimers.forEach(t => clearTimeout(t));
      state.simLobbyTimers.length = 0;
    }

    function schedule(fn, delayMs) {
      state.simLobbyTimers.push(setTimeout(fn, delayMs));
    }

    function isLobbyOpen() {
      const status = sim.getStatus();
      return state.isSimulating && (status === "open" || status === "lobby");
    }

    function markReady(entrant) {
      entrant.status = "ready";
      entrant.isReady = true;
    }

    function announce(type, user, text) {
      sim.pushRaceEvent({ type, user, text, timestamp: Date.now() });
      sim.notifyListeners("entrant_updated", null);
    }

    /**
     * GO: race in progress, every rival present and started.
     * Shared by the countdown and by the host starting their timer early.
     */
    function startRaceNow() {
      sim.setStatus("in_progress");
      sim.setCountdownSeconds(0);
      sim.setCountdownTargetMs(null);
      const entrants = sim.getEntrants();
      SIMULATED_COMPETITORS.forEach(cfg => {
        if (!entrants.has(cfg.id)) {
          entrants.set(cfg.id, sim.createEntrant(cfg, false));
        }
      });
      entrants.forEach(e => {
        e.status = "started";
        e.isReady = true;
      });
      sim.pushRaceEvent({ type: "started", text: "Race started! Good luck!", timestamp: Date.now() });
      sim.notifyListeners("race_started", null);

      // Keep the GO! banner briefly, then return to the normal standings view
      schedule(() => {
        if (!state.isSimulating) return;
        if (sim.getCountdownSeconds() === 0) {
          sim.setCountdownSeconds(null);
          sim.notifyListeners("entrant_updated", null);
        }
      }, GO_BANNER_MS);
    }

    function scheduleCountdown() {
      if (!isLobbyOpen()) return;
      sim.setStatus("starting");
      sim.setCountdownTargetMs(Date.now() + 3000);
      sim.setCountdownSeconds(3);
      sim.pushRaceEvent({ type: "starting", text: "Race countdown: 3s!", timestamp: Date.now() });
      sim.notifyListeners("race_countdown", { countdown: 3 });

      [2, 1].forEach((n) => {
        schedule(() => {
          if (!state.isSimulating || sim.getStatus() !== "starting") return;
          sim.setCountdownSeconds(n);
          sim.notifyListeners("race_countdown", { countdown: n });
        }, (3 - n) * 1000);
      });

      schedule(() => {
        if (!state.isSimulating) return;
        startRaceNow();
      }, 3000);
    }

    // Everyone is already in the room; ready-ups land in three quick waves
    function runQuickLobby(entrants, hostName) {
      sim.pushRaceEvent({ type: "join", user: hostName, text: `Race lobby opened (${entrants.size} runners)`, timestamp: Date.now() });

      schedule(() => {
        if (!isLobbyOpen()) return;
        ["sim_speeddemon", "sim_pixelknight"].forEach(id => { const e = entrants.get(id); if (e) markReady(e); });
        announce("ready", "SpeedDemon", "SpeedDemon is Ready");
      }, 500);

      schedule(() => {
        if (!isLobbyOpen()) return;
        ["sim_turboblaze", "sim_apex", "sim_frostbyte"].forEach(id => { const e = entrants.get(id); if (e) markReady(e); });
        announce("ready", "TurboBlaze", "TurboBlaze is Ready");
      }, 1100);

      schedule(() => {
        if (!isLobbyOpen()) return;
        entrants.forEach(markReady);
        announce("ready", "ShadowPacer", "All runners are ready!");
      }, 1700);

      schedule(scheduleCountdown, QUICK_COUNTDOWN_AT_MS);
    }

    // Rivals join one by one, then ready up one by one, then the countdown starts
    function runProgressiveLobby(entrants, hostName) {
      announce("join", hostName, "Race lobby opened");

      SIMULATED_COMPETITORS.forEach((cfg, idx) => {
        schedule(() => {
          if (!isLobbyOpen()) return;
          if (!entrants.has(cfg.id)) {
            const entrant = sim.createEntrant(cfg, true);
            entrant.status = "joined";
            entrant.isReady = false;
            entrants.set(cfg.id, entrant);
          }
          announce("join", cfg.username, `${cfg.username} joined the race`);
        }, JOIN_DELAYS_MS[idx] || ((idx + 1) * 550));
      });

      SIMULATED_COMPETITORS.forEach((cfg, idx) => {
        const isLast = (idx === SIMULATED_COMPETITORS.length - 1);
        schedule(() => {
          if (!isLobbyOpen()) return;
          let entrant = entrants.get(cfg.id);
          if (!entrant) {
            entrant = sim.createEntrant(cfg, true);
            entrants.set(cfg.id, entrant);
          }
          markReady(entrant);
          announce("ready", cfg.username, isLast ? `All runners are ready! (${entrants.size}/${entrants.size})` : `${cfg.username} is Ready`);
        }, READY_DELAYS_MS[idx] || (5500 + (idx * 500)));
      });

      schedule(scheduleCountdown, PROGRESSIVE_COUNTDOWN_AT_MS);
    }

    function startLobbySequence(isProgressive = true) {
      clearTimers();
      sim.setStatus("open");
      sim.setCountdownTargetMs(null);
      sim.setCountdownSeconds(null);
      if (sim.ctx.recentRaceEvents) sim.ctx.recentRaceEvents.length = 0;

      const hostName = sim.getHostState().username || "You";
      const entrants = sim.getEntrants();
      if (isProgressive) {
        runProgressiveLobby(entrants, hostName);
      } else {
        runQuickLobby(entrants, hostName);
      }
    }

    return { clearTimers, startRaceNow, scheduleCountdown, startLobbySequence };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceSimLobby = {
    createSimLobby
  };
})();
