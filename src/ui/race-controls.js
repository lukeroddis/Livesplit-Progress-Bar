/**
 * src/ui/race-controls.js - Live Race Settings Controls
 *
 * Wires the race section of the settings menu to the race client:
 * - Connect / Disconnect button with code validation and cooldown countdown
 * - Race badge and Test Race (simulation) badge states
 * - Spectator leaderboard refresh tick while connected
 * - Race client event handling (connect, entrants, mute, pin visibility, standby)
 */

(function () {
  "use strict";

  const MUTED_COLOR = "rgba(148, 163, 184, 0.9)";

  // Same rule the race client enforces before building any request URL
  const isValidRaceCodeInput = (v) => window.LiveSplit.RaceIdentity.isValidRaceCode(v);

  /**
   * Returns the race actions other controllers can drive (the OBS dock bridge),
   * or null without a race client.
   * @param {Object} options
   * @param {Object|null} options.raceClient
   * @param {Function} options.refreshLeaderboard
   * @param {Function} options.refreshGhosts - Re-render ghost/race markers at the last elapsed time
   * @param {Function} options.getSimulationInputs - () => { splitsList, gtComparisons, rtComparisons, isAlreadyRunning }
   */
  function bindRaceControls(options = {}) {
    const {
      raceClient = null,
      refreshLeaderboard = () => {},
      refreshGhosts = () => {},
      getSimulationInputs = () => ({ splitsList: [], gtComparisons: [], rtComparisons: [], isAlreadyRunning: false })
    } = options;

    const raceToggleBtn = document.getElementById("race-toggle-badge");
    const raceSimBtn = document.getElementById("race-sim-badge");
    const therunRaceCodeInp = document.getElementById("input-therun-race-code");
    const therunSaveBtn = document.getElementById("btn-save-therun-username");

    if (!raceClient) return null;

    let connectCooldownInterval = null;

    const clearConnectCooldownUI = () => {
      if (connectCooldownInterval) {
        clearInterval(connectCooldownInterval);
        connectCooldownInterval = null;
      }
    };

    const isActiveOrStandby = () => raceClient.isSimulating() ||
      (typeof raceClient.isConnected === "function" && raceClient.isConnected()) ||
      (typeof raceClient.isStandby === "function" && raceClient.isStandby());

    const syncConnectBtnState = () => {
      const isConn = typeof raceClient.isConnected === "function" && raceClient.isConnected();
      const isSim = typeof raceClient.isSimulating === "function" && raceClient.isSimulating();
      const isStb = typeof raceClient.isStandby === "function" && raceClient.isStandby();
      const isSimStb = typeof raceClient.isSimStandby === "function" && raceClient.isSimStandby();

      if (raceSimBtn) {
        if (isSim) {
          raceSimBtn.textContent = "🧪 Stop Sim";
          raceSimBtn.style.color = "#ef4444";
        } else if (isSimStb) {
          raceSimBtn.textContent = "⏳ Sim Standby";
          raceSimBtn.style.color = "#f59e0b";
        } else {
          raceSimBtn.textContent = "🧪 Test Race";
          raceSimBtn.style.color = "#f59e0b";
        }
      }

      if (raceToggleBtn) {
        if (isSim) {
          raceToggleBtn.textContent = "Race: Sim";
          raceToggleBtn.style.color = "#4ade80";
        } else if (isConn) {
          raceToggleBtn.textContent = `Race: ${raceClient.getRaceId()}`;
          raceToggleBtn.style.color = "#4ade80";
        } else if (isStb) {
          raceToggleBtn.textContent = "Race: Standby";
          raceToggleBtn.style.color = "#f59e0b";
        } else {
          raceToggleBtn.textContent = "Race: Off";
          raceToggleBtn.style.color = MUTED_COLOR;
        }
      }

      if (!therunSaveBtn) return;
      if (isConn || isSim || isStb) {
        clearConnectCooldownUI();
        therunSaveBtn.disabled = false;
        therunSaveBtn.textContent = "Disconnect";
        therunSaveBtn.classList.add("danger");
        therunSaveBtn.style.color = "#ef4444";
      } else if (!connectCooldownInterval) {
        therunSaveBtn.disabled = false;
        therunSaveBtn.textContent = "Connect";
        therunSaveBtn.classList.remove("danger");
        therunSaveBtn.style.color = "";
      }
    };

    const flashConnectButton = (text, color) => {
      if (!therunSaveBtn) return;
      therunSaveBtn.textContent = text;
      therunSaveBtn.style.color = color;
      setTimeout(() => syncConnectBtnState(), 1500);
    };

    const startCooldownCountdownUI = (durationMs = 5000, prefix = "Wait") => {
      if (!therunSaveBtn) return;
      clearConnectCooldownUI();
      // Sync the badges before disabling: with no cooldown running yet, the sync re-enables the button
      syncConnectBtnState();
      const endMs = Date.now() + durationMs;
      therunSaveBtn.disabled = true;
      therunSaveBtn.classList.remove("danger");
      therunSaveBtn.style.color = "";
      const updateTick = () => {
        const remSec = Math.ceil(Math.max(0, endMs - Date.now()) / 1000);
        if (remSec <= 0) {
          clearConnectCooldownUI();
          syncConnectBtnState();
        } else {
          therunSaveBtn.textContent = `${prefix} (${remSec}s)`;
        }
      };
      updateTick();
      connectCooldownInterval = setInterval(updateTick, 250);
    };

    const handleRaceDisconnect = () => {
      clearConnectCooldownUI();
      if (typeof raceClient.resetConnectCooldown === "function") {
        raceClient.resetConnectCooldown();
      }
      if (typeof raceClient.stopSimulation === "function" && raceClient.isSimulating()) {
        raceClient.stopSimulation();
      }
      if (typeof raceClient.disconnectFromRace === "function") {
        raceClient.disconnectFromRace();
      }
      if (typeof raceClient.setStandby === "function") {
        raceClient.setStandby(false);
      }
      syncConnectBtnState();
      refreshLeaderboard();
      refreshGhosts();
    };

    const handleManualRaceConnect = async () => {
      if (isActiveOrStandby()) {
        handleRaceDisconnect();
        return;
      }

      const codeVal = (therunRaceCodeInp ? therunRaceCodeInp.value : "").trim();
      if (!codeVal) {
        flashConnectButton("Enter Code", "#f59e0b");
        refreshLeaderboard();
        return;
      }

      if (!isValidRaceCodeInput(codeVal)) {
        flashConnectButton("Invalid Code", "#ef4444");
        refreshLeaderboard();
        return;
      }

      const remMs = typeof raceClient.getConnectCooldownRemainingMs === "function"
        ? raceClient.getConnectCooldownRemainingMs()
        : 0;
      if (remMs > 0) {
        startCooldownCountdownUI(remMs, "Wait");
        return;
      }

      const ok = typeof raceClient.connectToRace === "function" && raceClient.connectToRace(codeVal);
      if (ok) {
        syncConnectBtnState();
      } else {
        flashConnectButton("Invalid Code", "#ef4444");
      }
      refreshLeaderboard();
    };

    if (therunRaceCodeInp) {
      therunRaceCodeInp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleManualRaceConnect();
        }
      });
    }

    if (therunSaveBtn) {
      therunSaveBtn.addEventListener("click", handleManualRaceConnect);
    }

    if (raceToggleBtn) {
      raceToggleBtn.addEventListener("click", () => {
        if (isActiveOrStandby()) {
          handleRaceDisconnect();
        } else {
          handleManualRaceConnect();
        }
      });
    }

    if (raceSimBtn) {
      raceSimBtn.addEventListener("click", () => {
        if (raceClient.isSimulating()) {
          handleRaceDisconnect();
        } else {
          const { splitsList, gtComparisons, rtComparisons, isAlreadyRunning } = getSimulationInputs();
          raceClient.startSimulation(splitsList, gtComparisons, rtComparisons, { withLobby: !isAlreadyRunning, progressive: !isAlreadyRunning });
          syncConnectBtnState();
          refreshLeaderboard();
        }
      });
    }

    syncConnectBtnState();

    let spectatorTickTimer = null;
    const startSpectatorTick = () => {
      if (spectatorTickTimer) return;
      spectatorTickTimer = setInterval(() => {
        const isConn = typeof raceClient.isConnected === "function" && raceClient.isConnected();
        if (!isConn) {
          clearInterval(spectatorTickTimer);
          spectatorTickTimer = null;
          return;
        }
        refreshLeaderboard();
      }, 100);
    };
    const stopSpectatorTick = () => {
      if (spectatorTickTimer) {
        clearInterval(spectatorTickTimer);
        spectatorTickTimer = null;
      }
    };

    if (typeof raceClient.isConnected === "function" && raceClient.isConnected()) {
      startSpectatorTick();
    }

    raceClient.subscribe((event, data) => {
      if (event === "race_connected") {
        syncConnectBtnState();
        startSpectatorTick();
        refreshLeaderboard();
      } else if (event === "race_disconnected") {
        syncConnectBtnState();
        stopSpectatorTick();
        refreshLeaderboard();
      } else if (event === "entrants_update" || event === "entrant_updated") {
        refreshLeaderboard();
        refreshGhosts();
      } else if (event === "entrant_mute_changed") {
        if (data && data.userId) {
          const marker = document.getElementById(`ghost-marker-race-${data.userId}`);
          if (marker) {
            const globalPinsOn = typeof raceClient.areRacePinsVisible === "function" ? raceClient.areRacePinsVisible() : true;
            marker.style.display = (data.isMuted || !globalPinsOn) ? "none" : "flex";
          }
        }
      } else if (event === "race_pins_visibility_changed") {
        refreshGhosts();
      } else if (event === "race_standby_changed") {
        syncConnectBtnState();
      }
    });

    return {
      /** Connects to `code` (leaving any current race first), as if typed into the settings field. */
      connectWithCode(code) {
        if (isActiveOrStandby()) handleRaceDisconnect();
        if (therunRaceCodeInp) therunRaceCodeInp.value = String(code || "").trim();
        handleManualRaceConnect();
      },
      disconnect: handleRaceDisconnect
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceControls = {
    isValidRaceCodeInput,
    bindRaceControls
  };
})();
