/**
 * tests/unit/core/race-sim-roster.test.js
 * Unit tests for race-sim-roster (simulated rival presets and entrant builder)
 */

(function () {
  "use strict";

  describe("Race Sim Roster: simulated rival entrants", () => {
    const { SIMULATED_COMPETITORS, buildCompetitorEntrant } = window.LiveSplit.RaceSimRoster;
    const course = { courseTargets: [30, 60, 90], courseTargetsRT: [40, 80, 120], splitsList: ["A", "B", "C"], isRT: false };

    it("offers nine uniquely identified rivals", () => {
      assertEqual(SIMULATED_COMPETITORS.length, 9);
      assertEqual(new Set(SIMULATED_COMPETITORS.map(c => c.id)).size, 9);
    });

    it("builds rising checkpoint and PB times for both timing methods", () => {
      const e = buildCompetitorEntrant(SIMULATED_COMPETITORS[0], course);
      ["checkpointTimesGT", "checkpointTimesRT", "pbCheckpointTimesGT", "pbCheckpointTimesRT"].forEach((key) => {
        assertEqual(e[key].length, 3, `${key} has one time per split`);
        assert(e[key].every((t, i) => i === 0 || t > e[key][i - 1]), `${key} strictly increases`);
      });
      assertEqual(e.checkpointTimes, e.checkpointTimesGT, "GameTime focus uses GT checkpoints");
      assertEqual([e.currentSplitName, e.status, e.isReady], ["A", "started", true]);
      assert(Math.abs(e.pbSec - 90 * SIMULATED_COMPETITORS[0].paceFactor) < 1e-9, "PB = course x pace factor");
    });

    it("is deterministic and honours lobby / RealTime options", () => {
      const cfg = SIMULATED_COMPETITORS[3];
      assertEqual(buildCompetitorEntrant(cfg, course).checkpointTimesGT, buildCompetitorEntrant(cfg, course).checkpointTimesGT);
      const lobbyRT = buildCompetitorEntrant(cfg, Object.assign({}, course, { isRT: true, withLobby: true }));
      assertEqual(lobbyRT.checkpointTimes, lobbyRT.checkpointTimesRT);
      assertEqual([lobbyRT.status, lobbyRT.isReady], ["joined", false]);
    });
  });
})();
