/**
 * tests/unit/core/split-engine.test.js
 * Unit tests for split-engine
 */

(function () {
  "use strict";



    describe("Split Engine: LiveSplit.SplitEngine Core Methods", () => {
      const se = window.LiveSplit.SplitEngine;

      it("getShortComparisonName returns compact aliases and truncates long custom names", () => {
        assertEqual(se.getShortComparisonName("Personal Best"), "PB");
        assertEqual(se.getShortComparisonName("Best Segments"), "Best Segs");
        assertEqual(se.getShortComparisonName("Average Segments"), "Average");
        assertEqual(se.getShortComparisonName("Worst Segments"), "Worst");
        assertEqual(se.getShortComparisonName("Short"), "Short");
        assertEqual(se.getShortComparisonName("Very Long Custom Comparison Name"), "Very Long…");
        assertEqual(se.getShortComparisonName(""), "");
        assertEqual(se.getShortComparisonName(null), "");
      });

      it("normalizeComparisonName handles aliases, whitespace, custom known lists, and nulls", () => {
        assertEqual(se.normalizeComparisonName(""), null);
        assertEqual(se.normalizeComparisonName("-"), null);
        assertEqual(se.normalizeComparisonName("  "), null);
        assertEqual(se.normalizeComparisonName(null), null);

        assertEqual(se.normalizeComparisonName("pb"), "Personal Best");
        assertEqual(se.normalizeComparisonName("PB"), "Personal Best");
        assertEqual(se.normalizeComparisonName("best segments"), "Best Segments");
        assertEqual(se.normalizeComparisonName("sum of best"), "Best Segments");
        assertEqual(se.normalizeComparisonName("average"), "Average Segments");
        assertEqual(se.normalizeComparisonName("worst segments"), "Worst Segments");

        // Custom list match
        const customList = ["Community Gold", "Balanced PB"];
        assertEqual(se.normalizeComparisonName("community gold", customList), "Community Gold");
        assertEqual(se.normalizeComparisonName("balanced pb", customList), "Balanced PB");
        assertEqual(se.normalizeComparisonName("Unknown Custom", customList), "Unknown Custom");
      });

      it("sanitizeComparisonTimes bridges holes from fallback and forward-fills gaps", () => {
        // Empty / null inputs
        assertEqual(se.sanitizeComparisonTimes(null), []);
        assertEqual(se.sanitizeComparisonTimes([], [10, 20]), [10, 20]);

        // Gap bridging with fallbackTimes
        const raw = [10.0, null, 35.0, null];
        const fb = [12.0, 22.0, 32.0, 42.0];
        const res = se.sanitizeComparisonTimes(raw, fb);
        assertEqual(res[0], 10.0);
        assertEqual(res[1], 22.0); // Filled from fallback fb[1]
        assertEqual(res[2], 35.0);
        assertEqual(res[3], 42.0); // Filled from fallback fb[3]

        // Shorter comparison is padded to the fallback length
        const padded = se.sanitizeComparisonTimes([10.0], [12.0, 22.0, 32.0]);
        assertEqual(padded, [10.0, 22.0, 32.0]);

        // Forward-fill without fallback
        const noFb = [15.0, null, null];
        const resNoFb = se.sanitizeComparisonTimes(noFb, null, 3);
        assertEqual(resNoFb[0], 15.0);
        assertEqual(resNoFb[1], 15.0);
        assertEqual(resNoFb[2], 15.0);
      });

      it("computeHistoricalCurves maintains monotonic Best <= Average <= Worst ordering", () => {
        const count = 3;
        const bestGT = [10.0, 15.0, 20.0];
        const bestRT = [12.0, 18.0, 25.0];
        const histGT = [[10.0, 12.0], [15.0, 17.0], [20.0, 22.0]];
        const histRT = [[12.0, 14.0], [18.0, 20.0], [25.0, 27.0]];
        const pbGT = [11.0, 27.0, 48.0];
        const pbRT = [13.0, 32.0, 58.0];

        const curves = se.computeHistoricalCurves(count, bestGT, bestRT, histGT, histRT, pbGT, pbRT);
        assertEqual(curves.bestGT.length, 3);
        assertEqual(curves.avgGT.length, 3);
        assertEqual(curves.worstGT.length, 3);

        for (let i = 0; i < count; i++) {
          assert(curves.bestGT[i] <= curves.avgGT[i], `Best GT <= Avg GT at split ${i}`);
          assert(curves.avgGT[i] <= curves.worstGT[i], `Avg GT <= Worst GT at split ${i}`);
          assert(curves.bestRT[i] <= curves.avgRT[i], `Best RT <= Avg RT at split ${i}`);
          assert(curves.avgRT[i] <= curves.worstRT[i], `Avg RT <= Worst RT at split ${i}`);
        }
      });

      it("parseLssXml parses Speedrun XML, segment history, custom comparisons, and curve generation", () => {
        const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<Run version="1.7.0">
  <GameName>Super Mario 64</GameName>
  <CategoryName>16 Star</CategoryName>
  <Comparisons>
    <Comparison>World Record</Comparison>
  </Comparisons>
  <Segments>
    <Segment>
      <Name>Bowser 1</Name>
      <SplitTimes>
        <SplitTime name="Personal Best">
          <RealTime>00:03:15.50</RealTime>
          <GameTime>00:03:10.20</GameTime>
        </SplitTime>
        <SplitTime name="World Record">
          <RealTime>00:03:05.00</RealTime>
          <GameTime>00:03:00.00</GameTime>
        </SplitTime>
      </SplitTimes>
      <BestSegmentTime>
        <RealTime>00:03:12.00</RealTime>
        <GameTime>00:03:08.00</GameTime>
      </BestSegmentTime>
      <SegmentHistory>
        <Time id="1">
          <RealTime>00:03:09.50</RealTime>
          <GameTime>00:03:05.10</GameTime>
        </Time>
      </SegmentHistory>
    </Segment>
    <Segment>
      <Name>Mips</Name>
      <SplitTimes>
        <SplitTime name="Personal Best">
          <RealTime>00:08:30.00</RealTime>
          <GameTime>00:08:15.00</GameTime>
        </SplitTime>
      </SplitTimes>
      <BestSegmentTime>
        <RealTime>00:05:10.00</RealTime>
        <GameTime>00:05:00.00</GameTime>
      </BestSegmentTime>
      <SegmentHistory>
        <Time id="1">
          <RealTime>00:05:08.00</RealTime>
          <GameTime>00:04:58.00</GameTime>
        </Time>
      </SegmentHistory>
    </Segment>
  </Segments>
</Run>`;

        const parsed = se.parseLssXml(sampleXml);
        assert(parsed !== null, "parseLssXml successfully parsed valid XML");
        assertEqual(parsed.game, "Super Mario 64");
        assertEqual(parsed.category, "16 Star");
        assertEqual(parsed.splitsList, ["Bowser 1", "Mips"]);

        // Personal Best times
        assertEqual(parsed.comparisonTimesGT.length, 2);
        assertEqual(parsed.comparisonTimesRT.length, 2);
        assertEqual(parsed.comparisonTimesGT[0], 190.2); // 3m 10.2s = 190.2s
        assertEqual(parsed.comparisonTimesRT[0], 195.5); // 3m 15.5s = 195.5s

        // Segment history gold split override: 3:05.10 (185.1s) is faster than BestSegmentTime 3:08.00 (188.0s)
        assertEqual(parsed.bestSegmentTimesGT[0], 185.1);

        // Custom comparison World Record
        assert(parsed.comparisonsList.includes("World Record"), "World Record registered in comparisonsList");
        assertEqual(parsed.comparisonsDataGT["World Record"][0], 180.0); // 3m 00s = 180s

        // Has game time detection
        assertEqual(parsed.hasAnyGameTime, true);

        // Invalid XML inputs
        assertEqual(se.parseLssXml(""), null);
        assertEqual(se.parseLssXml(null), null);
        assertEqual(se.parseLssXml("<Run><Segments></Segments></Run>"), null);
      });

      it("detectTimingMethodFromComp infers timing method based on split duration match", () => {
        const compGT = [100.0, 200.0];
        const compRT = [140.0, 280.0];

        // compSec matches Game Time
        assertEqual(se.detectTimingMethodFromComp(0, 100.2, compGT, compRT), "GameTime");

        // compSec matches Real Time
        assertEqual(se.detectTimingMethodFromComp(0, 139.8, compGT, compRT), "RealTime");

        // Null / invalid inputs
        assertEqual(se.detectTimingMethodFromComp(-1, 100.0, compGT, compRT), null);
        assertEqual(se.detectTimingMethodFromComp(0, null, compGT, compRT), null);
        assertEqual(se.detectTimingMethodFromComp(0, 0, compGT, compRT), null);
      });
    });
})();
