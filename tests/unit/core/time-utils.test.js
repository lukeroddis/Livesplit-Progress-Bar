/**
 * tests/unit/core/time-utils.test.js
 * Unit tests for time-utils
 */

(function () {
  "use strict";


    describe("Time Conversion: timeStringToSeconds", () => {
      it("parses seconds only correctly", () => {
        assertEqual(window.timeStringToSeconds("45.2"), 45.2);
      });
      it("parses MM:SS correctly", () => {
        assertEqual(window.timeStringToSeconds("01:23.45"), 83.45);
      });
      it("parses HH:MM:SS correctly", () => {
        assertEqual(window.timeStringToSeconds("01:02:03"), 3723);
      });
      it("parses days format DD.HH:MM:SS correctly", () => {
        assertEqual(window.timeStringToSeconds("1.00:00:00"), 86400);
      });
      it("returns null on empty, hyphen, or invalid input", () => {
        assertEqual(window.timeStringToSeconds("-"), null);
        assertEqual(window.timeStringToSeconds(""), null);
        assertEqual(window.timeStringToSeconds(null), null);
      });
    });


    describe("Time Formatting: formatTargetTime", () => {
      it("formats zero seconds as 0:00", () => {
        assertEqual(window.formatTargetTime(0), "0:00");
      });
      it("formats under 1 hour as MM:SS", () => {
        assertEqual(window.formatTargetTime(125), "2:05");
      });
      it("formats over 1 hour as H:MM:SS", () => {
        assertEqual(window.formatTargetTime(3665), "1:01:05");
      });
      it("returns empty string on null or NaN", () => {
        assertEqual(window.formatTargetTime(null), "");
        assertEqual(window.formatTargetTime(NaN), "");
      });
    });


    describe("Delta Formatting: formatDeltaSeconds", () => {
      it("formats neutral delta under 0.05s as ±0.0", () => {
        assertEqual(window.formatDeltaSeconds(0.0), "±0.0");
        assertEqual(window.formatDeltaSeconds(0.04), "±0.0");
        assertEqual(window.formatDeltaSeconds(-0.04), "±0.0");
      });
      it("formats ahead deltas with minus sign", () => {
        assertEqual(window.formatDeltaSeconds(-1.5), "-1.5");
        assertEqual(window.formatDeltaSeconds(-65.2), "-1:05");
        assertEqual(window.formatDeltaSeconds(-3665.2), "-1:01:05");
      });
      it("formats behind deltas with plus sign", () => {
        assertEqual(window.formatDeltaSeconds(12.3), "+12.3");
        assertEqual(window.formatDeltaSeconds(125.0), "+2:05");
        assertEqual(window.formatDeltaSeconds(4200.0), "+1:10:00");
      });
    });


    describe("Comparison Normalization", () => {
      it("normalizes Personal Best aliases", () => {
        assertEqual(window.normalizeComparisonName("pb"), "Personal Best");
        assertEqual(window.normalizeComparisonName("Personal Best"), "Personal Best");
      });
      it("normalizes Best Segments aliases", () => {
        assertEqual(window.normalizeComparisonName("sum of best"), "Best Segments");
        assertEqual(window.normalizeComparisonName("best splits"), "Best Segments");
      });
      it("normalizes Average Segments aliases", () => {
        assertEqual(window.normalizeComparisonName("average"), "Average Segments");
      });
      it("normalizes Worst Segments aliases", () => {
        assertEqual(window.normalizeComparisonName("worst"), "Worst Segments");
      });
      it("returns null for empty or hyphen string", () => {
        assertEqual(window.normalizeComparisonName("-"), null);
      });
      it("generates correct short badge strings", () => {
        assertEqual(window.getShortComparisonName("Personal Best"), "PB");
        assertEqual(window.getShortComparisonName("Best Segments"), "Best Segs");
        assertEqual(window.getShortComparisonName("Average Segments"), "Average");
        assertEqual(window.getShortComparisonName("Worst Segments"), "Worst");
      });
    });


    describe("Live Delta String Parsing: formatDeltaLive", () => {
      it("parses unicode minus and fractions", () => {
        const res = window.formatDeltaLive("−5.2");
        assertEqual(res.isAhead, true);
        assertEqual(res.signedSeconds, -5.2);
      });
      it("parses positive minutes and seconds", () => {
        const res = window.formatDeltaLive("+1:20.5");
        assertEqual(res.isAhead, false);
        assertEqual(res.text, "+1:20");
      });
      it("formats live deltas past one hour as H:MM:SS", () => {
        const res = window.formatDeltaLive("+1:10:00.5");
        assertEqual(res.isAhead, false);
        assertEqual(res.text, "+1:10:00");
        const aheadRes = window.formatDeltaLive("-2:05:09.0");
        assertEqual(aheadRes.isAhead, true);
        assertEqual(aheadRes.text, "-2:05:09");
      });
    });


    describe("Timer Milestone Formatting: formatTimerDisplay", () => {
      it("formats zero seconds as 0.00", () => {
        assert(window.formatTimerDisplay(0) === "0.00", "0 must format as 0.00");
        assert(window.formatTimerDisplay("0") === "0.00", "'0' must format as 0.00");
      });

      it("formats sub-minute times as S.hh without leading zero", () => {
        assert(window.formatTimerDisplay(5.2) === "5.20", "5.2 must format as 5.20");
        assert(window.formatTimerDisplay(42.85) === "42.85", "42.85 must format as 42.85");
      });

      it("formats times under 1 hour as M:SS.hh without leading zero on minutes", () => {
        assert(window.formatTimerDisplay(75.5) === "1:15.50", "75.5 must format as 1:15.50");
        assert(window.formatTimerDisplay(599.99) === "9:59.99", "599.99 must format as 9:59.99");
      });

      it("formats times over 1 hour as H:MM:SS.hh without leading zero on hours", () => {
        assert(window.formatTimerDisplay(3665.12) === "1:01:05.12", "3665.12 must format as 1:01:05.12");
      });

      it("handles negative times and avoids -0.00", () => {
        assert(window.formatTimerDisplay(-0.001) === "0.00", "Near zero negative must avoid -0.00");
        assert(window.formatTimerDisplay(-15.4) === "-15.40", "-15.4 must format as -15.40");
      });
    });


    describe("Time Utils: LiveSplit.Time Core Methods", () => {
      const tu = window.LiveSplit.Time;

      it("timeStringToSeconds parses days, hours, minutes, seconds, milliseconds, and edge cases", () => {
        assertEqual(tu.timeStringToSeconds("45.2"), 45.2);
        assertEqual(tu.timeStringToSeconds("01:23.45"), 83.45);
        assertEqual(tu.timeStringToSeconds("1:02:03.5"), 3723.5);
        // Days format: 1.02:03:04 (1 day + 2h 3m 4s = 86400 + 7200 + 180 + 4 = 93784s)
        assertEqual(tu.timeStringToSeconds("1.02:03:04"), 93784.0);

        // Null / empty / dash
        assertEqual(tu.timeStringToSeconds(""), null);
        assertEqual(tu.timeStringToSeconds("-"), null);
        assertEqual(tu.timeStringToSeconds(null), null);
        assertEqual(tu.timeStringToSeconds("invalid:time:format:extra"), null);
      });

      it("formatTimerDisplay formats numbers, negative times, days, and unicode minus", () => {
        assertEqual(tu.formatTimerDisplay(0), "0.00");
        assertEqual(tu.formatTimerDisplay(12.34), "12.34");
        assertEqual(tu.formatTimerDisplay(65.5), "1:05.50");
        assertEqual(tu.formatTimerDisplay(3665.12), "1:01:05.12");
        assertEqual(tu.formatTimerDisplay(-12.34), "-12.34");
        assertEqual(tu.formatTimerDisplay(-0.001), "0.00"); // Avoid -0.00

        // String inputs
        assertEqual(tu.formatTimerDisplay("12.34"), "12.34");
        assertEqual(tu.formatTimerDisplay("−15.20"), "-15.20"); // Unicode minus
        assertEqual(tu.formatTimerDisplay("1.02:03:04.56"), "26:03:04.56"); // Days converted to hours
        assertEqual(tu.formatTimerDisplay("-"), "-");
        assertEqual(tu.formatTimerDisplay(null), "0.00");
      });

      it("formatTargetTime and formatDeltaSeconds handle milestones, boundaries, and neutrality", () => {
        assertEqual(tu.formatTargetTime(45), "0:45");
        assertEqual(tu.formatTargetTime(75), "1:15");
        assertEqual(tu.formatTargetTime(3665), "1:01:05");
        assertEqual(tu.formatTargetTime(null), "");

        assertEqual(tu.formatDeltaSeconds(0.0), "±0.0");
        assertEqual(tu.formatDeltaSeconds(0.04), "±0.0");
        assertEqual(tu.formatDeltaSeconds(-0.04), "±0.0");
        assertEqual(tu.formatDeltaSeconds(-1.5), "-1.5");
        assertEqual(tu.formatDeltaSeconds(-65.2), "-1:05");
        assertEqual(tu.formatDeltaSeconds(12.3), "+12.3");
        assertEqual(tu.formatDeltaSeconds(125.0), "+2:05");
        assertEqual(tu.formatDeltaSeconds(4200.0), "+1:10:00");
        assertEqual(tu.formatDeltaSeconds(-3665.0), "-1:01:05");
      });
    });
})();
