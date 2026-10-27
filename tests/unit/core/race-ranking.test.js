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

      // Array input with mixed string and number values: invalid entries stay holes so
      // later checkpoints keep their split index
      const arr = rr.normalizeSplitTimes([10.5, "20.2", "invalid", null, 30]);
      assertEqual(arr.length, 5, "index-aligned length");
      assertEqual(arr[0], 10.5);
      assertEqual(arr[1], 20.2);
      assertEqual(arr[2], undefined, "invalid entry is a hole");
      assertEqual(arr[3], undefined, "null entry is a hole");
      assertEqual(arr[4], 30, "split 5 stays at index 4");

      // A runner first seen mid-race may only know their latest checkpoint
      const sparse = [];
      sparse[20] = 2500.6;
      assertEqual(rr.normalizeSplitTimes(sparse)[20], 2500.6, "sparse checkpoint is not shifted to index 0");

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

    // 16-split course; the 14-split file merges "F" into "G" and "K" into "L"
    const FULL_COURSE = "ABCDEFGHIJKLMNOP".split("");
    const SHORT_COURSE = FULL_COURSE.filter(n => n !== "F" && n !== "K");

    function courseRunner(userId, names, completedNames, timeAt) {
      const splitTimes = completedNames.map(timeAt);
      return {
        userId,
        username: userId,
        totalSplits: names.length,
        splits: names.map(name => ({ name })),
        currentSplitIndex: names.indexOf(completedNames[completedNames.length - 1]) + 1,
        splitTimes,
        currentTimeSec: splitTimes[splitTimes.length - 1] + 5
      };
    }

    it("mapCheckpointsToCourse anchors checkpoints by split name across different split counts", () => {
      const rr = window.LiveSplit.RaceRanking;
      const key = n => n.toLowerCase();
      const { index, exact } = rr.mapCheckpointsToCourse(SHORT_COURSE.map(key), 14, FULL_COURSE.map(key), 16);
      assertEqual(index, [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15], "each split lands on its namesake");
      assert(exact.every(Boolean), "all checkpoints matched by name");

      // No names: only the finish is exact, the rest are spread proportionally and never decrease
      const blind = rr.mapCheckpointsToCourse([], 4, [], 8);
      assertEqual(blind.index[3], 7, "finish maps to finish");
      assertEqual(blind.exact, [false, false, false, true]);
      assert(blind.index.every((v, i) => i === 0 || v >= blind.index[i - 1]), "monotonic");
    });

    it("calculateRankedEntrants ranks runners with fewer splits by where they are in the run", () => {
      const rr = window.LiveSplit.RaceRanking;
      const throughH = FULL_COURSE.slice(0, 8);
      const shortThroughH = SHORT_COURSE.slice(0, 7);

      // Everyone has just passed "H"; the 14-split runners did it fastest
      const entrants = [
        courseRunner("full_1", FULL_COURSE, throughH, (n, i) => 10 * (i + 1)),
        courseRunner("full_2", FULL_COURSE, throughH, (n, i) => 10 * (i + 1) + 2),
        courseRunner("full_3", FULL_COURSE, throughH, (n, i) => 10 * (i + 1) + 4),
        courseRunner("short_1", SHORT_COURSE, shortThroughH, n => 10 * (FULL_COURSE.indexOf(n) + 1) - 3),
        courseRunner("short_2", SHORT_COURSE, shortThroughH, n => 10 * (FULL_COURSE.indexOf(n) + 1) + 3)
      ];
      assertEqual(entrants[3].currentSplitIndex, 7, "short runner's own split index trails the full course");

      const ranked = rr.calculateRankedEntrants({ entrants, lastKnownRanks: new Map(), checkpointRankHistory: new Map() });
      assertEqual(ranked.map(r => r.userId), ["short_1", "full_1", "full_2", "short_2", "full_3"]);
      assertEqual(ranked[1].gapDisplay, "+3.0s", "gap measured at the shared H checkpoint");
      assertEqual(ranked[3].gapDisplay, "+6.0s");
    });

    it("calculateRankedEntrants keeps a full-course runner ahead while the merged split is unfinished", () => {
      const rr = window.LiveSplit.RaceRanking;
      const lead = courseRunner("full", FULL_COURSE, FULL_COURSE.slice(0, 6), (n, i) => 20 * (i + 1));
      const chase = courseRunner("short", SHORT_COURSE, SHORT_COURSE.slice(0, 5), n => 10 * (FULL_COURSE.indexOf(n) + 1));

      const ranked = rr.calculateRankedEntrants({ entrants: [chase, lead], lastKnownRanks: new Map(), checkpointRankHistory: new Map() });
      assertEqual(ranked.map(r => r.userId), ["full", "short"], "passing F is ahead of anyone still before it");
    });

    it("calculateRankedEntrants does not award a ribbon on a segment a runner's splits merge", () => {
      const rr = window.LiveSplit.RaceRanking;
      const throughG = FULL_COURSE.slice(0, 7);
      const ranked = rr.calculateRankedEntrants({
        entrants: [
          courseRunner("full_1", FULL_COURSE, throughG, (n, i) => 10 * (i + 1)),
          courseRunner("full_2", FULL_COURSE, throughG, (n, i) => 10 * (i + 1) + 1),
          courseRunner("short", SHORT_COURSE, SHORT_COURSE.slice(0, 6), n => 10 * (FULL_COURSE.indexOf(n) + 1) + 2)
        ],
        lastKnownRanks: new Map(),
        checkpointRankHistory: new Map()
      });
      const short = ranked.find(r => r.userId === "short");
      assertEqual(short.rank, 3);
      assertEqual(short.segmentRibbon, null, "F+G as one segment is not comparable to G alone");
      assertEqual(ranked.find(r => r.userId === "full_1").ribbonSegmentName, "G", "segment named from the course");
    });
  });
})();
