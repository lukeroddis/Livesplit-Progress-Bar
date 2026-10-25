/**
 * src/core/race-ranking.js - Race Standings & Milestone Ranking Engine
 * 
 * Provides pure speedrun standings calculation, checkpoint gap analysis,
 * fastest segment ribbon awards, and split-over-split position deltas:
 * - 4-tier leaderboard sorting:
 *     1. Finished runners ranked first by finalTimeSec ascending (fastest finish wins)
 *     2. Active runners ranked by currentSplitIndex descending (highest milestone reached)
 *     3. Same-split runners ranked strictly by cumulative time at the last common split
 *     4. Deterministic stable fallback to prevent mid-split swapping or jitter
 * - Checkpoint milestone gap calculation (time behind leader and interval to competitor ahead)
 * - Wall-clock dead reckoning progression between incoming WebSocket packets
 * - Statistical predictions integration (therun.gg ML single split predictions, rolling averages, Balanced PB)
 * - Fastest segment ribbon awards (gold, silver, bronze) on leader's previous completed split
 * - Split-over-split position deltas with live overtake awareness
 */

(function () {
  "use strict";

  /**
   * Normalizes split times dictionary/array into a clean numeric array.
   * @param {Array|Object} times - Raw split times
   * @returns {number[]} Array of numeric split times in seconds
   */
  function normalizeSplitTimes(times) {
    if (!times) return [];
    if (Array.isArray(times)) {
      // Index-aligned: a skipped or not-yet-known split stays a hole so later
      // checkpoints keep their position (index k is always split k)
      const arr = [];
      times.forEach((t, i) => {
        const val = typeof t === "number" ? t : parseFloat(t);
        if (typeof val === "number" && !isNaN(val)) {
          arr[i] = val;
        }
      });
      return arr;
    }
    if (typeof times === "object") {
      const keys = Object.keys(times)
        .map(k => Number(k))
        .filter(k => !isNaN(k) && k >= 0)
        .sort((a, b) => a - b);
      if (keys.length === 0) return [];
      const maxIdx = keys[keys.length - 1];
      const arr = [];
      for (let i = 0; i <= maxIdx; i++) {
        const val = times[i];
        if (typeof val === "number" && !isNaN(val)) {
          arr[i] = val;
        } else if (typeof val === "string" && !isNaN(parseFloat(val))) {
          arr[i] = parseFloat(val);
        }
      }
      return arr;
    }
    return [];
  }

  /**
   * Formats a duration in seconds into a human-readable gap string (e.g. "1.2s", "1:23").
   * @param {number} sec - Duration in seconds
   * @returns {string} Formatted string
   */
  function formatGapTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "--";
    const clamped = Math.max(0, sec);
    const totalSec = Math.floor(clamped);
    if (totalSec < 60) {
      const subMin = Math.min(59.9, Math.round(clamped * 10) / 10);
      return `${subMin.toFixed(1)}s`;
    }
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const sPad = s < 10 ? `0${s}` : `${s}`;
    if (h > 0) {
      const mPad = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mPad}:${sPad}`;
    }
    return `${m}:${sPad}`;
  }

  /**
   * Returns estimated course reference time based on runner's score and comparison targets.
   * @param {Object} runner - Runner entrant object
   * @param {number[]} [comparisonTargets=[]] - Course comparison targets
   * @returns {number} Reference time in seconds
   */
  function getCourseRefTime(runner, comparisonTargets = []) {
    if (!runner) return 0;
    if (runner.isFinished && typeof runner.finalTimeSec === "number") {
      return runner.finalTimeSec;
    }
    const score = Math.max(0, runner.score || 0);
    const sIdx = Math.floor(score);
    const sRatio = Math.max(0, Math.min(1.0, score - sIdx));
    const comp = Array.isArray(comparisonTargets) ? comparisonTargets : [];
    const tPrev = sIdx > 0 ? (comp[sIdx - 1] || (sIdx * 30)) : 0;
    const tNext = (sIdx < comp.length) ? (comp[sIdx] || ((sIdx + 1) * 30)) : (tPrev + 30);
    return tPrev + sRatio * (tNext - tPrev);
  }

  /**
   * Returns the number of splits a runner has completed.
   * @param {Object} runner - Runner entrant object
   * @param {Array} [activeSplitsList=[]] - Course splits list
   * @returns {number} Number of completed splits
   */
  function getCompletedSplitCount(runner, activeSplitsList = []) {
    if (!runner) return 0;
    const normSplits = normalizeSplitTimes(runner.splitTimes);
    const sIdx = Math.max(0, runner.currentSplitIndex || 0);
    if (runner.isDNF) {
      return Math.max(normSplits.length, sIdx);
    }
    if (runner.isFinished) {
      if (normSplits.length > 0) return Math.max(normSplits.length, sIdx);
      if (activeSplitsList && activeSplitsList.length > 0) return Math.max(activeSplitsList.length, sIdx);
      return Math.max(1, sIdx);
    }
    return sIdx;
  }

  /**
   * Returns the cumulative split time (in seconds) recorded by a runner at checkpoint index c.
   * @param {Object} runner - Runner entrant object
   * @param {number} c - Checkpoint index
   * @param {Array} [activeSplitsList=[]] - Course splits list
   * @returns {number|null} Cumulative split time in seconds or null
   */
  function getSplitCheckpointTime(runner, c, activeSplitsList = []) {
    if (!runner || c < 0) return null;
    const normSplits = normalizeSplitTimes(runner.splitTimes);
    if (typeof normSplits[c] === "number" && !isNaN(normSplits[c]) && normSplits[c] > 0) {
      return normSplits[c];
    }
    if (Array.isArray(runner.splits) && runner.splits[c] && typeof runner.splits[c].splitTime === "number" && runner.splits[c].splitTime > 0) {
      const st = runner.splits[c].splitTime;
      return st > 500 ? (st / 1000) : st;
    }
    if (runner.isFinished && typeof runner.finalTimeSec === "number" && runner.finalTimeSec > 0) {
      const totalCompleted = getCompletedSplitCount(runner, activeSplitsList);
      if (c === totalCompleted - 1) {
        return runner.finalTimeSec;
      }
    }
    return null;
  }

  /**
   * Calculates the milestone-based gap between two competitors.
   * Evaluated against checkpoint split times rather than interpolated curve approximations.
   * @param {Object} runner - Runner entrant object
   * @param {Object} aheadRunner - Competitor ahead entrant object
   * @param {number[]} [comparisonTargets=[]] - Course comparison targets
   * @returns {number|null} Gap in seconds or null
   */
  function calculateMilestoneGap(runner, aheadRunner, comparisonTargets = []) {
    if (!runner || !aheadRunner) return null;

    // Both runners finished: final delta between their finish times
    if (runner.isFinished && aheadRunner.isFinished) {
      const timeB = typeof runner.finalTimeSec === "number" ? runner.finalTimeSec : (runner.currentTimeSec || 0);
      const timeA = typeof aheadRunner.finalTimeSec === "number" ? aheadRunner.finalTimeSec : (aheadRunner.currentTimeSec || 0);
      return Math.max(0, timeB - timeA);
    }

    const splitsB = normalizeSplitTimes(runner.splitTimes);
    const splitsA = normalizeSplitTimes(aheadRunner.splitTimes);

    const countB = splitsB.length;
    const countA = splitsA.length;
    const curIdxA = Math.max(0, aheadRunner.currentSplitIndex || 0);
    const curIdxB = Math.max(0, runner.currentSplitIndex || 0);

    // 1. If aheadRunner has completed a split that runner has not completed yet
    if (countA > curIdxB && countB <= curIdxB) {
      const timeAAtSplit = splitsA[curIdxB];
      const timeBNow = runner.currentTimeSec || 0;

      if (typeof timeAAtSplit === "number") {
        const prevA = curIdxB > 0 ? splitsA[curIdxB - 1] : 0;
        const prevB = curIdxB > 0 ? (splitsB[curIdxB - 1] || prevA) : 0;
        const prevGap = (typeof prevA === "number" && typeof prevB === "number")
          ? Math.max(0, prevB - prevA)
          : 0;
        if (curIdxB === 0) {
          return Math.max(0, timeBNow - timeAAtSplit);
        } else {
          return prevGap + Math.max(0, timeBNow - timeAAtSplit);
        }
      }
    }

    // 2. Both runners have completed split checkpoints: compare at last common split
    const lastCommonIdx = Math.min(countA, countB) - 1;
    if (lastCommonIdx >= 0) {
      const timeA = splitsA[lastCommonIdx];
      const timeB = splitsB[lastCommonIdx];
      if (typeof timeA === "number" && typeof timeB === "number") {
        const splitDiff = timeB - timeA;
        // If aheadRunner has advanced to a higher split, add the elapsed time aheadRunner has been in the higher split
        if (curIdxA > curIdxB) {
          const timeSinceA = Math.max(0, (aheadRunner.currentTimeSec || 0) - timeA);
          return Math.max(0, splitDiff + timeSinceA);
        }
        return Math.max(0, splitDiff);
      }
    }

    // 3. Fallback: compare LiveSplit PB deltas from therun.gg telemetry if available
    if (typeof runner.deltaSec === "number" && typeof aheadRunner.deltaSec === "number") {
      return Math.max(0, runner.deltaSec - aheadRunner.deltaSec);
    }

    // 4. On first split before anyone splits:
    if (countA === 0 && countB === 0) {
      if (curIdxA === 0 && curIdxB === 0 && !aheadRunner.isFinished && !runner.isFinished) {
        if (typeof runner.deltaSec === "number" && typeof aheadRunner.deltaSec === "number") {
          return Math.max(0, runner.deltaSec - aheadRunner.deltaSec);
        }
        return null;
      }
      return Math.max(0, getCourseRefTime(aheadRunner, comparisonTargets) - getCourseRefTime(runner, comparisonTargets));
    }

    // 5. Fallback: compare current running times if both running
    if (typeof runner.currentTimeSec === "number" && typeof aheadRunner.currentTimeSec === "number" && aheadRunner.currentTimeSec > 0) {
      return Math.max(0, runner.currentTimeSec - aheadRunner.currentTimeSec);
    }

    return null;
  }

  /**
   * Leader gap as shown on the timing tower for an active runner behind the leader:
   * - Same split as the leader: fixed gap at the last checkpoint both completed ("+1:23").
   * - Leader on a later split: a timer counting up from 0 since the leader's most recent
   *   split (restarting every time the leader splits). `isLosing` flags when the time lost
   *   at the split the runner is on already exceeds their gap at the previous checkpoint,
   *   i.e. they are losing time to the leader; it uses the real accumulated loss, so it
   *   stays correct when the runner is two or more splits behind.
   * Returns null when there is not enough checkpoint data (callers fall back to
   * calculateMilestoneGap).
   * @param {Object} runner - Trailing runner
   * @param {Object} leader - Race leader (rank 1)
   * @returns {{mode: string, sec: number, referenceSec: number|null, isLosing: boolean, splitsBehind: number}|null}
   */
  function calculateLeaderGapState(runner, leader) {
    if (!runner || !leader || runner === leader || runner.isFinished || runner.isDNF) return null;

    const splitsR = normalizeSplitTimes(runner.splitTimes);
    const splitsL = normalizeSplitTimes(leader.splitTimes);
    const idxR = Math.max(0, runner.currentSplitIndex || 0);
    const idxL = leader.isFinished
      ? Math.max(splitsL.length, leader.currentSplitIndex || 0)
      : Math.max(0, leader.currentSplitIndex || 0);
    const nowR = runner.currentTimeSec || 0;

    // Gap at the runner's last completed checkpoint (the "time to beat" for this split)
    let referenceSec = null;
    if (idxR > 0) {
      const tR = splitsR[idxR - 1];
      const tL = splitsL[idxR - 1];
      if (typeof tR !== "number" || typeof tL !== "number") return null;
      referenceSec = tR - tL;
    }

    if (!leader.isFinished && idxL <= idxR) {
      if (referenceSec === null) return null;
      return { mode: "checkpoint", sec: Math.max(0, referenceSec), referenceSec, isLosing: false, splitsBehind: 0 };
    }

    const leaderLatest = (leader.isFinished && typeof leader.finalTimeSec === "number")
      ? leader.finalTimeSec
      : splitsL[idxL - 1];
    if (typeof leaderLatest !== "number") return null;

    // Time already lost at the split the runner is on (leader completed it at splitsL[idxR])
    const leaderAtRunnerSplit = typeof splitsL[idxR] === "number"
      ? splitsL[idxR]
      : (idxL - idxR === 1 ? leaderLatest : null);
    const lostAtSplit = leaderAtRunnerSplit !== null ? nowR - leaderAtRunnerSplit : null;
    const isLosing = referenceSec !== null && lostAtSplit !== null && lostAtSplit > referenceSec;

    return {
      mode: "live",
      sec: Math.max(0, nowR - leaderLatest),
      referenceSec,
      isLosing,
      splitsBehind: Math.max(1, idxL - idxR)
    };
  }

  /**
   * Sorts all entrants (host + competitors) into F1 standings order and updates
   * ranks, milestone gaps, segment expectations, ribbons, and position deltas.
   * 
   * @param {Object} options - Configuration and state context
   * @param {Map|Array} options.entrants - Entrants collection
   * @param {Object} [options.hostState] - Host entrant state
   * @param {boolean} [options.isSimulating=false] - Simulation active flag
   * @param {boolean} [options.isLiveRace=false] - Live race active flag
   * @param {string} [options.currentTimingMethod="GameTime"] - "GameTime" | "RealTime"
   * @param {Array} [options.activeSplitsList=[]] - Split names
   * @param {Array} [options.activeComparisonTargets=[]] - Course targets
   * @param {Array} [options.simulationCourseTargets=[]] - Simulation course targets
   * @param {Map} [options.lastKnownRanks] - Rank history Map (userId -> rank)
   * @param {Map} [options.checkpointRankHistory] - Checkpoint history Map (checkpoint -> Map(userId -> rank))
   * @param {number} [options.nowMs] - Current timestamp (defaults to Date.now())
   * @returns {Object[]} Ranked entrants array
   */
  function calculateRankedEntrants(options = {}) {
    const entrantsCollection = options.entrants || [];
    let list = Array.isArray(entrantsCollection)
      ? [...entrantsCollection]
      : Array.from(entrantsCollection.values ? entrantsCollection.values() : []);

    const hostState = options.hostState || null;
    const isSimulating = Boolean(options.isSimulating);
    const isLiveRace = Boolean(options.isLiveRace);
    const currentTimingMethod = options.currentTimingMethod || "GameTime";
    const activeSplitsList = options.activeSplitsList || [];
    const activeComparisonTargets = options.activeComparisonTargets || [];
    const simulationCourseTargets = options.simulationCourseTargets || [];
    const lastKnownRanks = options.lastKnownRanks || new Map();
    const checkpointRankHistory = options.checkpointRankHistory || new Map();
    const nowMs = typeof options.nowMs === "number" ? options.nowMs : Date.now();

    if (isSimulating) {
      // In simulation mode, ensure host runner is present
      if (hostState && !list.some(r => r.userId === hostState.userId)) {
        list.push(hostState);
      }
    } else if (isLiveRace) {
      // In live race: only display actual therun.gg race participants (never the synthetic local_host placeholder)
      if (hostState) {
        list = list.filter(r => r.userId !== hostState.userId);
      }

      // Advance live active runners smoothly with real wall clock time between websocket split packets
      list.forEach((racer) => {
        const isActivelyRacing = !racer.isFinished && !racer.isDNF &&
          (racer.status === "started" || racer.status === "progress" || racer.status === "in_progress" ||
           ((racer.currentTimeSec > 0 || racer.currentSplitIndex > 0) && racer.status !== "ready" && racer.status !== "joined"));
        if (isActivelyRacing) {
          if (racer.splitStartedAt && racer.splitStartedAt > 0) {
            const startMs = racer.splitStartedAt > 1e11 ? racer.splitStartedAt : (racer.splitStartedAt * 1000);
            const inSplitSec = Math.max(0, (nowMs - startMs) / 1000);
            const baseT = (racer.currentSplitIndex > 0 && Array.isArray(racer.splitTimes) && typeof racer.splitTimes[racer.currentSplitIndex - 1] === "number")
              ? racer.splitTimes[racer.currentSplitIndex - 1]
              : (racer.reportedTimeSec || 0);
            racer.currentTimeSec = Math.max(racer.reportedTimeSec || 0, baseT + inSplitSec);
          } else if (racer.lastUpdateTimestamp && racer.lastUpdateTimestamp > 0) {
            const elapsedSec = Math.max(0, (nowMs - racer.lastUpdateTimestamp) / 1000);
            if (elapsedSec > 0 && elapsedSec < 7200) {
              racer.currentTimeSec = (racer.reportedTimeSec || 0) + elapsedSec;
            }
          }
        }
      });
    } else {
      // Idle/preview state: ensure host is in the list
      if (hostState && !list.some(r => r.userId === hostState.userId)) {
        list.push(hostState);
      }
    }

    // Leaderboard sorting rules:
    // 1. Finished runners ranked first by finalTimeSec ascending (fastest finish wins)
    // 2. Active runners ranked by currentSplitIndex descending (highest milestone reached)
    // 3. Active runners on the SAME split checkpoint: leaderboard positioning updates on the
    //    occasion of splitting, NOT based on predicted mid-split interpolation curves.
    //    Ties are broken by comparing cumulative split times at the last completed split checkpoint!
    // 4. Stable rank fallback to prevent mid-split swapping or jitter.
    list.sort((a, b) => {
      if (a.isFinished && b.isFinished) {
        return (a.finalTimeSec || Infinity) - (b.finalTimeSec || Infinity);
      }
      if (a.isFinished && !b.isFinished) return -1;
      if (!a.isFinished && b.isFinished) return 1;

      // DNF runners ranked at the bottom of the standings
      if (a.isDNF && !b.isDNF) return 1;
      if (!a.isDNF && b.isDNF) return -1;
      if (a.isDNF && b.isDNF) {
        const sA = a.currentSplitIndex || 0;
        const sB = b.currentSplitIndex || 0;
        if (sB !== sA) return sB - sA;
        return (b.dnfTimeSec || 0) - (a.dnfTimeSec || 0);
      }

      // Checkpoint rule: in speedrun races, any runner on a higher split checkpoint is physically ahead!
      const splitIdxA = a.currentSplitIndex || 0;
      const splitIdxB = b.currentSplitIndex || 0;
      if (splitIdxB !== splitIdxA) {
        return splitIdxB - splitIdxA;
      }

      // Both runners are on the same split checkpoint.
      // Standings update strictly upon splitting: compare cumulative time at the most recently completed common split.
      const splitsA = normalizeSplitTimes(a.splitTimes);
      const splitsB = normalizeSplitTimes(b.splitTimes);
      const lastCompletedIdx = splitIdxA - 1;

      if (lastCompletedIdx >= 0) {
        for (let k = lastCompletedIdx; k >= 0; k--) {
          const tA = splitsA[k];
          const tB = splitsB[k];
          if (typeof tA === "number" && typeof tB === "number" && !isNaN(tA) && !isNaN(tB)) {
            const diff = tA - tB;
            if (Math.abs(diff) > 0.001) {
              return diff; // lower cumulative split time crossed earlier -> ranked ahead
            }
          }
        }
      }

      // Fallback for Split 0 (before anyone has split) or identical cumulative split times:
      // Preserve stable rank to avoid mid-split swapping or delta glitches
      const rankA = lastKnownRanks.get(a.userId);
      const rankB = lastKnownRanks.get(b.userId);
      if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
        return rankA - rankB;
      }

      // Initial stable order fallback (e.g. before any ranks are recorded):
      // Simulated competitors: paceFactor provides seeded ordering (host = 1.000)
      const paceA = typeof a.paceFactor === "number" ? a.paceFactor : (a.isHost ? 1.000 : 1.0);
      const paceB = typeof b.paceFactor === "number" ? b.paceFactor : (b.isHost ? 1.000 : 1.0);
      if (Math.abs(paceA - paceB) > 0.0001) {
        return paceA - paceB;
      }

      return String(a.userId || "").localeCompare(String(b.userId || ""));
    });

    list.forEach((r, idx) => lastKnownRanks.set(r.userId, idx + 1));

    // Calculate leader gap and interval to competitor ahead based on checkpoint milestones
    const leader = list[0];

    list.forEach((runner, idx) => {
      if (runner.isDNF) {
        runner.rank = "DNF";
        runner.gapToLeaderSec = null;
        runner.intervalSec = null;
        runner.gapDisplay = "DNF";
        runner.intervalDisplay = "--";
        runner.expectedType = "DNF";
        runner.expectedSegmentSec = null;
        runner.expectedSegmentDisplay = "--";
        runner.elapsedSegmentSec = null;
        runner.elapsedSegmentDisplay = "--";
        return;
      }

      runner.rank = idx + 1;

      // Calculate expected segment duration and elapsed segment time for current split
      const sIdx = Math.max(0, runner.currentSplitIndex || 0);
      let elapsedSegSec = 0;
      if (runner.isFinished) {
        runner.expectedType = "FIN";
        const finSec = typeof runner.finalTimeSec === "number" ? runner.finalTimeSec : (runner.currentTimeSec || 0);
        runner.expectedSegmentSec = finSec;
        runner.expectedSegmentDisplay = formatGapTime(finSec).replace(/^\+/, "");
        elapsedSegSec = finSec;
      } else {
        runner.expectedType = "EXP";
        let segSec = 30.0;
        let prevSplitTime = 0;
        const normSplits = normalizeSplitTimes(runner.splitTimes);

        const isRT = (currentTimingMethod === "RealTime");
        const activePb = isRT
          ? (runner.pbCheckpointTimesRT || runner.pbCheckpointTimes)
          : (runner.pbCheckpointTimesGT || runner.pbCheckpointTimes);

        // Check if runner has therun.gg statistical model prediction for this split segment
        const splitObj = (Array.isArray(runner.splits) && runner.splits[sIdx]) ? runner.splits[sIdx] : null;
        let predictedSegSec = (typeof runner.timeToNextSplit === "number" && runner.timeToNextSplit > 0.05) ? runner.timeToNextSplit : null;
        if (splitObj) {
          // Priority 1: therun.gg statistical model / machine learning single split prediction
          if (typeof splitObj.predictedSingleTime === "number" && splitObj.predictedSingleTime > 0) {
            predictedSegSec = splitObj.predictedSingleTime > 500 ? (splitObj.predictedSingleTime / 1000) : splitObj.predictedSingleTime;
          }
          // Priority 2: therun.gg historical rolling window average segment duration
          else if (splitObj.single && splitObj.single.averageTime && parseFloat(splitObj.single.averageTime) > 0) {
            const avgMs = parseFloat(splitObj.single.averageTime);
            predictedSegSec = avgMs > 500 ? (avgMs / 1000) : avgMs;
          }
          // Priority 3: Balanced PB comparison segment difference
          else if (splitObj.comparisons && typeof splitObj.comparisons["Balanced PB"] === "number") {
            const bPb = splitObj.comparisons["Balanced PB"];
            const prevBPb = (sIdx > 0 && runner.splits[sIdx - 1]?.comparisons?.["Balanced PB"]) || 0;
            const diffMs = bPb - prevBPb;
            if (diffMs > 0) {
              predictedSegSec = diffMs > 500 ? (diffMs / 1000) : diffMs;
            }
          }
        }

        if (predictedSegSec !== null && predictedSegSec > 0.05) {
          segSec = predictedSegSec;
          runner.hasStatisticalPrediction = true;
        } else if (activePb && activePb.length > sIdx) {
          const prevPb = sIdx > 0 ? (activePb[sIdx - 1] || 0) : 0;
          segSec = Math.max(0.1, (activePb[sIdx] || 0) - prevPb);
          runner.hasStatisticalPrediction = false;
        } else {
          const comp = activeComparisonTargets;
          const prevT = sIdx > 0 ? (comp[sIdx - 1] || (sIdx * 30)) : 0;
          const nextT = (sIdx < comp.length) ? (comp[sIdx] || ((sIdx + 1) * 30)) : (prevT + 30);
          const pace = typeof runner.paceFactor === "number" ? runner.paceFactor : 1.0;
          segSec = Math.max(0.1, (nextT - prevT) * pace);
          runner.hasStatisticalPrediction = false;
        }

        if (sIdx > 0 && normSplits.length >= sIdx && typeof normSplits[sIdx - 1] === "number") {
          prevSplitTime = normSplits[sIdx - 1];
        } else if (sIdx > 0 && runner.checkpointTimes && typeof runner.checkpointTimes[sIdx - 1] === "number") {
          prevSplitTime = runner.checkpointTimes[sIdx - 1];
        } else if (sIdx > 0 && Array.isArray(runner.splits) && runner.splits[sIdx - 1] && typeof runner.splits[sIdx - 1].splitTime === "number") {
          const st = runner.splits[sIdx - 1].splitTime;
          prevSplitTime = st > 500 ? (st / 1000) : st;
        } else if (sIdx > 0 && simulationCourseTargets && typeof simulationCourseTargets[sIdx - 1] === "number") {
          prevSplitTime = simulationCourseTargets[sIdx - 1];
        }

        elapsedSegSec = Math.max(0, (runner.currentTimeSec || 0) - prevSplitTime);
        runner.expectedSegmentSec = segSec;
        runner.expectedSegmentDisplay = formatGapTime(segSec).replace(/^\+/, "");
      }
      runner.elapsedSegmentSec = elapsedSegSec;
      runner.elapsedSegmentDisplay = formatGapTime(elapsedSegSec).replace(/^\+/, "");

      runner.gapMode = null;
      runner.gapReferenceSec = null;
      runner.isLosingToLeader = false;
      runner.splitsBehindLeader = 0;

      if (idx === 0) {
        runner.gapToLeaderSec = 0;
        runner.intervalSec = 0;
        runner.gapDisplay = "LEADER";
        runner.intervalDisplay = "--";
      } else {
        const aheadRunner = list[idx - 1];
        // gapToLeaderSec stays the total time behind; gapDisplay is the tower's leader gap
        const gap = calculateMilestoneGap(runner, leader, activeComparisonTargets);
        const interval = calculateMilestoneGap(runner, aheadRunner, activeComparisonTargets);
        const gapState = calculateLeaderGapState(runner, leader);

        runner.gapToLeaderSec = gap;
        runner.intervalSec = interval;

        if (gapState) {
          runner.gapMode = gapState.mode;
          runner.gapReferenceSec = gapState.referenceSec;
          runner.isLosingToLeader = gapState.isLosing;
          runner.splitsBehindLeader = gapState.splitsBehind;
          runner.gapDisplay = `+${formatGapTime(gapState.sec)}`;
        } else if (gap !== null) {
          runner.gapDisplay = `+${formatGapTime(gap)}`;
        } else {
          runner.gapDisplay = "--";
        }

        if (interval !== null) {
          runner.intervalDisplay = `+${formatGapTime(interval)}`;
        } else {
          runner.intervalDisplay = "--";
        }
      }
    });

    // -------------------------------------------------------------
    // Fastest Segment Ribbons (Gold / Silver / Bronze on Leader's previous completed split)
    // -------------------------------------------------------------
    const ribbonAwards = new Map(); // userId -> { tier: "gold"|"silver"|"bronze", segDuration }
    let targetSegmentName = "";

    if (leader && !leader.isDNF) {
      const leaderSplitsLen = normalizeSplitTimes(leader.splitTimes).length;
      const totalCourseSplits = activeSplitsList.length > 0 ? activeSplitsList.length : (leaderSplitsLen > 0 ? leaderSplitsLen : 8);
      const leaderSplitIdx = leader.isFinished
        ? (totalCourseSplits - 1)
        : (leader.currentSplitIndex || 0);
      // The split in contention: whichever split the leader is on, it is the previous split
      const targetSplitIdx = leader.isFinished ? leaderSplitIdx : (leaderSplitIdx - 1);

      if (targetSplitIdx >= 0) {
        targetSegmentName = (activeSplitsList && activeSplitsList[targetSplitIdx])
          ? activeSplitsList[targetSplitIdx]
          : `Split ${targetSplitIdx + 1}`;

        const segmentContenders = [];

        list.forEach((racer) => {
          if (racer.isDNF) return;
          const hasCompletedTarget = (racer.isFinished || ((racer.currentSplitIndex || 0) > targetSplitIdx));
          if (!hasCompletedTarget) return;

          const splits = normalizeSplitTimes(racer.splitTimes);
          const tSplit = splits[targetSplitIdx];
          if (typeof tSplit !== "number" || isNaN(tSplit) || tSplit <= 0) return;

          let tPrev = 0;
          if (targetSplitIdx > 0) {
            if (typeof splits[targetSplitIdx - 1] === "number" && splits[targetSplitIdx - 1] > 0) {
              tPrev = splits[targetSplitIdx - 1];
            } else if (racer.checkpointTimes && typeof racer.checkpointTimes[targetSplitIdx - 1] === "number") {
              tPrev = racer.checkpointTimes[targetSplitIdx - 1];
            } else {
              const comp = activeComparisonTargets;
              if (comp && typeof comp[targetSplitIdx - 1] === "number") {
                tPrev = comp[targetSplitIdx - 1];
              }
            }
          }

          const segDuration = tSplit - tPrev;
          if (segDuration > 0) {
            segmentContenders.push({
              userId: racer.userId,
              segDuration,
              rank: typeof racer.rank === "number" ? racer.rank : 9999
            });
          }
        });

        segmentContenders.sort((a, b) => {
          const diff = a.segDuration - b.segDuration;
          if (Math.abs(diff) > 0.001) return diff;
          return a.rank - b.rank;
        });

        const tiers = ["gold", "silver", "bronze"];
        for (let i = 0; i < Math.min(3, segmentContenders.length); i++) {
          ribbonAwards.set(segmentContenders[i].userId, {
            tier: tiers[i],
            segDuration: segmentContenders[i].segDuration
          });
        }
      }
    }

    list.forEach((runner) => {
      const award = ribbonAwards.get(runner.userId) || null;
      runner.segmentRibbon = award ? award.tier : null;
      runner.ribbonSegmentName = award ? targetSegmentName : null;
      runner.ribbonSegmentTime = award ? award.segDuration : null;

      runner.hasCrown = (runner.segmentRibbon === "gold");
      runner.crownSegmentName = runner.hasCrown ? targetSegmentName : null;
      runner.crownSegmentTime = runner.hasCrown ? award.segDuration : null;
    });

    // -------------------------------------------------------------
    // Split-over-Split Position Delta with Live Overtake Awareness
    // -------------------------------------------------------------
    let maxCompletedSplits = 0;
    list.forEach((r) => {
      const count = getCompletedSplitCount(r, activeSplitsList);
      if (count > maxCompletedSplits) {
        maxCompletedSplits = count;
      }
    });

    // Prune stale checkpoint history above maxCompletedSplits
    Array.from(checkpointRankHistory.keys()).forEach((c) => {
      if (c >= maxCompletedSplits) {
        checkpointRankHistory.delete(c);
      }
    });

    for (let c = 0; c < maxCompletedSplits; c++) {
      if (!checkpointRankHistory.has(c)) {
        checkpointRankHistory.set(c, new Map());
      }
      const histMap = checkpointRankHistory.get(c);

      // Remove entrants who have not completed checkpoint c (e.g. after undo split)
      Array.from(histMap.keys()).forEach((uId) => {
        const r = list.find(item => item.userId === uId);
        if (!r || getCompletedSplitCount(r, activeSplitsList) <= c) {
          histMap.delete(uId);
        }
      });

      const completedAtC = list.filter(r => getCompletedSplitCount(r, activeSplitsList) > c);
      completedAtC.sort((a, b) => {
        const tA = getSplitCheckpointTime(a, c, activeSplitsList);
        const tB = getSplitCheckpointTime(b, c, activeSplitsList);
        if (tA !== null && tB !== null) {
          const diff = tA - tB;
          if (Math.abs(diff) > 0.001) return diff;
        }
        const prevOrderA = histMap.get(a.userId);
        const prevOrderB = histMap.get(b.userId);
        if (prevOrderA !== undefined && prevOrderB === undefined) return -1;
        if (prevOrderA === undefined && prevOrderB !== undefined) return 1;
        if (prevOrderA !== undefined && prevOrderB !== undefined && prevOrderA !== prevOrderB) {
          return prevOrderA - prevOrderB;
        }
        const rankA = typeof a.rank === "number" ? a.rank : 9999;
        const rankB = typeof b.rank === "number" ? b.rank : 9999;
        return rankA - rankB;
      });

      completedAtC.forEach((r, idx) => {
        histMap.set(r.userId, idx + 1);
      });
    }

    list.forEach((runner) => {
      if (runner.isDNF || typeof runner.rank !== "number") {
        runner.positionDelta = 0;
        runner.positionDeltaDisplay = "-";
        return;
      }

      const completedCount = getCompletedSplitCount(runner, activeSplitsList);
      let posDelta = 0;

      if (completedCount === 0) {
        // Split 1 in progress: baseline checkpoint not yet established
        posDelta = 0;
      } else if (completedCount === 1) {
        // Completed Split 1 (checkpoint 0), currently running Split 2:
        // Baseline is Split 1 rank; shows 0 unless overtaken mid-Split 2 (or promoted by DNF)
        const rankAt0 = checkpointRankHistory.get(0)?.get(runner.userId) ?? runner.rank;
        if (runner.rank !== rankAt0) {
          posDelta = rankAt0 - runner.rank;
        } else {
          posDelta = 0;
        }
      } else {
        // Completed Split 2+ (completedCount >= 2):
        const prevSplitRank = checkpointRankHistory.get(completedCount - 2)?.get(runner.userId) ?? runner.rank;
        const lastSplitRank = checkpointRankHistory.get(completedCount - 1)?.get(runner.userId) ?? runner.rank;

        if (!runner.isFinished && runner.rank !== lastSplitRank) {
          // Live Overtake Awareness:
          // Another racer has already completed the current split ahead of this runner
          // (or a runner ahead DNF'd), shifting this runner's live leaderboard position!
          posDelta = lastSplitRank - runner.rank;
        } else {
          // Split-over-Split delta comparing the last completed split against the previous split
          posDelta = prevSplitRank - lastSplitRank;
        }
      }

      runner.positionDelta = posDelta;
      if (posDelta > 0) {
        runner.positionDeltaDisplay = `+${posDelta}`;
      } else if (posDelta < 0) {
        runner.positionDeltaDisplay = `${posDelta}`;
      } else {
        runner.positionDeltaDisplay = "-";
      }
    });

    return list;
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceRanking = {
    normalizeSplitTimes,
    formatGapTime,
    getCourseRefTime,
    getCompletedSplitCount,
    getSplitCheckpointTime,
    calculateMilestoneGap,
    calculateLeaderGapState,
    calculateRankedEntrants
  };

})();
