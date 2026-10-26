/**
 * src/core/race-host.js - Race Host Runner Progress, Undo, DNF & Reset
 *
 * Applies the local runner's LiveSplit telemetry to the race:
 * - updateHostProgress: time, split index, completed splits, split flash, score/finish
 * - Undo split rollback, DNF toggles, host username matching in live rooms
 * - Focused timing method (GameTime / RealTime) and comparison targets
 * - reset(): live rooms restart only the host; simulations reset every racer
 *
 * Installed per race client onto its `ctx` (shared `raceState` plus the client's
 * functions); calls other race-client functions through `ctx.<fn>` at call time.
 */

(function () {
  "use strict";

  const { isValidUsername, loadStoredUsername } = window.LiveSplit.RaceIdentity;
  const { resetRunProgress, resetLeaderboardEffects, isLiveRoom } = window.LiveSplit.RaceState;

  function installRaceHost(ctx) {
    const { raceState } = ctx;

    function setHostDNF(isDnf = true) {
      raceState.hostState.isDNF = !!isDnf;
      if (raceState.hostState.isDNF) {
        raceState.hostState.dnfTimeSec = raceState.hostState.currentTimeSec || 0;
        raceState.hostState.currentSplitName = "DNF";
      } else {
        raceState.hostState.dnfTimeSec = null;
        raceState.hostState.currentSplitName = (raceState.activeSplitsList && raceState.activeSplitsList[raceState.hostState.currentSplitIndex]) || "Start";
      }
      raceState.entrants.set(raceState.hostState.userId, Object.assign({}, raceState.hostState));
      ctx.notifyListeners("entrant_updated", { runnerId: raceState.hostState.userId, isDNF: raceState.hostState.isDNF });
    }

    /**
     * Handles LiveSplit Undo Split: cleanly rolls back host checkpoint,
     * trims split times, and clears completion effects.
     */
    function handleUndoSplit(newIdx, oldIdx) {
      const targetIdx = Math.max(0, typeof newIdx === "number" ? newIdx : 0);
      raceState.hostState.currentSplitIndex = targetIdx;
      raceState.hostState.isFinished = false;
      raceState.hostState.finalTimeSec = null;
      raceState.hostState.lastSplitEffect = null;
      raceState.hostState.isDNF = false;
      raceState.hostState.dnfTimeSec = null;

      if (Array.isArray(raceState.hostState.splitTimes)) {
        raceState.hostState.splitTimes = raceState.hostState.splitTimes.slice(0, targetIdx);
      }
      if (Array.isArray(raceState.lastHostCompletedSplitsGT)) {
        raceState.lastHostCompletedSplitsGT = raceState.lastHostCompletedSplitsGT.slice(0, targetIdx);
      }
      if (Array.isArray(raceState.lastHostCompletedSplitsRT)) {
        raceState.lastHostCompletedSplitsRT = raceState.lastHostCompletedSplitsRT.slice(0, targetIdx);
      }

      const sName = (raceState.activeSplitsList && raceState.activeSplitsList[targetIdx])
        ? raceState.activeSplitsList[targetIdx]
        : (targetIdx >= 0 ? `Split ${targetIdx + 1}` : "Start");
      raceState.hostState.currentSplitName = sName;

      // Rewind virtual host if in simulation
      const seUndo = ctx.getSimEngine();
      if (seUndo && seUndo.isSimulating()) {
        seUndo.handleUndoSplit(targetIdx);
      }

      const hostEntrant = raceState.entrants.get(raceState.hostState.userId);
      if (hostEntrant) {
        Object.assign(hostEntrant, raceState.hostState);
      }
      raceState.entrants.forEach((racer) => {
        if (racer.isHost && racer.userId !== raceState.hostState.userId) {
          racer.currentSplitIndex = raceState.hostState.currentSplitIndex;
          racer.currentSplitName = raceState.hostState.currentSplitName;
          racer.isFinished = false;
          racer.finalTimeSec = null;
          racer.lastSplitEffect = null;
          if (Array.isArray(racer.splitTimes)) {
            racer.splitTimes = racer.splitTimes.slice(0, targetIdx);
          }
        }
      });

      // Roll back checkpoint rank history for undone splits
      raceState.checkpointRankHistory.forEach((histMap, c) => {
        if (c >= targetIdx) {
          histMap.delete(raceState.hostState.userId);
          raceState.entrants.forEach((racer) => {
            if (racer.isHost) {
              histMap.delete(racer.userId);
            }
          });
        }
      });

      ctx.notifyListeners("entrant_updated", { runnerId: raceState.hostState.userId });
    }

    function isHostDNF() {
      return !!raceState.hostState.isDNF;
    }

    function setEntrantDNF(userId, isDnf = true) {
      const e = raceState.entrants.get(userId);
      if (e) {
        e.isDNF = !!isDnf;
        if (e.isDNF) {
          e.dnfTimeSec = e.currentTimeSec || 0;
          e.currentSplitName = "DNF";
        } else {
          e.dnfTimeSec = null;
        }
        ctx.notifyListeners("entrant_updated", { runnerId: userId, isDNF: e.isDNF });
      }
    }

    function setHostUsername(name) {
      const cleaned = (name || "").trim();
      if (cleaned && !isValidUsername(cleaned)) {
        // Reject URLs or invalid characters; preserve existing valid username
        raceState.hostUsername = loadStoredUsername();
      } else {
        raceState.hostUsername = cleaned;
        const d = ctx.getDiscovery();
        if (d) {
          d.setAutoDetectUsername(raceState.hostUsername);
        }
      }
      raceState.hostState.username = raceState.hostUsername || "You";

      const seHost = ctx.getSimEngine();
      if (seHost && seHost.isSimulating()) {
        const hostEntrant = raceState.entrants.get(raceState.hostState.userId);
        if (hostEntrant) {
          hostEntrant.username = raceState.hostState.username;
        }
      } else {
        // In live race, update isHost on entrants matching hostUsername
        raceState.entrants.forEach((entrant) => {
          if (entrant.userId === raceState.hostState.userId) {
            entrant.username = raceState.hostState.username;
            entrant.isHost = true;
            entrant.color = "#38bdf8";
            return;
          }
          const isMatch = !!(raceState.hostUsername && (
            String(entrant.username || "").trim().toLowerCase() === raceState.hostUsername.toLowerCase() ||
            String(entrant.userId || "").trim().toLowerCase() === raceState.hostUsername.toLowerCase()
          ));
          entrant.isHost = isMatch;
          if (isMatch) {
            entrant.color = "#38bdf8";
          }
        });
      }

      ctx.notifyListeners("entrants_update", null);
    }

    function getHostUsername() {
      return raceState.hostUsername;
    }

    function getActiveComparisonTargets() {
      const isRT = (raceState.currentTimingMethod === "RealTime");
      if (isRT) {
        if (raceState.activeComparisonTimesRT && raceState.activeComparisonTimesRT.length > 0) return raceState.activeComparisonTimesRT;
        if (raceState.activeComparisonTimes && raceState.activeComparisonTimes.length > 0) return raceState.activeComparisonTimes;
      } else {
        if (raceState.activeComparisonTimes && raceState.activeComparisonTimes.length > 0) return raceState.activeComparisonTimes;
        if (raceState.activeComparisonTimesRT && raceState.activeComparisonTimesRT.length > 0) return raceState.activeComparisonTimesRT;
      }
      const simCourse = ctx.getSimulationCourseTargets();
      if (simCourse.length > 0) return simCourse;
      return [30, 60, 90, 120, 150, 180, 210, 240];
    }

    function setTimingMethod(method) {
      if (method === "GameTime" || method === "RealTime") {
        raceState.currentTimingMethod = method;
        syncTimingMethod();
        ctx.notifyListeners("timing_method_changed", { timingMethod: raceState.currentTimingMethod });
      }
    }

    function getTimingMethod() {
      return raceState.currentTimingMethod;
    }

    function syncTimingMethod() {
      const isRT = (raceState.currentTimingMethod === "RealTime");
      if (isRT) {
        raceState.hostState.currentTimeSec = raceState.lastHostRealTimeSec > 0 ? raceState.lastHostRealTimeSec : raceState.lastHostGameTimeSec;
        raceState.hostState.splitTimes = raceState.lastHostCompletedSplitsRT.length > 0 ? raceState.lastHostCompletedSplitsRT : raceState.lastHostCompletedSplitsGT;
      } else {
        raceState.hostState.currentTimeSec = raceState.lastHostGameTimeSec > 0 ? raceState.lastHostGameTimeSec : raceState.lastHostRealTimeSec;
        raceState.hostState.splitTimes = raceState.lastHostCompletedSplitsGT.length > 0 ? raceState.lastHostCompletedSplitsGT : raceState.lastHostCompletedSplitsRT;
      }
      const hostEntrant = raceState.entrants.get(raceState.hostState.userId);
      if (hostEntrant) {
        Object.assign(hostEntrant, raceState.hostState);
      }

      const seSync = ctx.getSimEngine();
      if (seSync && seSync.isSimulating()) {
        seSync.onTimingMethodChanged(isRT);
      }
      ctx.notifyListeners("progress_update", { runnerId: raceState.hostState.userId });
    }

    /**
     * Updates the host runner's in-run progress.
     */
    function updateHostProgress(currentSec, currentIndex, completedSplitTimes = [], comparisonTimes = [], currentSplitName = "", splitsList = [], splitFlash = null, isExternal = true, realTimeSec = null, comparisonTimesRT = [], completedSplitTimesRT = [], activeTimingMethod = null) {
      if (activeTimingMethod === "GameTime" || activeTimingMethod === "RealTime") {
        raceState.currentTimingMethod = activeTimingMethod;
      }
      if (isExternal) {
        raceState.lastExternalHostUpdate = Date.now();
      }
      if (Array.isArray(splitsList) && splitsList.length > 0) {
        raceState.activeSplitsList = splitsList;
      }
      if (Array.isArray(comparisonTimes) && comparisonTimes.length > 0) {
        raceState.activeComparisonTimes = comparisonTimes;
      }
      if (Array.isArray(comparisonTimesRT) && comparisonTimesRT.length > 0) {
        raceState.activeComparisonTimesRT = comparisonTimesRT;
      } else if (raceState.activeComparisonTimesRT.length === 0 && raceState.activeComparisonTimes.length > 0) {
        raceState.activeComparisonTimesRT = [...raceState.activeComparisonTimes];
      }

      const raceClockSec = (typeof realTimeSec === "number" && realTimeSec > 0)
        ? realTimeSec
        : Math.max(0, currentSec || 0);
      raceState.lastHostRealTimeSec = raceClockSec;

      if (raceState.currentTimingMethod === "GameTime") {
        raceState.lastHostGameTimeSec = Math.max(0, currentSec || 0);
      } else {
        if (typeof currentSec === "number" && currentSec > 0 && currentSec !== realTimeSec) {
          raceState.lastHostGameTimeSec = currentSec;
        } else if (raceState.lastHostGameTimeSec === 0) {
          raceState.lastHostGameTimeSec = raceState.lastHostRealTimeSec;
        }
      }

      const normCompletedGT = ctx.normalizeSplitTimes(completedSplitTimes);
      const normCompletedRT = ctx.normalizeSplitTimes(completedSplitTimesRT);
      raceState.lastHostCompletedSplitsGT = normCompletedGT;
      raceState.lastHostCompletedSplitsRT = normCompletedRT;

      const isRT = (raceState.currentTimingMethod === "RealTime");
      raceState.hostState.currentTimeSec = isRT ? raceState.lastHostRealTimeSec : raceState.lastHostGameTimeSec;

      if (currentIndex < raceState.hostState.currentSplitIndex) {
        // Rollback / Undo split detected
        raceState.hostState.currentSplitIndex = Math.max(0, currentIndex || 0);
        raceState.hostState.isFinished = false;
        raceState.hostState.finalTimeSec = null;
        raceState.hostState.lastSplitEffect = null;
        if (Array.isArray(raceState.hostState.splitTimes)) {
          raceState.hostState.splitTimes = raceState.hostState.splitTimes.slice(0, raceState.hostState.currentSplitIndex);
        }
        raceState.checkpointRankHistory.forEach((histMap, c) => {
          if (c >= raceState.hostState.currentSplitIndex) {
            histMap.delete(raceState.hostState.userId);
          }
        });
      } else {
        raceState.hostState.currentSplitIndex = Math.max(0, currentIndex || 0);
      }

      if (isRT) {
        raceState.hostState.splitTimes = normCompletedRT.length > 0 ? normCompletedRT : normCompletedGT;
      } else {
        raceState.hostState.splitTimes = normCompletedGT.length > 0 ? normCompletedGT : normCompletedRT;
      }

      let hostSplitName = currentSplitName;
      if (!hostSplitName) {
        if (currentIndex < 0) {
          hostSplitName = "Start";
        } else if (raceState.activeSplitsList && raceState.activeSplitsList[currentIndex]) {
          hostSplitName = raceState.activeSplitsList[currentIndex];
        } else if (comparisonTimes && currentIndex >= comparisonTimes.length) {
          hostSplitName = "Finished";
        } else {
          hostSplitName = `Split ${currentIndex + 1}`;
        }
      }
      raceState.hostState.currentSplitName = hostSplitName;

      if (splitFlash && splitFlash.type) {
        const completedName = splitFlash.completedSplitName
          || raceState.hostState.currentSplitName
          || (raceState.activeSplitsList && raceState.activeSplitsList[Math.max(0, currentIndex - 1)])
          || (currentIndex > 0 ? `Split ${currentIndex}` : "Start");
        const newName = splitFlash.newSplitName || hostSplitName;
        raceState.hostState.lastSplitEffect = {
          type: splitFlash.type,
          timestamp: splitFlash.timestamp || Date.now(),
          completedSplitName: completedName,
          newSplitName: newName
        };
      } else if (raceState.hostState.lastSplitEffect && (Date.now() - (raceState.hostState.lastSplitEffect.timestamp || 0)) > 4200) {
        raceState.hostState.lastSplitEffect = null;
      }

      // Calculate in-segment progress ratio
      let ratio = 0;
      if (currentIndex >= 0 && comparisonTimes && currentIndex < comparisonTimes.length) {
        const curTarget = comparisonTimes[currentIndex];
        const prevTarget = currentIndex > 0 ? (comparisonTimes[currentIndex - 1] || 0) : 0;
        const dur = (curTarget && prevTarget) ? (curTarget - prevTarget) : (curTarget || 30);
        
        let lastSplitSec = 0;
        if (completedSplitTimes && currentIndex > 0) {
          for (let k = currentIndex - 1; k >= 0; k--) {
            if (completedSplitTimes[k] !== undefined && completedSplitTimes[k] !== null && completedSplitTimes[k] > 0) {
              lastSplitSec = completedSplitTimes[k];
              break;
            }
          }
          if (lastSplitSec === 0 && prevTarget > 0) {
            lastSplitSec = prevTarget;
          }
        }
        
        const inSeg = Math.max(0, (currentSec || 0) - lastSplitSec);
        ratio = dur > 0 ? Math.max(0, Math.min(1.0, inSeg / dur)) : 0;
      }

      raceState.hostState.score = raceState.hostState.currentSplitIndex + ratio;

      if (comparisonTimes && currentIndex >= comparisonTimes.length - 1 && ratio >= 1.0) {
        raceState.hostState.isFinished = true;
        raceState.hostState.currentSplitName = "Finished";
        if (!raceState.hostState.finalTimeSec) raceState.hostState.finalTimeSec = currentSec;
      }

      raceState.entrants.set(raceState.hostState.userId, Object.assign({}, raceState.hostState));

      // In simulation mode, update simulated competitors synchronously with the active focused timer
      const seProg = ctx.getSimEngine();
      if (seProg && seProg.isSimulating()) {
        const isRT = (raceState.currentTimingMethod === "RealTime");
        const activeHostSec = isRT ? raceState.lastHostRealTimeSec : (raceState.lastHostGameTimeSec || raceState.hostState.currentTimeSec);
        seProg.tickSimulatedCompetitors(activeHostSec, 0);
      } else if (raceState.hostUsername) {
        raceState.entrants.forEach((racer) => {
          if (racer.isHost && racer.userId !== raceState.hostState.userId) {
            racer.currentTimeSec = raceState.hostState.currentTimeSec;
            racer.currentSplitIndex = raceState.hostState.currentSplitIndex;
            racer.currentSplitName = raceState.hostState.currentSplitName;
            racer.score = raceState.hostState.score;
            if (raceState.hostState.lastSplitEffect) {
              racer.lastSplitEffect = raceState.hostState.lastSplitEffect;
            }
            if (raceState.hostState.isFinished) {
              racer.isFinished = true;
              racer.finalTimeSec = raceState.hostState.finalTimeSec;
            }
          }
        });
      }

      ctx.notifyListeners("progress_update", { runnerId: raceState.hostState.userId });
    }

    function reset() {
      const seReset = ctx.getSimEngine();
      if (!(seReset && seReset.isSimulating()) && isLiveRoom(raceState)) {
        // Live room: only the host's own run restarts; remote runners keep their telemetry
        resetRunProgress(raceState.hostState);
        const hostEntry = raceState.entrants.get(raceState.hostState.userId);
        if (hostEntry) Object.assign(hostEntry, raceState.hostState);
        ctx.notifyListeners("entrant_updated", null);
        return;
      }
      raceState.lastExternalHostUpdate = 0;
      raceState.lastHostGameTimeSec = 0;
      raceState.lastHostRealTimeSec = 0;
      raceState.lastHostCompletedSplitsGT = [];
      raceState.lastHostCompletedSplitsRT = [];
      raceState.activeComparisonTimesRT = [];
      resetRunProgress(raceState.hostState);
      resetLeaderboardEffects(raceState.hostState);

      raceState.entrants.forEach((racer) => {
        if (racer.isHost) {
          Object.assign(racer, raceState.hostState);
        } else {
          resetRunProgress(racer);
          resetLeaderboardEffects(racer);
          racer.currentTimeSecGT = 0;
          racer.currentTimeSecRT = 0;
          racer.currentSplitName = raceState.activeSplitsList[0] || "Split 1";
          racer.splitTimesGT = [];
          racer.splitTimesRT = [];
        }
      });

      raceState.lastKnownRanks.clear();
      raceState.checkpointRankHistory.clear();

      if (seReset && seReset.isSimulating()) {
        seReset.resetSimulation();
      }
      ctx.notifyListeners("race_reset", null);
      if (typeof window.LiveSplit.Leaderboard?.reset === "function") {
        window.LiveSplit.Leaderboard.reset();
      }
    }

    return Object.assign(ctx, {
      setHostDNF,
      handleUndoSplit,
      isHostDNF,
      setEntrantDNF,
      setHostUsername,
      getHostUsername,
      getActiveComparisonTargets,
      setTimingMethod,
      getTimingMethod,
      syncTimingMethod,
      updateHostProgress,
      reset
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceHost = {
    installRaceHost
  };
})();
