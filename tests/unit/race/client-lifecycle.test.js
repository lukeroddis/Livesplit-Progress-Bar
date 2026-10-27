/**
 * tests/unit/race/client-lifecycle.test.js
 * RaceClient API surface, host undo/DNF, mutes, race pins and lifecycle transitions.
 * (Split from the former tests/unit/core/race-client.test.js.)
 */

(function () {
  "use strict";

    describe("Race: Client API & lifecycle", () => {
      it("LiveSplit.RaceClient is direct instance with getRankedEntrants and simulation controls", () => {
        const rc = window.LiveSplit.RaceClient;
        assert(rc, "RaceClient exists");
        assertEqual(typeof rc.getRankedEntrants, "function");
        assertEqual(typeof rc.startSimulation, "function");
        assertEqual(typeof rc.stopSimulation, "function");
        assertEqual(typeof rc.isSimulating, "function");
        assertEqual(rc.isSimulating(), false);

        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);
        assertEqual(rc.isSimulating(), true);
        const entrants = rc.getRankedEntrants();
        assert(entrants.length >= 4, "Simulation provides host + 3 virtual competitors");

        rc.stopSimulation();
        assertEqual(rc.isSimulating(), false);
      });

      it("updateGhostRunner executes cleanly during race simulation", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);
        let threw = false;
        try {
          window.updateGhostRunner(10);
        } catch (e) {
          threw = true;
        }
        rc.stopSimulation();
        assert(!threw, "updateGhostRunner does not throw error during simulation");
      });

      it("RaceClient handleUndoSplit rewinds checkpoints, trims splitTimes, and resets finished state", () => {
        const rc = window.LiveSplit.RaceClient;
        assert(typeof rc.handleUndoSplit === "function", "RaceClient exports handleUndoSplit");
        rc.startSimulation(["Split 1", "Split 2", "Split 3", "Finished"], [30, 60, 90, 120]);

        // Complete 2 splits
        rc.updateHostProgress(65, 2, [28.0, 58.0], [30, 60, 90, 120], "Split 3");
        let entrants = rc.getRankedEntrants();
        let host = entrants.find(e => e.isHost);
        assertEqual(host.currentSplitIndex, 2, "Host at split index 2");
        assertEqual(host.splitTimes.length, 2, "Host has 2 split times");

        // Undo split back to split index 1
        rc.handleUndoSplit(1, 2);
        entrants = rc.getRankedEntrants();
        host = entrants.find(e => e.isHost);
        assertEqual(host.currentSplitIndex, 1, "Host rolled back to split index 1");
        assertEqual(host.splitTimes.length, 1, "Split times trimmed to 1");
        assertEqual(host.isFinished, false, "Host isFinished is false");
        assertEqual(host.lastSplitEffect, null, "Host lastSplitEffect cleared");

        rc.stopSimulation();
      });

      it("updateHostProgress gracefully handles splitFlash without newSplitName without throwing TDZ ReferenceError", () => {
        const rc = window.LiveSplit.RaceClient;
        let threwError = false;
        try {
          rc.updateHostProgress(
            45.0, 1, [45.0], [50.0, 100.0], "Stage 2",
            ["Stage 1", "Stage 2"],
            { type: "gold", completedSplitName: "Stage 1" },
            true, 45.0, [50.0, 100.0], [45.0], "RealTime"
          );
        } catch (e) {
          threwError = true;
        }
        assertEqual(threwError, false, "updateHostProgress does not throw TDZ ReferenceError on splitFlash with omitted newSplitName");
        const hostState = rc.getHostState();
        assert(hostState.lastSplitEffect !== null, "Split effect is recorded");
        assertEqual(hostState.lastSplitEffect.newSplitName, "Stage 2", "newSplitName correctly defaulted to hostSplitName");
      });

      it("Global Race Pins toggle (Pins: ON / OFF) overrides track pin visibility while preserving individual entrant mutes", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.areRacePinsVisible, "function", "RaceClient exports areRacePinsVisible");
        assertEqual(typeof rc.setRacePinsVisible, "function", "RaceClient exports setRacePinsVisible");
        assertEqual(typeof rc.toggleRacePinsVisible, "function", "RaceClient exports toggleRacePinsVisible");

        rc.setRacePinsVisible(true);
        assertEqual(rc.areRacePinsVisible(), true, "Race pins default to visible");

        rc.handleRaceMessage([
          { userId: "r_pin_1", username: "RacerOne", currentSplitIndex: 1, currentTime: 25000, splitTimes: [25.0] },
          { userId: "r_pin_2", username: "RacerTwo", currentSplitIndex: 1, currentTime: 27000, splitTimes: [27.0] },
          { userId: "r_pin_3", username: "RacerThree", currentSplitIndex: 1, currentTime: 29000, splitTimes: [29.0] }
        ]);

        // Individually mute RacerTwo on the leaderboard
        rc.setEntrantMuted("r_pin_2", true);
        let list = rc.getRankedEntrants();
        assertEqual(list.find(r => r.userId === "r_pin_1").isMuted, false);
        assertEqual(list.find(r => r.userId === "r_pin_2").isMuted, true, "RacerTwo is individually muted");
        assertEqual(list.find(r => r.userId === "r_pin_3").isMuted, false);

        // Sweep toggle ALL race pins OFF globally
        const afterOff = rc.toggleRacePinsVisible();
        assertEqual(afterOff, false, "toggleRacePinsVisible turns global pins OFF");
        assertEqual(rc.areRacePinsVisible(), false);

        // Verify individual mute state on RacerTwo is still preserved while global pins are OFF
        list = rc.getRankedEntrants();
        assertEqual(list.find(r => r.userId === "r_pin_1").isMuted, false, "RacerOne remains individually unmuted");
        assertEqual(list.find(r => r.userId === "r_pin_2").isMuted, true, "RacerTwo individual mute is remembered");
        assertEqual(list.find(r => r.userId === "r_pin_3").isMuted, false, "RacerThree remains individually unmuted");

        // Sweep toggle race pins back ON globally
        const afterOn = rc.toggleRacePinsVisible();
        assertEqual(afterOn, true, "toggleRacePinsVisible turns global pins back ON");
        const visibleTrackCompetitors = rc.getRankedEntrants().filter(e => !e.isHost && !e.isMuted && rc.areRacePinsVisible());
        assertEqual(visibleTrackCompetitors.length, 2, "Only the 2 individually unmuted competitors render when global pins are turned back ON");
        assert(!visibleTrackCompetitors.some(e => e.userId === "r_pin_2"), "Individually muted RacerTwo stays hidden");
      });

      it("manages entrant and host DNF status transitions", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.disconnectFromRace();

        rc.connectToRace("dnf_test_room");
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: {
            raceId: "dnf_test_room",
            participants: [
              { user: "RacerA", status: "joined", currentTime: 65000 }
            ]
          }
        });

        // Set entrant to DNF
        rc.setEntrantDNF("RacerA", true);
        let entrants = rc.getRankedEntrants();
        let rA = entrants.find(e => e.username === "RacerA" || e.userId === "RacerA");
        assert(rA !== null, "RacerA found");
        assertEqual(rA.isDNF, true, "RacerA isDNF is true");
        assertEqual(rA.currentSplitName, "DNF", "RacerA split name is DNF");

        // Clear DNF
        rc.setEntrantDNF("RacerA", false);
        entrants = rc.getRankedEntrants();
        rA = entrants.find(e => e.username === "RacerA" || e.userId === "RacerA");
        assertEqual(rA.isDNF, false, "RacerA isDNF is cleared");

        // Host DNF
        assertEqual(rc.isHostDNF(), false, "Host starts not DNF");
        rc.setHostDNF(true);
        assertEqual(rc.isHostDNF(), true, "Host set to DNF");
        rc.setHostDNF(false);
        assertEqual(rc.isHostDNF(), false, "Host DNF cleared");

        rc.disconnectFromRace();
      });

      it("handles competitor split undo and rolls back splitTimes", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("undo_test_room");

        // 1. Competitor progresses to split index 3
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "UndoRunner",
            currentSplitIndex: 3,
            currentSplitName: "Stage 3",
            currentTime: 90000,
            splitTimes: [30, 60, 90]
          }
        });

        let entrants = rc.getRankedEntrants();
        let runner = entrants.find(e => e.username === "UndoRunner");
        assert(runner !== null, "UndoRunner exists");
        assertEqual(runner.currentSplitIndex, 3, "Runner is at split 3");
        assertEqual(runner.splitTimes.length, 3, "Runner has 3 split times");

        // 2. Competitor undid to split index 1
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "UndoRunner",
            currentSplitIndex: 1,
            currentSplitName: "Stage 1",
            currentTime: 35000
          }
        });

        entrants = rc.getRankedEntrants();
        runner = entrants.find(e => e.username === "UndoRunner");
        assertEqual(runner.currentSplitIndex, 1, "Runner rolled back to split 1");
        assertEqual(runner.splitTimes.length, 1, "Split times sliced to 1");

        rc.disconnectFromRace();
      });

      it("handles race lifecycle cancellations, finishes, and predictions", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("life_test_room");

        // Countdown cancellation
        rc.handleRaceMessage({
          type: "countdown",
          seconds: 10
        });
        assertEqual(rc.getRaceStatus(), "starting", "Status is starting during countdown");

        rc.handleRaceMessage({
          type: "message",
          data: { type: "race-start-canceled" }
        });
        assertEqual(rc.getRaceStatus(), "open", "Status reverts to open on cancellation");

        // Race finish
        rc.handleRaceMessage({
          type: "message",
          data: { type: "race-finish" }
        });
        assertEqual(rc.getRaceStatus(), "finished", "Status is finished");

        // Monte Carlo & Estimated Finish Time Predictions
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "PredRunner",
            monteCarloPrediction: 3600,
            estimatedFinishTime: 3650000
          }
        });
        const runner = rc.getRankedEntrants().find(e => e.username === "PredRunner");
        assert(runner !== null, "PredRunner exists");
        assertEqual(runner.monteCarloPrediction, 3600, "Monte Carlo prediction stored");
        assertEqual(runner.currentPrediction, 3650, "Estimated finish time converted from ms to sec");

        rc.disconnectFromRace();
      });

      it("toggles entrant muting and global pins visibility APIs", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("mute_test_room");

        rc.handleRaceMessage({
          type: "participantUpdate",
          data: { user: "MuteTarget", status: "joined" }
        });

        // Entrant mute
        rc.setEntrantMuted("MuteTarget", true);
        let target = rc.getRankedEntrants().find(e => e.username === "MuteTarget");
        assertEqual(target.isMuted, true, "isMuted is true");

        assertEqual(rc.toggleEntrantMuted("MuteTarget"), false, "Toggle entrant unmutes");
        target = rc.getRankedEntrants().find(e => e.username === "MuteTarget");
        assertEqual(target.isMuted, false, "isMuted is false");

        // Global pins visibility
        assertEqual(rc.areRacePinsVisible(), true, "Pins default to visible");
        assertEqual(rc.setRacePinsVisible(false), false, "Set pins invisible");
        assertEqual(rc.areRacePinsVisible(), false, "Pins are invisible");
        assertEqual(rc.toggleRacePinsVisible(), true, "Toggle pins makes them visible");

        rc.disconnectFromRace();
      });
    });
})();
