/**
 * tests/unit/core/split-evaluation.test.js
 * Unit tests for split-evaluation
 */

(function () {
  "use strict";

    describe("Split Evaluation: LiveSplit.SplitEvaluation", () => {
      const ev = window.LiveSplit.SplitEvaluation;
      const fmt = window.LiveSplit.Time.formatDeltaSeconds;
      const base = {
        splitTimeSec: 100,
        prevSplitSec: 70,
        targetSec: 105,
        bestSec: null,
        finalDeltaInfo: null,
        previousDeltaSeconds: 0,
        goldsEnabled: true,
        formatDeltaSeconds: fmt
      };

      it("marks gold only when the segment beats best by more than 50ms", () => {
        const gold = ev.evaluateCompletedSplit({ ...base, bestSec: 30.1 });
        assertEqual(gold.isGold, true);
        assertEqual(gold.stateClass, "gold");
        assertEqual(gold.segmentDurationSec, 30);

        const jitter = ev.evaluateCompletedSplit({ ...base, bestSec: 30.04 });
        assertEqual(jitter.isGold, false, "within 50ms buffer is not gold");

        const disabled = ev.evaluateCompletedSplit({ ...base, bestSec: 31, goldsEnabled: false });
        assertEqual(disabled.isGold, false, "golds disabled");
      });

      it("prefers LiveSplit's delta and classifies gaining/losing against the previous delta", () => {
        const lsDelta = { text: "-2.0", isAhead: true, signedSeconds: -2 };
        const gaining = ev.evaluateCompletedSplit({ ...base, finalDeltaInfo: lsDelta, previousDeltaSeconds: -1 });
        assertEqual(gaining.stateClass, "ahead-gaining");
        assertEqual(gaining.displayDelta, lsDelta);
        assertEqual(gaining.previousDeltaSeconds, -2);

        const losing = ev.evaluateCompletedSplit({ ...base, finalDeltaInfo: lsDelta, previousDeltaSeconds: -3 });
        assertEqual(losing.stateClass, "ahead-losing");
      });

      it("falls back to split minus target when LiveSplit has no delta", () => {
        const res = ev.evaluateCompletedSplit({ ...base, splitTimeSec: 108, previousDeltaSeconds: 1 });
        assertEqual(res.stateClass, "behind-losing");
        assertEqual(res.displayDelta.signedSeconds, 3);
        assertEqual(res.displayDelta.isAhead, false);
        assertEqual(res.previousDeltaSeconds, 3);
      });

      it("stays uncoloured with a dash and keeps the previous delta when nothing to compare", () => {
        const res = ev.evaluateCompletedSplit({ ...base, targetSec: null, previousDeltaSeconds: 4 });
        assertEqual(res.stateClass, "uncoloured");
        assertEqual(res.displayDelta.text, "-");
        assertEqual(res.previousDeltaSeconds, 4);
      });

      it("gold without delta or target keeps a dash but still reports gold", () => {
        const res = ev.evaluateCompletedSplit({ ...base, targetSec: null, bestSec: 40, previousDeltaSeconds: 2 });
        assertEqual(res.stateClass, "gold");
        assertEqual(res.displayDelta.text, "-");
        assertEqual(res.previousDeltaSeconds, 2);
      });

      it("maps state classes to leaderboard flash colours", () => {
        assertEqual(ev.getSplitFlashType("gold"), "gold");
        assertEqual(ev.getSplitFlashType("behind-losing"), "red");
        assertEqual(ev.getSplitFlashType("ahead-gaining"), "green");
        assertEqual(ev.getSplitFlashType("uncoloured"), "green");
      });
    });
})();
