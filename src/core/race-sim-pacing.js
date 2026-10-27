/**
 * src/core/race-sim-pacing.js - Simulated Competitor Pacing & Virtual Host
 *
 * Advances simulated rivals along their precomputed checkpoint times on the
 * focused timing method: split detection (with gold / green / red split flash
 * from actual vs PB segment), finish handling, and in-segment score. When
 * LiveSplit is not connected, a virtual host runs the course at target pace.
 */

(function () {
  "use strict";

  const FLASH_TOLERANCE_SEC = 0.4;
  const SPLIT_FLASH_MS = 4200;

  /**
   * @param {Object} sim - Simulation context from race-simulation.js: { state, ctx, getStatus, getTimingMethod,
   *   getEntrants, getHostState, getLastHostGameTimeSec, getLastHostRealTimeSec }
   */
  function createSimPacing(sim) {
    const { state } = sim;

    function splitName(idx, fallback) {
      return (state.activeSplitsList && state.activeSplitsList[idx]) ? state.activeSplitsList[idx] : fallback;
    }

    // Rivals run on the focused timer; the other timer mirrors the host's when known
    function syncRacerClock(racer, sec, isRT, lastHostGameTimeSec, lastHostRealTimeSec) {
      racer.currentTimeSec = sec;
      if (isRT) {
        racer.currentTimeSecRT = sec;
        racer.currentTimeSecGT = lastHostGameTimeSec > 0 ? lastHostGameTimeSec : sec;
      } else {
        racer.currentTimeSecGT = sec;
        racer.currentTimeSecRT = lastHostRealTimeSec > 0 ? lastHostRealTimeSec : sec;
      }
    }

    function finishRacer(racer, finalTarget, totalSplits, checkTimes, isRT) {
      racer.isFinished = true;
      racer.finalTimeSec = racer.finalTimeSec || finalTarget;
      racer.currentSplitIndex = totalSplits - 1;
      racer.currentSplitName = splitName(totalSplits - 1, "Finished");
      racer.score = totalSplits;
      if (!Array.isArray(racer.splitTimes)) racer.splitTimes = [];
      for (let k = 0; k < totalSplits; k++) {
        if (!racer.splitTimes[k]) {
          racer.splitTimes[k] = checkTimes[k] || ((k + 1) * 30);
        }
      }
      if (isRT) racer.splitTimesRT = [...racer.splitTimes];
      else racer.splitTimesGT = [...racer.splitTimes];
    }

    // Gold when the rival beat their PB segment by more than 0.4s, red when slower by more, else green
    function splitFlashType(checkTimes, pbTimes, lastK) {
      const actualSeg = (checkTimes[lastK] || ((lastK + 1) * 30)) - (lastK > 0 ? (checkTimes[lastK - 1] || (lastK * 30)) : 0);
      const pbSeg = (pbTimes[lastK] || ((lastK + 1) * 30)) - (lastK > 0 ? (pbTimes[lastK - 1] || (lastK * 30)) : 0);
      if (actualSeg < pbSeg - FLASH_TOLERANCE_SEC) return "gold";
      if (actualSeg > pbSeg + FLASH_TOLERANCE_SEC) return "red";
      return "green";
    }

    function recordCompletedSplits(racer, sIdx, checkTimes, pbTimes, isRT) {
      if (!Array.isArray(racer.splitTimes)) racer.splitTimes = [];
      for (let k = racer.currentSplitIndex; k < sIdx; k++) {
        racer.splitTimes[k] = checkTimes[k] || ((k + 1) * 30);
      }
      if (isRT) racer.splitTimesRT = [...racer.splitTimes];
      else racer.splitTimesGT = [...racer.splitTimes];

      racer.lastSplitEffect = {
        type: splitFlashType(checkTimes, pbTimes, sIdx - 1),
        timestamp: Date.now(),
        completedSplitName: racer.currentSplitName || splitName(racer.currentSplitIndex, `Split ${racer.currentSplitIndex + 1}`),
        newSplitName: splitName(sIdx, `Split ${sIdx + 1}`)
      };
    }

    /**
     * Ticks simulated competitors along the track synchronized to host elapsed seconds
     * (or advances them by dt when no host time is given).
     */
    function tickSimulatedCompetitors(hostSec, dt = 0.05) {
      if (!state.isSimulating) return;
      if (sim.getStatus() !== "in_progress") return;
      const isRT = (sim.getTimingMethod() === "RealTime");
      const activeTargets = isRT
        ? (state.simulationCourseTargetsRT.length > 0 ? state.simulationCourseTargetsRT : state.simulationCourseTargets)
        : state.simulationCourseTargets;
      const totalSplits = activeTargets.length;
      const finalCourseTarget = activeTargets[totalSplits - 1] || (totalSplits * 30);
      const lastHostGameTimeSec = sim.getLastHostGameTimeSec();
      const lastHostRealTimeSec = sim.getLastHostRealTimeSec();

      sim.getEntrants().forEach((racer) => {
        if (racer.isHost) return;

        const sec = (typeof hostSec === "number" && hostSec >= 0)
          ? hostSec
          : Math.max(0, (racer.currentTimeSec || 0) + (dt || 0.05));
        syncRacerClock(racer, sec, isRT, lastHostGameTimeSec, lastHostRealTimeSec);

        const checkTimes = racer.checkpointTimes || (isRT ? racer.checkpointTimesRT : racer.checkpointTimesGT) || activeTargets;
        const pbTimes = racer.pbCheckpointTimes || (isRT ? racer.pbCheckpointTimesRT : racer.pbCheckpointTimesGT) || activeTargets;
        const finalTarget = checkTimes[checkTimes.length - 1] || finalCourseTarget;

        if (racer.currentTimeSec >= finalTarget) {
          if (!racer.isFinished) finishRacer(racer, finalTarget, totalSplits, checkTimes, isRT);
          return;
        }

        // Current split = first checkpoint the racer has not reached yet
        let sIdx = 0;
        for (let i = 0; i < totalSplits; i++) {
          if (racer.currentTimeSec < checkTimes[i]) {
            sIdx = i;
            break;
          }
          sIdx = i + 1;
        }
        sIdx = Math.min(sIdx, totalSplits - 1);

        if (sIdx > racer.currentSplitIndex) {
          recordCompletedSplits(racer, sIdx, checkTimes, pbTimes, isRT);
        } else if (racer.lastSplitEffect && (Date.now() - (racer.lastSplitEffect.timestamp || 0)) > SPLIT_FLASH_MS) {
          racer.lastSplitEffect = null;
        }

        racer.currentSplitIndex = sIdx;
        racer.currentSplitName = splitName(sIdx, `Split ${sIdx + 1}`);

        const actualPrevSplitTime = sIdx > 0 ? (checkTimes[sIdx - 1] || 0) : 0;
        const elapsedInSegment = Math.max(0, racer.currentTimeSec - actualPrevSplitTime);
        const pbPrev = sIdx > 0 ? (pbTimes[sIdx - 1] || 0) : 0;
        const pbNext = pbTimes[sIdx] || ((sIdx + 1) * 30);
        const expectedDuration = Math.max(0.5, pbNext - pbPrev);
        racer.score = sIdx + Math.max(0, Math.min(1.0, elapsedInSegment / expectedDuration));
      });
    }

    /**
     * Without LiveSplit, the host runs the course exactly on target pace (gold flash on every split).
     */
    function advanceVirtualHost(baseSec) {
      if (sim.getStatus() !== "in_progress") return;
      const hostState = sim.getHostState();
      if (hostState.isDNF) return;
      const course = state.simulationCourseTargets;
      state.simVirtualSec = baseSec + 0.05;
      let curIdx = 0;
      for (let i = 0; i < course.length; i++) {
        if (state.simVirtualSec < course[i]) {
          curIdx = i;
          break;
        }
        curIdx = i + 1;
      }
      curIdx = Math.min(curIdx, course.length);
      let hostFlash = null;
      if (curIdx > hostState.currentSplitIndex && hostState.currentSplitIndex >= 0) {
        if (!Array.isArray(hostState.splitTimes)) hostState.splitTimes = [];
        for (let k = hostState.currentSplitIndex; k < curIdx; k++) {
          hostState.splitTimes[k] = course[k] || ((k + 1) * 30);
        }
        hostFlash = {
          type: "gold",
          timestamp: Date.now(),
          completedSplitName: hostState.currentSplitName || splitName(hostState.currentSplitIndex, `Split ${hostState.currentSplitIndex + 1}`),
          newSplitName: splitName(curIdx, curIdx >= course.length ? "Finished" : `Split ${curIdx + 1}`)
        };
      }
      sim.ctx.updateHostProgress(
        state.simVirtualSec,
        curIdx,
        hostState.splitTimes,
        course,
        splitName(curIdx, `Split ${curIdx + 1}`),
        state.activeSplitsList,
        hostFlash,
        false,
        state.simVirtualSec,
        state.activeComparisonTimesRT.length > 0 ? state.activeComparisonTimesRT : course,
        hostState.splitTimes
      );
    }

    return { tickSimulatedCompetitors, advanceVirtualHost };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceSimPacing = {
    createSimPacing
  };
})();
