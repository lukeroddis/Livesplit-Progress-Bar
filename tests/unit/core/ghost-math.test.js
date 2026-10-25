/**
 * tests/unit/core/ghost-math.test.js
 * Unit tests for ghost-math
 */

(function () {
  "use strict";


    describe("Live Ghost Runner Engine", () => {
      it("calculates ghost segment index and ratio across run", () => {
        const times = [60, 120, 180, 240];
        const r0 = window.calculateGhostProgress(0, times);
        assertEqual(r0.segIdx, 0);
        assertEqual(r0.ratio, 0);

        const r30 = window.calculateGhostProgress(30, times);
        assertEqual(r30.segIdx, 0);
        assertEqual(Math.abs(r30.ratio - 0.5) < 0.001, true);

        const r90 = window.calculateGhostProgress(90, times);
        assertEqual(r90.segIdx, 1);
        assertEqual(Math.abs(r90.ratio - 0.5) < 0.001, true);

        const rFin = window.calculateGhostProgress(240, times);
        assertEqual(rFin.segIdx, 3);
        assertEqual(rFin.isFinished, true);

        const rOver = window.calculateGhostProgress(300, times);
        assertEqual(rOver.segIdx, 3);
        assertEqual(rOver.isFinished, true);

        // Sparse array interpolation
        const sparseTimes = [60.0, null, 180.0];
        const rSparse = window.calculateGhostProgress(30, sparseTimes);
        assertEqual(rSparse.segIdx, 0);
        assertEqual(Math.abs(rSparse.ratio - 0.5) < 0.001, true);

        // Empty array safety
        const rEmpty = window.calculateGhostProgress(30, []);
        assertEqual(rEmpty.segIdx, 0);
        assertEqual(rEmpty.ratio, 0);
      });
      it("sanitizes comparison time arrays properly", () => {
        assertEqual(typeof window.sanitizeComparisonTimes, "function");
        const raw = [100.0, null, 300.0];
        const fb = [120.0, 220.0, 320.0];
        const san = window.sanitizeComparisonTimes(raw, fb);
        assertEqual(san, [100.0, 220.0, 300.0]);
      });
      it("handles ghost setting toggles and cycling", () => {
        assertEqual(typeof window.setGhostComparison, "function");
        assertEqual(typeof window.cycleGhostComparison, "function");
        assertEqual(typeof window.toggleGhostComparison, "function");
        assertEqual(typeof window.getActiveGhostComparisons, "function");

        window.setGhostComparison("pb");
        assertEqual(window.getGhostComparison(), "pb");
        assertEqual(window.getActiveGhostComparisons(), ["pb"]);

        // Multi-ghost via array
        window.setGhostComparison(["wr", "pb"]);
        assertEqual(window.getActiveGhostComparisons(), ["wr", "pb"]);
        assertEqual(window.getGhostComparison(), "wr");

        // Multi-ghost via comma-separated string
        window.setGhostComparison("wr,pb");
        assertEqual(window.getActiveGhostComparisons(), ["wr", "pb"]);

        // Toggle on a third ghost
        window.toggleGhostComparison("best");
        assertEqual(window.getActiveGhostComparisons(), ["wr", "pb", "best"]);

        // Toggle off an active ghost
        window.toggleGhostComparison("wr");
        assertEqual(window.getActiveGhostComparisons(), ["pb", "best"]);

        // Toggle off clears all
        window.toggleGhostComparison("off");
        assertEqual(window.getActiveGhostComparisons(), ["off"]);
        assertEqual(window.getGhostComparison(), "off");
      });
      it("resolves multi-ghost comparison info and icons", () => {
        const wrInfo = window.getGhostComparisonInfo("wr");
        assertEqual(typeof wrInfo, "object");
        assertEqual(wrInfo.id, "wr");
        assertEqual(wrInfo.icon, "🏆");

        const pbInfo = window.getGhostComparisonInfo("pb");
        assertEqual(typeof pbInfo, "object");
        assertEqual(pbInfo.id, "pb");
        assertEqual(pbInfo.icon, "🥈");

        const bestInfo = window.getGhostComparisonInfo("best");
        assertEqual(typeof bestInfo, "object");
        assertEqual(bestInfo.id, "best");
        assertEqual(bestInfo.icon, "⭐");
      });
      it("detects timing method from comparison split time", () => {
        assertEqual(typeof window.detectTimingMethodFromComp, "function");
        // Test with mock comparison arrays
        window.comparisonTimesGT = [206.0, 686.0];
        window.comparisonTimesRT = [811.0, 1734.0];
        const resGT = window.detectTimingMethodFromComp(0, 206.0);
        assertEqual(resGT, "GameTime");
        assertEqual(window.getCurrentTimingMethod(), "GameTime");

        const resRT = window.detectTimingMethodFromComp(0, 811.0);
        assertEqual(resRT, "RealTime");
        assertEqual(window.getCurrentTimingMethod(), "RealTime");
      });
      it("dynamically adjusts ghost pin size threshold based on split text", () => {
        assertEqual(typeof window.getNodeTextThreshold, "function");
        // Null node fallback
        assertEqual(window.getNodeTextThreshold(null), 45);

        // Mock node element with split text
        const mockNode = document.createElement("div");
        mockNode.innerHTML = '<div class="split-name">Sinspawn Ammes</div><div class="split-delta"></div>';
        const thresh = window.getNodeTextThreshold(mockNode, false);
        assert(thresh >= 35, "Threshold should be at least 35px");
      });
      it("supports customizable and lowered ghost pin needle length", () => {
        if (window.hudLayout && window.hudLayout.getTrackStyle) {
          const style = window.hudLayout.getTrackStyle();
          assertEqual(typeof style.ghostPinLength, "number");
          assertEqual(style.ghostPinLength, 16);
        }
      });
      it("supports customizable ghost pinhead size in track styles", () => {
        if (window.hudLayout && window.hudLayout.getTrackStyle) {
          const style = window.hudLayout.getTrackStyle();
          assertEqual(typeof style.ghostPinSize, "number");
          assertEqual(style.ghostPinSize, 26);
        }
      });
      it("renders tooltips for timed comparison ghosts", () => {
        const wrInfo = window.getGhostComparisonInfo("wr");
        if (wrInfo && window.getOrCreateGhostMarker) {
          const marker = window.getOrCreateGhostMarker(wrInfo);
          assert(marker !== null, "WR marker created");
          const tag = marker.querySelector(".racer-tag");
          assert(tag !== null, "WR marker contains racer-tag tooltip");
          assert(tag.innerText.length > 0, "racer-tag displays comparison name");
        }
      });
    });


    describe("Ghost Math: LiveSplit.GhostMath Core Methods", () => {
      const gm = window.LiveSplit.GhostMath;

      it("calculateGhostProgress computes split segment index and in-segment progress ratio", () => {
        const times = [30.0, 60.0, 90.0];

        // 1. Ghost at run start
        let p = gm.calculateGhostProgress(0, times);
        assertEqual(p.segIdx, 0);
        assertEqual(p.ratio, 0);
        assertEqual(p.isFinished, false);

        // 2. Ghost midway through Split 1 (15s elapsed out of 30s target)
        p = gm.calculateGhostProgress(15.0, times);
        assertEqual(p.segIdx, 0);
        assert(Math.abs(p.ratio - 0.5) < 0.001, "Ratio is 0.5 at 15s");
        assertEqual(p.isFinished, false);

        // 3. Ghost midway through Split 2 (45s elapsed between 30s and 60s target)
        p = gm.calculateGhostProgress(45.0, times);
        assertEqual(p.segIdx, 1);
        assert(Math.abs(p.ratio - 0.5) < 0.001, "Ratio is 0.5 at 45s");
        assertEqual(p.isFinished, false);

        // 4. Ghost has crossed finish line (100s elapsed with final target at 90s)
        p = gm.calculateGhostProgress(100.0, times);
        assertEqual(p.segIdx, 2);
        assertEqual(p.ratio, 1.0);
        assertEqual(p.isFinished, true);

        // 5. Edge cases: null or empty times array
        p = gm.calculateGhostProgress(10.0, null);
        assertEqual(p.ratio, 0);
        assertEqual(p.isFinished, false);

        p = gm.calculateGhostProgress(10.0, []);
        assertEqual(p.ratio, 0);
        assertEqual(p.isFinished, false);

        p = gm.calculateGhostProgress(10.0, [null, 0, -5]);
        assertEqual(p.ratio, 0);
        assertEqual(p.isFinished, false);
      });

      it("getGhostComparisonInfo handles WR, PB, Best, Average, Worst, and timescale defenses", () => {
        const compDataGT = {
          "Personal Best": [50.0, 100.0],
          "Best Segments": [40.0, 80.0],
          "Average Segments": [55.0, 110.0],
          "Worst Segments": [70.0, 140.0],
          "World Record": [45.0, 90.0]
        };
        const compDataRT = {
          "Personal Best": [70.0, 140.0],
          "Best Segments": [55.0, 110.0],
          "Average Segments": [75.0, 150.0],
          "Worst Segments": [95.0, 190.0],
          "World Record": [60.0, 120.0]
        };
        const compTimesGT = [50.0, 100.0];
        const compTimesRT = [70.0, 140.0];

        // 1. Off returns null
        assertEqual(gm.getGhostComparisonInfo("off"), null);
        assertEqual(gm.getGhostComparisonInfo(null), null);

        // 2. PB returns Personal Best info
        const pbInfo = gm.getGhostComparisonInfo("pb", "GameTime", compDataGT, compDataRT, compTimesGT, compTimesRT);
        assertEqual(pbInfo.id, "pb");
        assertEqual(pbInfo.icon, "🥈");
        assertEqual(pbInfo.times[0], 50.0);

        // 3. Best Segments info
        const bestInfo = gm.getGhostComparisonInfo("best", "GameTime", compDataGT, compDataRT, compTimesGT, compTimesRT);
        assertEqual(bestInfo.id, "best");
        assertEqual(bestInfo.icon, "⭐");
        assertEqual(bestInfo.times[0], 40.0);

        // 4. Average Segments info
        const avgInfo = gm.getGhostComparisonInfo("average", "GameTime", compDataGT, compDataRT, compTimesGT, compTimesRT);
        assertEqual(avgInfo.id, "average");
        assertEqual(avgInfo.icon, "📊");
        assertEqual(avgInfo.times[0], 55.0);

        // 5. Worst Segments info
        const worstInfo = gm.getGhostComparisonInfo("worst", "GameTime", compDataGT, compDataRT, compTimesGT, compTimesRT);
        assertEqual(worstInfo.id, "worst");
        assertEqual(worstInfo.icon, "🐢");
        assertEqual(worstInfo.times[0], 70.0);

        // 6. World Record match
        const wrInfo = gm.getGhostComparisonInfo("wr", "GameTime", compDataGT, compDataRT, compTimesGT, compTimesRT);
        assertEqual(wrInfo.id, "wr");
        assertEqual(wrInfo.icon, "🏆");
        assertEqual(wrInfo.times[0], 45.0);

        // 7. Timescale mismatch defense:
        // Suppose active timing method is RealTime (target ~70s), but WR was only recorded under GameTime (45s).
        // Candidate times are tested against fallbackTimes (70s): ratio difference triggers switch to valid times!
        const mismatchedGT = { "World Record": [200.0, 400.0] }; // Mismatched large numbers
        const matchingRT = { "World Record": [72.0, 144.0] };
        const defended = gm.getGhostComparisonInfo("wr", "RealTime", mismatchedGT, matchingRT, compTimesGT, compTimesRT);
        assertEqual(defended.times[0], 72.0); // Selected matchingRT thanks to timescale defense!
      });
      it("getGhostComparisonInfo handles fallback to Best Segments or PB and custom alt fallback", () => {
        // WR with no WR key: falls back to Best Segments if present
        const noWrCompGT = {
          "Best Segments": [35.0, 70.0],
          "Personal Best": [40.0, 80.0]
        };
        const fbGT = [40.0, 80.0];
        const resBest = gm.getGhostComparisonInfo("wr", "GameTime", noWrCompGT, {}, fbGT, []);
        assertEqual(resBest.id, "wr");
        assertEqual(resBest.name, "Best Segments (WR Fallback)");
        assertEqual(resBest.times[0], 35.0);

        // WR with no WR and no Best Segments: falls back to Personal Best
        const onlyPbGT = {
          "Personal Best": [42.0, 84.0]
        };
        const resPb = gm.getGhostComparisonInfo("wr", "GameTime", onlyPbGT, {}, fbGT, []);
        assertEqual(resPb.id, "wr");
        assertEqual(resPb.name, "Personal Best");
        assertEqual(resPb.times[0], 42.0);

        // Custom comparison present only in altData
        const mainData = {};
        const altData = { "Community Goal": [60.0, 120.0] };
        const resAlt = gm.getGhostComparisonInfo("Community Goal", "GameTime", mainData, altData, fbGT, []);
        assert(resAlt !== null, "Found in altData");
        assertEqual(resAlt.name, "Community Goal");
        assertEqual(resAlt.times[0], 60.0);

        // Custom comparison in mainData with timescale mismatch defense triggering altData
        const customMainBad = { "My Rival": [300.0, 600.0] };
        const customAltGood = { "My Rival": [42.0, 84.0] };
        const resCustomDefense = gm.getGhostComparisonInfo("My Rival", "GameTime", customMainBad, customAltGood, fbGT, []);
        assertEqual(resCustomDefense.name, "My Rival");
        assertEqual(resCustomDefense.times[0], 42.0);

        // Custom comparison in mainData without timescale defense needed
        const customMainGood = { "My Rival": [41.0, 82.0] };
        const resCustomNormal = gm.getGhostComparisonInfo("My Rival", "GameTime", customMainGood, customAltGood, fbGT, []);
        assertEqual(resCustomNormal.times[0], 41.0);

        // Unknown custom comparison not in either dataset
        const resUnknown = gm.getGhostComparisonInfo("NonExistent", "GameTime", mainData, altData, fbGT, []);
        assertEqual(resUnknown, null);
      });
    });
    describe("Ghost Math: progress interpolation and timescale defense cases", () => {
      const gm = window.LiveSplit.GhostMath;
      const near = (a, b) => Math.abs(a - b) < 1e-9;

      it("interpolates ghost progress across segments, boundaries and the finish", () => {
        const times = [60.0, 120.0, 180.0, 240.0];
        let r = gm.calculateGhostProgress(0, times);
        assert(r.segIdx === 0 && r.ratio === 0 && !r.isFinished, "start");
        r = gm.calculateGhostProgress(30, times);
        assert(r.segIdx === 0 && near(r.ratio, 0.5) && !r.isFinished, "mid segment 0");
        r = gm.calculateGhostProgress(60, times);
        assert(r.segIdx === 1 && near(r.ratio, 0) && !r.isFinished, "exactly at split 0 boundary");
        r = gm.calculateGhostProgress(90, times);
        assert(r.segIdx === 1 && near(r.ratio, 0.5), "mid segment 1");
        r = gm.calculateGhostProgress(240, times);
        assert(r.segIdx === 3 && near(r.ratio, 1) && r.isFinished, "at finish");
        r = gm.calculateGhostProgress(300, times);
        assert(r.segIdx === 3 && near(r.ratio, 1) && r.isFinished, "beyond finish");
        r = gm.calculateGhostProgress(30, [60.0, null, 180.0]);
        assert(r.segIdx === 0 && near(r.ratio, 0.5), "sparse array");
      });

      it("prefers the GameTime WR when the RealTime WR is on a different timescale", () => {
        // PB 206.5s; WR GameTime 202s; WR RealTime 811s (includes cutscenes)
        const info = gm.getGhostComparisonInfo(
          "wr", "RealTime",
          { "World Record": [202.0] },
          { "World Record": [811.0] },
          [206.5], [206.5]
        );
        assertEqual(info.id, "wr");
        assertEqual(info.times, [202.0]);
        const r = gm.calculateGhostProgress(214.0, info.times);
        assert(r.segIdx === 0 && near(r.ratio, 1) && r.isFinished, "WR ghost finished by 214s");
      });

      it("parses ghost selections from strings and arrays", () => {
        window.setGhostComparison("wr,pb");
        assertEqual(window.getActiveGhostComparisons(), ["wr", "pb"]);
        window.setGhostComparison(["best", "average"]);
        assertEqual(window.getActiveGhostComparisons(), ["best", "average"]);
        window.setGhostComparison("");
        assertEqual(window.getActiveGhostComparisons(), ["off"]);
        window.setGhostComparison(null);
        assertEqual(window.getActiveGhostComparisons(), ["off"]);
        window.setGhostComparison("off");
        assertEqual(window.getActiveGhostComparisons(), ["off"]);
      });
    });

})();
