/**
 * tests/unit/core/race-ranking.test.js
 * Unit tests for LiveSplit.RaceRanking standings and milestone ranking engine
 */

(function () {
  "use strict";

  describe("Race Standings & Ranking Engine: LiveSplit.RaceRanking", () => {
    it("exports complete public API on window.LiveSplit.RaceRanking", () => {
      const rr = window.LiveSplit && window.LiveSplit.RaceRanking;
      assert(rr !== undefined && rr !== null, "RaceRanking is exposed on window.LiveSplit");
      assertEqual(typeof rr.normalizeSplitTimes, "function", "normalizeSplitTimes is a function");
      assertEqual(typeof rr.formatGapTime, "function", "formatGapTime is a function");
      assertEqual(typeof rr.getCourseRefTime, "function", "getCourseRefTime is a function");
      assertEqual(typeof rr.getCompletedSplitCount, "function", "getCompletedSplitCount is a function");
      assertEqual(typeof rr.getSplitCheckpointTime, "function", "getSplitCheckpointTime is a function");
      assertEqual(typeof rr.calculateMilestoneGap, "function", "calculateMilestoneGap is a function");
      assertEqual(typeof rr.calculateRankedEntrants, "function", "calculateRankedEntrants is a function");
    });

    it("normalizeSplitTimes standardizes arrays, objects, and strings into clean numeric arrays", () => {
      const rr = window.LiveSplit.RaceRanking;

      // Array input with mixed string and number values
      assertEqual(rr.normalizeSplitTimes([10.5, "20.2", "invalid", null, 30]), [10.5, 20.2, 30]);

      // Object input with numeric string keys
      const objTimes = { 0: 15.2, 1: "30.5", 2: 45.0 };
      assertEqual(rr.normalizeSplitTimes(objTimes), [15.2, 30.5, 45.0]);

      // Falsy inputs
      assertEqual(rr.normalizeSplitTimes(null), []);
      assertEqual(rr.normalizeSplitTimes(undefined), []);
      assertEqual(rr.normalizeSplitTimes(""), []);
    });

    it("formatGapTime formats seconds into speedrun gap displays", () => {
      const rr = window.LiveSplit.RaceRanking;

      assertEqual(rr.formatGapTime(0), "0.0s");
      assertEqual(rr.formatGapTime(4.24), "4.2s");
      assertEqual(rr.formatGapTime(59.9), "59.9s");
      assertEqual(rr.formatGapTime(65), "1:05");
      assertEqual(rr.formatGapTime(125), "2:05");
      assertEqual(rr.formatGapTime(3665), "1:01:05");
      assertEqual(rr.formatGapTime(null), "--");
      assertEqual(rr.formatGapTime(undefined), "--");
    });

    it("calculateMilestoneGap evaluates exact checkpoint delta between runners", () => {
      const rr = window.LiveSplit.RaceRanking;

      // 1. Both finished
      const r1Finished = { isFinished: true, finalTimeSec: 120.5 };
      const r2Finished = { isFinished: true, finalTimeSec: 125.0 };
      assertEqual(rr.calculateMilestoneGap(r2Finished, r1Finished), 4.5);

      // 2. Both completed common split checkpoints: Runner B vs Runner A
      const leader = {
        userId: "leader",
        currentSplitIndex: 1,
        splitTimes: [30.0],
        currentTimeSec: 40.0
      };
      const chaser = {
        userId: "chaser",
        currentSplitIndex: 1,
        splitTimes: [34.5],
        currentTimeSec: 40.0
      };
      assertEqual(rr.calculateMilestoneGap(chaser, leader), 4.5, "Gap is difference at last completed split");

      // 3. Ahead runner has advanced to next split while chaser has not split yet
      const chaserBehind = {
        userId: "chaserBehind",
        currentSplitIndex: 0,
        splitTimes: [],
        currentTimeSec: 32.0
      };
      // Leader split at 30.0s, chaser is currently at 32.0s: gap is 32.0 - 30.0 = 2.0s
      assertEqual(rr.calculateMilestoneGap(chaserBehind, leader), 2.0);
    });

    it("calculateRankedEntrants applies 4-tier leaderboard sorting correctly", () => {
      const rr = window.LiveSplit.RaceRanking;

      const entrants = [
        { userId: "racer_dnf", username: "GaveUp", isDNF: true, dnfTimeSec: 45.0 },
        { userId: "racer_fin2", username: "SecondPlace", isFinished: true, finalTimeSec: 92.0 },
        { userId: "racer_fin1", username: "Winner", isFinished: true, finalTimeSec: 88.0 },
        { userId: "racer_split2", username: "Mile2", currentSplitIndex: 2, splitTimes: [25.0, 50.0] },
        { userId: "racer_split1_fast", username: "Mile1Fast", currentSplitIndex: 1, splitTimes: [24.0] },
        { userId: "racer_split1_slow", username: "Mile1Slow", currentSplitIndex: 1, splitTimes: [26.0] }
      ];

      const ranked = rr.calculateRankedEntrants({
        entrants,
        isSimulating: false,
        isLiveRace: false
      });

      assertEqual(ranked[0].userId, "racer_fin1", "Winner ranks 1st");
      assertEqual(ranked[0].rank, 1);
      assertEqual(ranked[0].gapDisplay, "LEADER");

      assertEqual(ranked[1].userId, "racer_fin2", "Second place finished ranks 2nd");
      assertEqual(ranked[1].rank, 2);

      assertEqual(ranked[2].userId, "racer_split2", "Active runner on split 2 ranks 3rd");
      assertEqual(ranked[2].rank, 3);

      assertEqual(ranked[3].userId, "racer_split1_fast", "Same split runner with faster checkpoint time ranks ahead");
      assertEqual(ranked[3].rank, 4);

      assertEqual(ranked[4].userId, "racer_split1_slow", "Same split runner with slower checkpoint time ranks behind");
      assertEqual(ranked[4].rank, 5);

      assertEqual(ranked[5].userId, "racer_dnf", "DNF runner ranks at the bottom");
      assertEqual(ranked[5].rank, "DNF");
    });

    it("calculateRankedEntrants awards gold, silver, and bronze fastest segment ribbons", () => {
      const rr = window.LiveSplit.RaceRanking;

      const entrants = [
        // Leader finished split 1 (index 0) in 30.0s, split 2 (index 1) in 60.0s (segment = 30.0s)
        { userId: "leader", username: "Leader", currentSplitIndex: 2, splitTimes: [30.0, 60.0] },
        // Chaser 1 split 1 in 32.0s, split 2 in 58.0s (segment = 26.0s -> fastest segment!)
        { userId: "fast_seg", username: "FastSeg", currentSplitIndex: 2, splitTimes: [32.0, 58.0] },
        // Chaser 2 split 1 in 35.0s, split 2 in 63.0s (segment = 28.0s -> 2nd fastest segment)
        { userId: "silver_seg", username: "SilverSeg", currentSplitIndex: 2, splitTimes: [35.0, 63.0] }
      ];

      const ranked = rr.calculateRankedEntrants({
        entrants,
        activeSplitsList: ["Area 1", "Area 2", "Area 3"],
        activeComparisonTargets: [30, 60, 90]
      });

      const fastRunner = ranked.find(r => r.userId === "fast_seg");
      assertEqual(fastRunner.segmentRibbon, "gold", "Fastest segment on completed split earns gold ribbon");
      assertEqual(fastRunner.hasCrown, true, "Gold ribbon recipient hasCrown set to true");
      assertEqual(fastRunner.ribbonSegmentName, "Area 2");

      const silverRunner = ranked.find(r => r.userId === "silver_seg");
      assertEqual(silverRunner.segmentRibbon, "silver", "Second fastest segment earns silver ribbon");
      assertEqual(silverRunner.hasCrown, false);

      const leaderRunner = ranked.find(r => r.userId === "leader");
      assertEqual(leaderRunner.segmentRibbon, "bronze", "Third fastest segment earns bronze ribbon");
    });

    it("calculateRankedEntrants tracks split-over-split position deltas", () => {
      const rr = window.LiveSplit.RaceRanking;
      const history = new Map();
      const lastRanks = new Map();

      // Checkpoint 0 baseline: runner A was 1st, runner B was 2nd
      const step1Entrants = [
        { userId: "A", username: "RunnerA", currentSplitIndex: 1, splitTimes: [25.0] },
        { userId: "B", username: "RunnerB", currentSplitIndex: 1, splitTimes: [27.0] }
      ];

      rr.calculateRankedEntrants({
        entrants: step1Entrants,
        lastKnownRanks: lastRanks,
        checkpointRankHistory: history
      });

      // Now at Checkpoint 1: runner B overtook runner A
      const step2Entrants = [
        { userId: "B", username: "RunnerB", currentSplitIndex: 2, splitTimes: [27.0, 50.0] },
        { userId: "A", username: "RunnerA", currentSplitIndex: 2, splitTimes: [25.0, 52.0] }
      ];

      const step2Ranked = rr.calculateRankedEntrants({
        entrants: step2Entrants,
        lastKnownRanks: lastRanks,
        checkpointRankHistory: history
      });

      const runnerB = step2Ranked.find(r => r.userId === "B");
      assertEqual(runnerB.rank, 1);
      assertEqual(runnerB.positionDelta, 1, "Gained 1 position");
      assertEqual(runnerB.positionDeltaDisplay, "+1");

      const runnerA = step2Ranked.find(r => r.userId === "A");
      assertEqual(runnerA.rank, 2);
      assertEqual(runnerA.positionDelta, -1, "Lost 1 position");
      assertEqual(runnerA.positionDeltaDisplay, "-1");
    });
  });
})();
