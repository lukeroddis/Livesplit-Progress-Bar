/**
 * Speedrun Overlay - Race Discovery & Auto-Detect Engine
 *
 * Encapsulates:
 * - REST polling to therun.gg live status API (https://therun.gg/api/live/{username})
 * - Single-shot race discovery and cooldown guard (5s cooldown)
 * - Event-driven run-start detection (handleHostRunStarted) with delayed retries
 * - Lobby and Simulation standby lifecycle and state transitions
 */
(function () {
  "use strict";

  const THERUN_LIVE_API = "https://therun.gg/api/live";
  const CONNECT_COOLDOWN_MS = 5000;

  function createRaceDiscovery(options = {}) {
    const {
      getSimEngine = () => null,
      isValidUsername = (u) => Boolean(u && typeof u === "string" && /^[a-zA-Z0-9_]{2,30}$/.test(u.trim())),
      getHostUsername = () => "",
      notifyListeners = () => {},
      getRaceId = () => null,
      getWebSocket = () => null,
      connectToRace = () => {},
      disconnectFromRace = () => {},
      startSimulation = () => {},
      isSimStandby = () => false,
      onStop = () => {}
    } = options;

    let autoDetectUsername = "";
    let isStandby = false;
    let lastConnectAttemptMs = 0;
    let isConnectInFlight = false;
    let runStartLookupTimers = [];

    function getConnectCooldownRemainingMs() {
      if (lastConnectAttemptMs <= 0) return 0;
      return Math.max(0, CONNECT_COOLDOWN_MS - (Date.now() - lastConnectAttemptMs));
    }

    function recordConnectAttempt() {
      lastConnectAttemptMs = Date.now();
    }

    function resetConnectCooldown() {
      lastConnectAttemptMs = 0;
      isConnectInFlight = false;
      clearRunStartLookupTimers();
    }

    function clearRunStartLookupTimers() {
      if (runStartLookupTimers.length > 0) {
        runStartLookupTimers.forEach((t) => clearTimeout(t));
        runStartLookupTimers = [];
      }
    }

    function setStandby(val) {
      const next = Boolean(val);
      const se = getSimEngine();
      if (!next && se && typeof se.clearStandby === "function") {
        se.clearStandby();
      }
      if (isStandby !== next) {
        isStandby = next;
        notifyListeners("race_standby_changed", {
          isStandby,
          isSimStandby: isSimStandby(),
          username: autoDetectUsername || getHostUsername()
        });
      }
      return isStandby;
    }

    function armSimulationStandby(splitsList = [], comparisonTimes = [], comparisonTimesRT = []) {
      clearRunStartLookupTimers();
      const ws = getWebSocket();
      if (ws) {
        disconnectFromRace();
      }
      const se = getSimEngine();
      if (se && typeof se.armSimulationStandby === "function") {
        return se.armSimulationStandby(splitsList, comparisonTimes, comparisonTimesRT);
      }
      return { status: "sim_standby", isStandby: true, isSimStandby: true };
    }

    function startAutoDetect(username) {
      if (!username || typeof username !== "string") return Promise.resolve({ status: "idle" });
      autoDetectUsername = username.trim();
      stopAutoDetect();

      // Single-shot lookup (no recurring background polling loop)
      return pollUserStatus(autoDetectUsername);
    }

    function stopAutoDetect() {
      clearRunStartLookupTimers();
      setStandby(false);
      if (typeof onStop === "function") {
        try {
          onStop();
        } catch (_) {}
      }
    }

    async function pollUserStatus(usernameOverride, ignoreCooldown = false) {
      const targetUser = (typeof usernameOverride === "string" ? usernameOverride : (autoDetectUsername || getHostUsername() || "")).trim();
      const sePoll = getSimEngine();
      if (!targetUser || (sePoll && sePoll.isSimulating())) {
        return { status: "idle", remainingMs: 0 };
      }
      if (!isValidUsername(targetUser)) {
        return { status: "invalid_username", remainingMs: 0 };
      }
      autoDetectUsername = targetUser;

      if (isConnectInFlight) {
        return { status: "in_flight", remainingMs: getConnectCooldownRemainingMs() };
      }

      const cooldownRem = getConnectCooldownRemainingMs();
      if (!ignoreCooldown && cooldownRem > 0) {
        return { status: "cooldown", remainingMs: cooldownRem };
      }

      isConnectInFlight = true;
      if (!ignoreCooldown) {
        lastConnectAttemptMs = Date.now();
      }

      const currentRaceId = getRaceId();
      const ws = getWebSocket();

      try {
        const res = await fetch(`${THERUN_LIVE_API}/${encodeURIComponent(targetUser)}`);
        if (!res.ok) {
          return { status: "error", remainingMs: CONNECT_COOLDOWN_MS };
        }

        const data = await res.json();
        if (data && data.raceId) {
          clearRunStartLookupTimers();
          setStandby(false);
          if (currentRaceId !== data.raceId || !ws || ws.readyState !== WebSocket.OPEN) {
            console.log(`[RaceDiscovery] Detected raceId from therun.gg: ${data.raceId} (reconnecting=${!ws || ws.readyState !== WebSocket.OPEN})`);
            connectToRace(data.raceId);
          }
          return { status: "connected", raceId: data.raceId, remainingMs: 0 };
        } else if (currentRaceId && !data?.raceId) {
          // Runner left race or race concluded
          console.log("[RaceDiscovery] Race status cleared on therun.gg. Disconnecting.");
          disconnectFromRace();
          return { status: "no_race", remainingMs: CONNECT_COOLDOWN_MS };
        }
        // Lobby Standby: user is not in an active race yet; arm standby for automatic lookup when LiveSplit timer starts
        setStandby(true);
        return { status: "no_race", isStandby: true, remainingMs: CONNECT_COOLDOWN_MS };
      } catch (err) {
        // Silent network failure guard (offline / rate limit)
        return { status: "error", remainingMs: CONNECT_COOLDOWN_MS };
      } finally {
        isConnectInFlight = false;
      }
    }

    function handleHostRunStarted(opts = {}) {
      const seStart = getSimEngine();
      if (seStart && seStart.isSimulating()) {
        seStart.handleHostRunStarted(opts);
        return Promise.resolve({ status: "simulating" });
      }
      const ws = getWebSocket();
      const currentRaceId = getRaceId();
      if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve({ status: "already_connected", raceId: currentRaceId });

      if (seStart && seStart.isSimStandby()) {
        clearRunStartLookupTimers();
        const simDelayMs = typeof opts.initialDelayMs === "number" ? Math.max(0, opts.initialDelayMs) : 0;
        const launchSim = () => {
          if (!seStart.isSimStandby()) return { status: "cancelled" };
          const cfg = seStart.getPendingSimConfig() || {};
          startSimulation(cfg.splitsList || [], cfg.comparisonTimes || [], cfg.comparisonTimesRT || []);
          return { status: "connected", raceId: getRaceId(), isSimulated: true };
        };
        if (simDelayMs === 0) {
          return Promise.resolve(launchSim());
        }
        return new Promise((resolve) => {
          const tSim = setTimeout(() => {
            resolve(launchSim());
          }, simDelayMs);
          runStartLookupTimers.push(tSim);
        });
      }

      const targetUser = (autoDetectUsername || getHostUsername() || "").trim();
      if (!isValidUsername(targetUser)) {
        return Promise.resolve({ status: "idle" });
      }

      clearRunStartLookupTimers();
      const initialDelayMs = typeof opts.initialDelayMs === "number" ? Math.max(0, opts.initialDelayMs) : 2000;
      const retryDelayMs = typeof opts.retryDelayMs === "number" ? Math.max(0, opts.retryDelayMs) : 3500;

      const executeLookupWithSingleRetry = async () => {
        const seEx = getSimEngine();
        const activeWs = getWebSocket();
        if ((seEx && seEx.isSimulating()) || (activeWs && activeWs.readyState === WebSocket.OPEN)) {
          return { status: "connected", raceId: getRaceId() };
        }
        const firstRes = await pollUserStatus(targetUser, true);
        if (firstRes && firstRes.status === "connected") {
          return firstRes;
        }
        if (retryDelayMs <= 0) {
          return firstRes;
        }
        return new Promise((resolve) => {
          const t2 = setTimeout(async () => {
            const seRetry = getSimEngine();
            const retryWs = getWebSocket();
            if ((seRetry && seRetry.isSimulating()) || (retryWs && retryWs.readyState === WebSocket.OPEN)) {
              resolve({ status: "connected", raceId: getRaceId() });
              return;
            }
            const secondRes = await pollUserStatus(targetUser, true);
            resolve(secondRes);
          }, retryDelayMs);
          runStartLookupTimers.push(t2);
        });
      };

      if (initialDelayMs === 0) {
        return executeLookupWithSingleRetry();
      }

      return new Promise((resolve) => {
        const t1 = setTimeout(async () => {
          const res = await executeLookupWithSingleRetry();
          resolve(res);
        }, initialDelayMs);
        runStartLookupTimers.push(t1);
      });
    }

    return {
      CONNECT_COOLDOWN_MS,
      THERUN_LIVE_API,
      startAutoDetect,
      stopAutoDetect,
      pollUserStatus,
      handleHostRunStarted,
      armSimulationStandby,
      isStandby: () => isStandby,
      setStandby,
      getConnectCooldownRemainingMs,
      recordConnectAttempt,
      resetConnectCooldown,
      clearRunStartLookupTimers,
      getAutoDetectUsername: () => autoDetectUsername,
      setAutoDetectUsername: (u) => { autoDetectUsername = (u || "").trim(); }
    };
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceDiscovery = {
    THERUN_LIVE_API,
    CONNECT_COOLDOWN_MS,
    createRaceDiscovery
  };
})();
