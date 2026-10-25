/**
 * tests/unit/race/simulation.test.js
 * Simulated competitors, pacing, lobby/countdown flows and simulation reset.
 * (Split from the former tests/unit/core/race-client.test.js.)
 */

(function () {
  "use strict";

    describe("Race: Simulation", () => {
      it("Simulated competitors advance through split names dynamically", () => {
        const rc = window.LiveSplit.RaceClient;
        const splits = ["Forest", "Cave", "Castle", "Boss"];
        const comps = [20, 40, 60, 80];
        rc.startSimulation(splits, comps);

        const entrants = rc.getRankedEntrants();
        const comp1 = entrants.find(e => !e.isHost);
        assert(comp1, "competitor exists");
        assertEqual(comp1.currentSplitName, "Forest");

        // Simulate host progressing past 45s (into 'Castle' split)
        rc.updateHostProgress(50, 2, [20, 40], comps, "Castle", splits);
        const updated = rc.getRankedEntrants();
        const updatedComp = updated.find(e => e.userId === comp1.userId);
        assert(updatedComp.currentSplitName === "Castle" || updatedComp.currentSplitName === "Boss" || updatedComp.currentSplitName === "Cave",
          "competitor split advanced based on pace");

        rc.stopSimulation();
      });

      it("Adaptive game-agnostic pacing centers the pack on the host with faster and slower rivals", () => {
        const rc = window.LiveSplit.RaceClient;
        // Test with a 3.5 hour course (12,240s) similar to FFX Cutscene Remover
        rc.startSimulation(
          ["Split 1", "Split 2", "Split 3", "Final"],
          [3000, 6000, 9000, 12240]
        );

        const entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 10, "10 racers total (9 rivals + 1 host)");

        const speedDemon = entrants.find(e => e.userId === "sim_speeddemon");
        const shadow = entrants.find(e => e.userId === "sim_shadow");

        // SpeedDemon final checkpoint should be faster than baseline
        const sdFinal = speedDemon.checkpointTimes[3];
        assert(sdFinal < 12240, `SpeedDemon is faster than baseline (${Math.round(sdFinal)}s vs 12240s)`);
        assert(12240 - sdFinal > 100, `SpeedDemon gap is ahead (${Math.round(12240 - sdFinal)}s)`);

        // ShadowPacer final checkpoint should be slower than baseline
        const shadowFinal = shadow.checkpointTimes[3];
        assert(shadowFinal > 12240, `ShadowPacer is slower than baseline (${Math.round(shadowFinal)}s vs 12240s)`);
        assert(shadowFinal - 12240 > 100, `ShadowPacer gap is behind (${Math.round(shadowFinal - 12240)}s)`);

        rc.stopSimulation();
      });

      it("Reset cleanly clears simulation state and leaderboard transforms", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);
        rc.updateHostProgress(45, 1, [30], [30, 60], "Split 2");

        assertEqual(typeof rc.reset, "function");
        assertEqual(typeof window.LiveSplit.Leaderboard.reset, "function");

        rc.reset();
        const entrants = rc.getRankedEntrants();
        assertEqual(entrants[0].currentTimeSec, 0);

        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);
        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        rows.forEach((r) => {
          assertEqual(r.style.transform, "");
        });

        rc.stopSimulation();
      });

      it("Simulated competitors advance by Personal Best pace and hang at split node if slower or jump forward if faster", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3", "Finished"], [30, 60, 90, 120]);

        const entrants = rc.getRankedEntrants();
        const comp = entrants.find(e => !e.isHost);
        assert(comp, "Competitor exists in simulation");
        assert(Array.isArray(comp.pbCheckpointTimes) && comp.pbCheckpointTimes.length === 4, "Competitor has pbCheckpointTimes generated");

        // Manually configure test checkpoints: PB = 30s for Split 1, actual = 45s (slower by 15s)
        comp.pbCheckpointTimes = [30.0, 60.0, 90.0, 120.0];
        comp.checkpointTimes = [45.0, 75.0, 105.0, 135.0];

        // 1. Midway through split (15s): competitor pin moves at normal expected pace (15 / 30 = 0.50)
        // Does NOT slow down in advance!
        rc.updateHostProgress(15, 0, [], [30, 60, 90, 120], "Split 1");
        let list = rc.getRankedEntrants();
        let targetComp = list.find(e => e.userId === comp.userId);
        assertEqual(targetComp.currentSplitIndex, 0, "Competitor in Split 1");
        assert(Math.abs(targetComp.score - 0.50) < 0.05, "Pin moves at normal expected pace, not slowed down in advance");

        // 2. At 30s: Competitor has reached expected PB duration (30 / 30 = 1.0)
        rc.updateHostProgress(30, 0, [], [30, 60, 90, 120], "Split 1");
        list = rc.getRankedEntrants();
        targetComp = list.find(e => e.userId === comp.userId);
        assertEqual(targetComp.currentSplitIndex, 0, "Competitor still in Split 1");
        assertEqual(targetComp.score, 1.0, "Pin reaches 100% of segment at expected PB time");

        // 3. At 40s: Competitor is overdue (40s > 30s PB, but hasn't reached actual 45s split yet)
        // Pin hangs at split node (capped at 1.0)
        rc.updateHostProgress(40, 0, [], [30, 60, 90, 120], "Split 1");
        list = rc.getRankedEntrants();
        targetComp = list.find(e => e.userId === comp.userId);
        assertEqual(targetComp.currentSplitIndex, 0, "Competitor still in Split 1");
        assertEqual(targetComp.score, 1.0, "Pin hangs at split node (score remains 1.0)");
        assert(targetComp.elapsedSegmentSec > targetComp.expectedSegmentSec, "Elapsed time exceeds expected time on leaderboard");

        // 4. At 45s: Competitor reaches actual split time!
        // Split occurs with red flash, advances to Split 2, and pin enters next segment
        rc.updateHostProgress(45.5, 0, [], [30, 60, 90, 120], "Split 1");
        list = rc.getRankedEntrants();
        targetComp = list.find(e => e.userId === comp.userId);
        assertEqual(targetComp.currentSplitIndex, 1, "Competitor advanced to Split 2");
        assertEqual(targetComp.lastSplitEffect?.type, "red", "Slower split triggered red split flash");
        assert(targetComp.score >= 1.0 && targetComp.score < 2.0, "Competitor entered segment 2");

        // 5. Test faster split: PB = 30s (total 60s), actual = 15s (total 60s)
        targetComp.pbCheckpointTimes = [45.0, 75.0, 105.0, 135.0];
        targetComp.checkpointTimes = [45.0, 60.0, 90.0, 120.0]; // 15s duration on Split 2

        // At 55s (10s into Split 2): pin is at 10 / 30 = 0.33 of segment 2 (score ~ 1.33)
        rc.updateHostProgress(55, 0, [], [30, 60, 90, 120], "Split 1");
        list = rc.getRankedEntrants();
        targetComp = list.find(e => e.userId === comp.userId);
        assert(Math.abs(targetComp.score - 1.33) < 0.05, "Pin moves at normal expected pace across segment 2");

        // At 60.5s: competitor splits early! Pin jumps to Split 3 (score >= 2.0) with gold flash
        rc.updateHostProgress(60.5, 0, [], [30, 60, 90, 120], "Split 1");
        list = rc.getRankedEntrants();
        targetComp = list.find(e => e.userId === comp.userId);
        assertEqual(targetComp.currentSplitIndex, 2, "Competitor early split jumped to Split 3");
        assertEqual(targetComp.lastSplitEffect?.type, "gold", "Fast split triggered gold split flash");
        assert(targetComp.score >= 2.0, "Pin jumped to split node / next segment");

        rc.stopSimulation();
      });

      it("Simulation timescale parity prevents slower host from jumping to 1st place when split time is shorter due to GameTime vs RealTime difference", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.setTimingMethod("GameTime");

        // Course targets: Game Time targets = [100.0, 200.0], Real Time targets = [140.0, 280.0]
        rc.startSimulation(["Split 1", "Split 2"], [100.0, 200.0], [140.0, 280.0]);

        const entrants = rc.getRankedEntrants();
        const competitor = entrants.find(e => !e.isHost);
        assert(competitor, "Competitor exists in simulation");

        // Configure competitor checkpoints:
        // Competitor completes Split 1 at 95.0s Game Time / 133.0s Real Time (faster than course target)
        competitor.checkpointTimesGT = [95.0, 190.0];
        competitor.checkpointTimesRT = [133.0, 266.0];
        competitor.checkpointTimes = competitor.checkpointTimesGT;

        // 1. Race is at 96s Game Time (135s Real Time): Competitor has reached 95s Game Time and split to Split 2!
        // Host has not split yet (Host is on Split 1, at 96s Game Time / 135s Real Time)
        rc.updateHostProgress(
          96.0, 0, [], [100.0, 200.0], "Split 1",
          ["Split 1", "Split 2"], null, true,
          135.0, [140.0, 280.0], [], "GameTime"
        );

        let list = rc.getRankedEntrants();
        let currentComp = list.find(e => e.userId === competitor.userId);
        let currentHost = list.find(e => e.isHost);
        assertEqual(currentComp.currentSplitIndex, 1, "Competitor has completed Split 1 and is on Split 2");
        assertEqual(currentHost.currentSplitIndex, 0, "Host is still on Split 1");
        const compIndexStep1 = list.findIndex(e => e.userId === competitor.userId);
        const hostIndexStep1 = list.findIndex(e => e.isHost);
        assert(compIndexStep1 < hostIndexStep1, "Competitor is ahead of host before host splits");
        assert(currentHost.rank > 1, "Host is not in 1st place before splitting");

        // 2. Later at 150s Real Time / 105s Game Time: Host splits!
        // Host completed Split 1 in 105.0s Game Time / 150.0s Real Time.
        // Even though Host's 105.0s is shorter than Competitor's Real Time 133.0s,
        // it must compare against Competitor's Game Time 95.0s!
        rc.updateHostProgress(
          105.0, 1, [105.0], [100.0, 200.0], "Split 2",
          ["Split 1", "Split 2"], null, true,
          150.0, [140.0, 280.0], [150.0], "GameTime"
        );

        list = rc.getRankedEntrants();
        currentComp = list.find(e => e.userId === competitor.userId);
        currentHost = list.find(e => e.isHost);
        assertEqual(currentComp.currentSplitIndex, 1, "Competitor is on Split 2");
        assertEqual(currentHost.currentSplitIndex, 1, "Host is on Split 2");
        const compIndexStep2 = list.findIndex(e => e.userId === competitor.userId);
        const hostIndexStep2 = list.findIndex(e => e.isHost);
        assert(compIndexStep2 < hostIndexStep2, "Competitor legitimately stays ahead of host (95.0s GT < 105.0s GT)");
        assert(currentHost.rank > 1, "Host does NOT jump to 1st place because Host was slower in Game Time");

        // 3. Switch timing method to Real Time:
        // Host's Real Time split (150.0s) is compared against Competitor's Real Time split (133.0s)
        rc.setTimingMethod("RealTime");
        list = rc.getRankedEntrants();
        const compIndexStep3 = list.findIndex(e => e.userId === competitor.userId);
        const hostIndexStep3 = list.findIndex(e => e.isHost);
        assert(compIndexStep3 < hostIndexStep3, "Competitor legitimately stays ahead of host in Real Time (133.0s RT < 150.0s RT)");
        assert(list.find(e => e.isHost).rank > 1, "Host does not jump to 1st place in Real Time");

        rc.stopSimulation();
      });

      it("Simulation with { withLobby: true } initializes lobby state, runners ready up, and countdown starts", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.reset();
        rc.stopSimulation();
        rc.disconnectFromRace();

        rc.startSimulation(["Split 1", "Split 2"], [30, 60], [30, 60], { withLobby: true, immediate: true });
        assertEqual(rc.isSimulating(), true, "Simulation is active");
        assertEqual(rc.getRaceStatus(), "open", "Race status starts in open/lobby state");

        let entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 10, "Provides 10 runners");
        const comp = entrants.find(e => !e.isHost);
        assertEqual(comp.status, "joined", "Competitor initial status is joined");
        assertEqual(comp.isReady, false, "Competitor initial isReady is false");
        assert(typeof comp.pbSec === "number" && comp.pbSec > 0, "Competitor has valid pbSec for lobby display");

        // Render leaderboard in simulation lobby
        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);
        const statusBadge = document.getElementById("leaderboard-status-badge");
        assertEqual(statusBadge.innerText, "LOBBY", "Badge displays LOBBY in simulation");
        assert(statusBadge.classList.contains("status-lobby"), "Badge has status-lobby class");

        // Verify lobby banner is rendered with ready count
        const lobbyBanner = document.querySelector(".leaderboard-lobby-banner");
        assert(lobbyBanner !== null, "Lobby banner renders in simulated lobby");

        // Calling handleHostRunStarted while simulating in lobby immediately transitions to in_progress (GO!)
        rc.handleHostRunStarted();
        assertEqual(rc.getRaceStatus(), "in_progress", "LiveSplit start transitions simulation to in_progress");
        entrants = rc.getRankedEntrants();
        const updatedComp = entrants.find(e => !e.isHost);
        assertEqual(updatedComp.status, "started", "Competitors switch to started");

        rc.stopSimulation();
      });

      it("Simulation progressive lobby starts with host, rivals join 1-by-1 and ready up before countdown", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.reset();
        rc.stopSimulation();
        rc.disconnectFromRace();

        // 1. Start simulation with progressive lobby (default for UI Test Race)
        rc.startSimulation(["Split 1", "Split 2"], [30, 60], [30, 60], { withLobby: true, progressive: true });
        assertEqual(rc.isSimulating(), true, "Simulation is active");
        assertEqual(rc.getRaceStatus(), "open", "Race status starts in open/lobby state");

        // Initially only Host ('You') is in the lobby
        let entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 1, "Initially only 1 runner (Host) in progressive lobby");
        assertEqual(entrants[0].isHost, true, "First runner is Host");
        assertEqual(entrants[0].status, "ready", "Host is ready");

        // Calling handleHostRunStarted even before everyone joins immediately brings in all 9 rivals and starts
        rc.handleHostRunStarted();
        assertEqual(rc.getRaceStatus(), "in_progress", "Early start cleanly triggers in_progress");
        entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 10, "All 10 runners are populated and present upon run start");
        const rivals = entrants.filter(e => !e.isHost);
        assertEqual(rivals.length, 9, "All 9 competitors are present");
        rivals.forEach(r => {
          assertEqual(r.status, "started", `${r.username} status is started`);
          assertEqual(r.isReady, true, `${r.username} isReady is true`);
        });

        rc.stopSimulation();
      });

      it("Simulation pre-race display preserves ready status and PB display during countdown, frozen until GO!", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.reset();
        rc.stopSimulation();
        rc.disconnectFromRace();

        rc.startSimulation(["Split 1", "Split 2"], [30, 60], [30, 60], { withLobby: true, immediate: true });
        let entrants = rc.getRankedEntrants();
        const comp = entrants.find(e => !e.isHost);
        comp.status = "ready";
        comp.isReady = true;

        // Broadcast countdown
        rc.handleRaceMessage({ type: "countdown", countdown: 3 });
        assertEqual(rc.getCountdownSec(), 3);
        assertEqual(rc.getRaceStatus(), "starting");

        window.LiveSplit.Leaderboard.renderLeaderboard(rc.getRankedEntrants(), true, false, false);
        const statusBadge = document.getElementById("leaderboard-status-badge");
        assertEqual(statusBadge.innerText, "START 3s");

        const compRow = document.querySelector(`.leaderboard-row[data-user-id="${comp.userId}"]`);
        assert(compRow !== null, "Competitor row exists");
        const gapEl = compRow.querySelector(".racer-gap");
        assertEqual(gapEl.textContent, "READY", "During countdown gap remains READY, not LEADER or --");
        const expEl = compRow.querySelector(".racer-expected");
        assert(expEl.textContent.includes("PB"), "During countdown expected column retains PB, not elapsed split timer");

        rc.stopSimulation();
      });

      it("rc.reset() during active simulation resets all racers to 00:00 and restarts lobby sequence cleanly", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.reset();
        rc.stopSimulation();
        rc.disconnectFromRace();

        // 1. Start simulation with lobby
        rc.startSimulation(["Split 1", "Split 2"], [30, 60], [30, 60], { withLobby: true, immediate: true });
        // Advance to in_progress
        rc.handleHostRunStarted();
        assertEqual(rc.getRaceStatus(), "in_progress", "Race is in progress");

        // Competitors now have active time
        rc.updateHostProgress(15, 0, [], [30, 60], "Split 1", ["Split 1", "Split 2"], null, true, 15);
        let comp = rc.getRankedEntrants().find(e => !e.isHost);
        assertEqual(comp.currentTimeSec, 15, "Competitor reached 15s in run");

        // 2. Host resets splits in LiveSplit -> calls rc.reset()
        rc.reset();

        // 3. Verify clean reset to lobby
        assertEqual(rc.getRaceStatus(), "open", "Race status returned to open (lobby)");
        assertEqual(rc.getCountdownSec(), null, "Countdown target is null");
        comp = rc.getRankedEntrants().find(e => !e.isHost);
        assertEqual(comp.currentTimeSec, 0, "Competitor time cleanly reset to 00:00");
        assertEqual(comp.currentSplitIndex, 0, "Competitor split index reset to 0");
        assertEqual(comp.status, "joined", "Competitor status reset to joined");
        assertEqual(comp.isReady, false, "Competitor readiness reset to false");

        rc.stopSimulation();
      });

      it("Simulated racers wait at 00:00 when LiveSplit is connected at the starting line", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.disconnectFromRace();

        // Signal that LiveSplit is connected at start line (idx = -1, currentTime = 0)
        rc.setExternalHostConnected(true);
        rc.startSimulation(["Split 1", "Split 2"], [30, 60], [30, 60], { withLobby: false });

        // Force in_progress status (e.g. countdown ended and said GO!)
        rc.handleRaceMessage({ type: "countdown", countdown: 0 });
        assertEqual(rc.getRaceStatus(), "in_progress", "Race is in_progress");

        // Since LiveSplit is connected and hostState.currentTimeSec is 0, racers should stay at 0
        let comp = rc.getRankedEntrants().find(e => !e.isHost);
        assertEqual(comp.currentTimeSec, 0, "Competitor stays at 00:00 waiting for host LiveSplit start");

        // Now host starts LiveSplit
        rc.handleHostRunStarted();
        rc.updateHostProgress(5.0, 0, [], [30, 60], "Split 1", ["Split 1", "Split 2"], null, true, 5.0);

        comp = rc.getRankedEntrants().find(e => !e.isHost);
        assertEqual(comp.currentTimeSec, 5.0, "Competitor now synchronizes with host start");

        rc.setExternalHostConnected(false);
        rc.stopSimulation();
      });

      it("handles simulation virtual host advance and competitor completions", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.setExternalHostConnected(false);

        // Very short course targets (1s, 2s, 3s)
        rc.startSimulation(["Intro", "Middle", "End"], [1, 2, 3], [1, 2, 3], { withLobby: false });
        assertEqual(rc.isSimulating(), true, "Simulation active");

        // Update host progress past final split target
        rc.updateHostProgress(5.0, 3, [1.0, 2.0, 3.0], [1, 2, 3], "End", ["Intro", "Middle", "End"]);

        const entrants = rc.getRankedEntrants();
        const finishedCompetitors = entrants.filter(e => e.isFinished);
        assert(finishedCompetitors.length > 0, "Host and/or pace contenders mark as finished");

        rc.stopSimulation();
      });
    });
})();
