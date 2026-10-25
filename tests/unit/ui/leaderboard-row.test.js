/**
 * tests/unit/ui/leaderboard-row.test.js
 * Unit tests for leaderboard-row (pure row description rules)
 */

(function () {
  "use strict";

  describe("Leaderboard Row: describeRow display rules", () => {
    const Row = window.LiveSplit.LeaderboardRow;
    const now = 1000000;
    const describe = (racer, ctx = {}) => Row.describeRow(racer, Object.assign({ isPreRace: false, now }, ctx));

    it("labels the leader, position changes and podium classes", () => {
      const leader = describe({ userId: "a", username: "Ace", rank: 1, positionDelta: 2 });
      assertEqual([leader.gapVal, leader.posClass, leader.deltaText, leader.deltaClass], ["LEADER", "pos-1", "▲+2", "pos-delta delta-up"]);
      const fourth = describe({ userId: "b", rank: 4, positionDelta: -1, gapDisplay: "+3.2s" });
      assertEqual([fourth.gapVal, fourth.posClass, fourth.deltaText, fourth.deltaTooltip], ["+3.2s", "pos-other", "▼-1", "Dropped 1 place"]);
      assertEqual(fourth.displayName, "Runner", "rivals without a name fall back to Runner");
    });

    it("shows DNF runners with a DNF badge, gap and no ribbon", () => {
      const d = describe({ userId: "c", username: "Crash", isDNF: true, rank: 2, segmentRibbon: "gold" });
      assertEqual([d.rank, d.posClass, d.gapVal, d.splitText, d.ribbonClass], ["DNF", "pos-dnf", "DNF", "DNF", "racer-ribbon"]);
      assertEqual(d.rowTitle, "Crash did not finish (DNF)");
    });

    it("shows READY / JOINED and the PB target before the race starts", () => {
      const ready = describe({ userId: "r", username: "Rdy", isReady: true, pbSec: 125, currentSplitName: "Ready" }, { isPreRace: true });
      assertEqual([ready.gapVal, ready.deltaText, ready.splitText], ["READY", "✓", "Split 1"]);
      assert(ready.expMarkup.includes("PB") && ready.expMarkup.includes("2:05"), "PB target shown");
      const joined = describe({ userId: "j", status: "joined" }, { isPreRace: true });
      assertEqual([joined.gapVal, joined.deltaText], ["JOINED", "⏳"]);
    });

    it("walks the split name through completed, fade-out and swipe-in phases", () => {
      const fx = (age) => describe({ userId: "s", rank: 2, currentSplitName: "B", lastSplitEffect: { type: "gold", timestamp: now - age, completedSplitName: "A", newSplitName: "B" } });
      assertEqual([fx(100).splitText, fx(100).splitClass], ["A", "racer-split is-completed-gold"]);
      assertEqual([fx(1000).splitText, fx(1000).splitClass], ["A", "racer-split is-completed-gold split-fade-out"]);
      assertEqual([fx(2000).splitText, fx(2000).splitClass], ["B", "racer-split split-swipe-in"]);
      assertEqual(fx(2000).flashClass, "split-flash-gold");
      const expired = fx(4500);
      assertEqual([expired.isEffectActive, expired.splitText, expired.flashClass], [false, "B", null]);
    });

    it("explains live gaps, losing time and fastest-segment ribbons in tooltips", () => {
      const d = describe({
        userId: "g", username: "Gap", rank: 3, gapDisplay: "+12.0s", gapMode: "live", splitsBehindLeader: 2,
        gapReferenceSec: 9.5, isLosingToLeader: true, segmentRibbon: "silver", ribbonSegmentName: "Split 2", ribbonSegmentTime: 28.14
      });
      assert(d.isLosing, "losing time to leader");
      assert(d.gapTooltip.startsWith("Since leader's last split: +12.0s (2 splits behind) | Gap at last split: +9.5s (losing time)"), d.gapTooltip);
      assertEqual(d.ribbonClass, "racer-ribbon is-active ribbon-silver");
      assertEqual(d.ribbonTooltip, "🥈 2nd Fastest Segment on Split 2: 28.1s (Gap)");
    });

    it("formats segment durations and passes preformatted strings through", () => {
      assertEqual(Row.formatSegmentDuration(27.44), "27.4s");
      assertEqual(Row.formatSegmentDuration(3725), "1:02:05");
      assertEqual(Row.formatSegmentDuration("28.5s"), "28.5s");
      assertEqual(Row.formatSegmentDuration(undefined), "--");
    });
  });
})();
