/**
 * tests/unit/race/standings.test.js
 * Checkpoint gaps/intervals, position updates, timing-method parity, DNF ranking, ribbons and split flash types.
 * (Split from the former tests/unit/core/race-client.test.js.)
 */

(function () {
  "use strict";

    describe("Race: Standings, gaps & deltas", () => {
      it("Checkpoint-based fixed leader gap and interval to ahead timing model", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["World 1", "World 2", "World 3"], [30, 60, 90]);

        // Phase 1: On Split 1 before anyone splits, gap is blank for everyone
        let entrants = rc.getRankedEntrants();
        assertEqual(entrants[0].gapDisplay, "LEADER");
        assertEqual(entrants[0].intervalDisplay, "--");
        assertEqual(entrants[1].gapDisplay, "--", "P2 gap is blank before anyone splits");
        assertEqual(entrants[1].intervalDisplay, "--", "P2 interval is blank before anyone splits");

        // Phase 2: Leader splits on split 0 at 28.0s, competitor is at 29.5s on split 0
        const leader = entrants[0];
        const competitor = entrants[1];
        leader.currentSplitIndex = 1;
        leader.splitTimes = [28.0];
        leader.currentTimeSec = 29.5;

        competitor.currentSplitIndex = 0;
        competitor.splitTimes = [];
        competitor.currentTimeSec = 29.5;

        entrants = rc.getRankedEntrants();
        assertEqual(entrants[0].userId, leader.userId);
        assertEqual(entrants[0].gapDisplay, "LEADER");
        // Competitor's delta starts incrementing up live: 29.5 - 28.0 = +1.5s
        assertEqual(entrants[1].gapDisplay, "+1.5s", "Delta starts incrementing live once leader splits");
        assertEqual(entrants[1].intervalDisplay, "+1.5s");

        // Phase 3: Competitor now splits on split 0 at 31.0s (31.0 - 28.0 = +3.0s)
        competitor.currentSplitIndex = 1;
        competitor.splitTimes = [31.0];
        competitor.currentTimeSec = 31.0;

        entrants = rc.getRankedEntrants();
        assertEqual(entrants[1].gapDisplay, "+3.0s", "Gap locks into fixed gap based on last split");

        // Both are running split 1: gap remains fixed even as competitor advances to 45.0s
        leader.currentTimeSec = 45.0;
        competitor.currentTimeSec = 45.0;
        entrants = rc.getRankedEntrants();
        assertEqual(entrants[1].gapDisplay, "+3.0s", "Gap remains fixed while on pace during split 1");

        // Phase 4: Leader splits on split 1 at 58.0s, competitor still running split 1
        // At 58.1s (0.1s after leader split), delta accumulates immediately: 3.0 + 0.1 = +3.1s
        leader.currentSplitIndex = 2;
        leader.splitTimes = [28.0, 58.0];
        leader.currentTimeSec = 58.1;

        competitor.currentSplitIndex = 1;
        competitor.splitTimes = [31.0];
        competitor.currentTimeSec = 58.1;

        entrants = rc.getRankedEntrants();
        assertEqual(entrants[1].gapDisplay, "+3.1s", "Delta starts accumulating immediately when leader splits on subsequent split");

        // At 65.0s (7.0s after leader split): 3.0s prevGap + 7.0s = +10.0s
        leader.currentTimeSec = 65.0;
        competitor.currentTimeSec = 65.0;
        entrants = rc.getRankedEntrants();
        assertEqual(entrants[1].gapDisplay, "+10.0s", "Delta accumulates as competitor continues running split 1");

        // Phase 5: Leader gets TWO splits ahead (completed split 2 at 88.0s), competitor still on split 1 at 95.0s
        leader.currentSplitIndex = 3;
        leader.splitTimes = [28.0, 58.0, 88.0];
        competitor.currentTimeSec = 95.0;

        entrants = rc.getRankedEntrants();
        // Competitor on split 1: 3.0s prevGap + (95.0 - 58.0) = 3.0 + 37.0 = +40.0s
        assertEqual(entrants[1].gapDisplay, "+40.0s", "Appropriately tracks deficit when leader is two splits ahead");

        rc.stopSimulation();
      });

      it("You tile displays valid milestone delta when host splits with object completedSplitTimes", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);
        // Simulate LiveSplit reporting split times as an Object { 0: 31.5 }
        rc.updateHostProgress(35, 1, { 0: 31.5 }, [30, 60, 90], "Split 2", ["Split 1", "Split 2", "Split 3"]);

        const entrants = rc.getRankedEntrants();
        const you = entrants.find(e => e.isHost || e.userId === "you");
        assert(you !== undefined, "host entrant is present");
        assert(you.gapDisplay !== "--", `host gapDisplay should not be blank, got ${you.gapDisplay}`);

        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);
        const youRow = document.querySelector("#leaderboard-rows .leaderboard-row.is-host");
        assert(youRow !== null, "You row is rendered");
        const youGap = youRow.querySelector(".racer-gap");
        assert(youGap && youGap.textContent !== "--", `You row gap in DOM should not be --, got ${youGap ? youGap.textContent : "null"}`);

        rc.stopSimulation();
      });

      it("Comparison switching does not destabilize competitor checkpoints or trigger false split flashes", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);

        // Advance host to 15s (midway through Split 1)
        rc.updateHostProgress(15, 0, {}, [30, 60, 90], "Split 1", ["Split 1", "Split 2", "Split 3"]);
        let entrants = rc.getRankedEntrants();
        const competitorInitial = entrants.find(e => !e.isHost && e.userId === "sim_apex");
        assertEqual(competitorInitial.currentSplitIndex, 0, "ApexRunner on split 0 at 15s");
        assertEqual(competitorInitial.lastSplitEffect, null, "No split flash effect active before split");

        // Host switches comparison profile (e.g. to Best Segments where Split 1 target is 10s)
        rc.updateHostProgress(15, 0, {}, [10, 20, 30], "Split 1", ["Split 1", "Split 2", "Split 3"]);
        entrants = rc.getRankedEntrants();
        const competitorAfterSwitch = entrants.find(e => !e.isHost && e.userId === "sim_apex");

        // Competitors must NOT falsely jump to Split 1 or fire split flashes
        assertEqual(competitorAfterSwitch.currentSplitIndex, 0, "ApexRunner remains on split 0 despite host comparison switch");
        assertEqual(competitorAfterSwitch.lastSplitEffect, null, "No false split flash caused by comparison switch");

        rc.stopSimulation();
      });

      it("All competitor deltas increment immediately once leader crosses first split checkpoint", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);

        // Leader splits at 28.0s, race clock is at 28.5s
        let entrants = rc.getRankedEntrants();
        const leader = entrants[0];
        leader.currentSplitIndex = 1;
        leader.splitTimes = [28.0];
        leader.currentTimeSec = 28.5;

        // All other 9 runners are at race time 28.5s on split 0
        entrants.forEach(r => {
          if (r.userId !== leader.userId) {
            r.currentSplitIndex = 0;
            r.splitTimes = [];
            r.currentTimeSec = 28.5;
          }
        });

        entrants = rc.getRankedEntrants();
        assertEqual(entrants[0].gapDisplay, "LEADER");

        // Every single competitor behind must have an incrementing gap of +0.5s (28.5 - 28.0)
        for (let i = 1; i < entrants.length; i++) {
          assertEqual(entrants[i].gapDisplay, "+0.5s", `Competitor ${entrants[i].username} delta increments immediately`);
        }

        rc.stopSimulation();
      });

      it("splits trigger immediate position swap without delay when racer reaches higher split index", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);

        rc.updateHostProgress(25, 0, [], [30, 60, 90], "Split 1");
        const entrantsBefore = rc.getRankedEntrants();
        const firstPlace = entrantsBefore[0];
        const secondPlace = entrantsBefore[1];
        const thirdPlace = entrantsBefore[2];

        // 1st place is on split 1, 2nd place is still on split 0
        firstPlace.currentSplitIndex = 1;
        secondPlace.currentSplitIndex = 0;
        // 3rd place racer completes split 0 and advances to split index 1
        thirdPlace.currentSplitIndex = 1;

        const entrantsAfter = rc.getRankedEntrants();
        assertEqual(entrantsAfter[0].userId, firstPlace.userId, "First place runner remains in 1st");
        assertEqual(entrantsAfter[1].userId, thirdPlace.userId, "Third place racer who split ahead is immediately ranked 2nd above racer on previous split");
        assertEqual(entrantsAfter[2].userId, secondPlace.userId, "Second place racer who has not split yet drops to 3rd");

        window.LiveSplit.Leaderboard.renderLeaderboard(entrantsAfter, true, false, false);
        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(rows[1].getAttribute("data-user-id"), thirdPlace.userId, "Leaderboard DOM row immediately reflects 2nd place swap");

        rc.stopSimulation();
      });

      it("Leaderboard positions update strictly upon split completion, ignoring mid-split predicted score fluctuations", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);

        // Entrant A completed Split 0 faster (25.0s) than Entrant B (28.0s)
        const entrants = rc.getRankedEntrants();
        const entrantA = entrants[0];
        const entrantB = entrants[1];

        entrantA.currentSplitIndex = 1;
        entrantA.splitTimes = [25.0];
        entrantA.score = 1.2; // 20% into Split 1

        entrantB.currentSplitIndex = 1;
        entrantB.splitTimes = [28.0];
        entrantB.score = 1.8; // 80% into Split 1 (predicted curve gives higher score!)

        const ranked = rc.getRankedEntrants();
        // Even though entrantB has a higher predicted score (1.8 vs 1.2), entrantA crossed Split 0 checkpoint first (25.0s < 28.0s)
        // Leaderboard position MUST NOT swap mid-split!
        assertEqual(ranked[0].userId, entrantA.userId, "Entrant A remains in 1st place mid-split based on last completed split");
        assertEqual(ranked[1].userId, entrantB.userId, "Entrant B remains in 2nd place mid-split despite higher predicted mid-split score");
        assertEqual(ranked[1].gapDisplay, "+3.0s", "Fixed leader gap (28.0 - 25.0) remains stable without jumping");

        // Now Entrant B actually completes Split 1 first! (split index advances to 2)
        entrantB.currentSplitIndex = 2;
        entrantB.splitTimes = [28.0, 52.0];
        entrantB.currentTimeSec = 52.0;

        const updated = rc.getRankedEntrants();
        assertEqual(updated[0].userId, entrantB.userId, "Entrant B overtakes Entrant A upon completing split checkpoint");
        assertEqual(updated[1].userId, entrantA.userId, "Entrant A drops to 2nd position upon Entrant B splitting");

        rc.stopSimulation();
      });

      it("RaceClient and competitor timers run on the active focused timing method (GameTime vs RealTime) so the race is balanced", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.setTimingMethod("RealTime");
        rc.startSimulation(["Forest", "Cave", "Castle"], [30, 60, 90], [35, 70, 105]);

        // Simulate host hitting a loading screen: Game Time (IGT) freezes at 40.0s, but Real Time (RTA) advances from 40.0s to 45.0s
        rc.updateHostProgress(
          40.0, // currentSec (IGT frozen)
          1,    // currentIndex
          [20.0], // completedSplitTimes (IGT)
          [30, 60, 90], // comparisonTimes (IGT)
          "Cave",
          ["Forest", "Cave", "Castle"],
          null,
          true,
          45.0, // realTimeSec (RTA keeps ticking!)
          [35, 70, 105], // comparisonTimesRT
          [22.0], // completedSplitTimesRT
          "RealTime"
        );

        const entrants = rc.getRankedEntrants();
        const host = entrants.find(e => e.isHost);
        const competitor = entrants.find(e => !e.isHost);

        // Verify race clock and competitor elapsed time are driven by Real Time (45.0s, not frozen 40.0s)
        assertEqual(host.currentTimeSec, 45.0, "Host currentTimeSec tracks Real Time (45.0s)");
        assertEqual(competitor.currentTimeSec, 45.0, "Competitor currentTimeSec tracks Real Time without freezing during load screen");

        // Host in Cave split: elapsed segment time is Real Time elapsed since split 0 (45.0 - 22.0 = 23.0s)
        assertEqual(host.elapsedSegmentDisplay, "23.0s", "Leaderboard segment elapsed time ticks in Real Time");
        // Expected segment duration is based on Real Time targets (70 - 35 = 35.0s)
        assertEqual(host.expectedSegmentDisplay, "35.0s", "Leaderboard expected segment time uses Real Time target");

        // Now verify Game Time focus:
        // Host currentTimeSec tracks Game Time (40.0s), expected segment uses Game Time target (30.0s),
        // and competitor continues tracking wall-clock progress without freezing
        rc.setTimingMethod("GameTime");
        const gtEntrants = rc.getRankedEntrants();
        const gtHost = gtEntrants.find(e => e.isHost);
        const gtCompetitor = gtEntrants.find(e => !e.isHost);
        assertEqual(gtHost.currentTimeSec, 40.0, "Host currentTimeSec tracks Game Time (40.0s) when Game Time is focused");
        assertEqual(gtHost.expectedSegmentDisplay, "30.0s", "Leaderboard expected segment time uses Game Time target (30.0s)");
        assertEqual(gtHost.elapsedSegmentDisplay, "20.0s", "Leaderboard segment elapsed time ticks in Game Time (40 - 20 = 20.0s)");
        assertEqual(gtCompetitor.currentTimeSec, 40.0, "Competitor currentTimeSec tracks focused Game Time (40.0s) so race is balanced");

        rc.stopSimulation();
      });

      it("Leaderboard deltas, expected segments, and host times follow focused timing method (GameTime vs RealTime) dynamically", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [25, 50, 75], [30, 60, 90]);

        // Host at Split 1 in Game Time: 20s (GT split = 20s), Real Time: 26s (RT split = 26s)
        rc.setTimingMethod("GameTime");
        rc.updateHostProgress(
          20.0, 1, [20.0], [25, 50, 75], "Split 2",
          ["Split 1", "Split 2", "Split 3"], null, true,
          26.0, [30, 60, 90], [26.0], "GameTime"
        );

        let list = rc.getRankedEntrants();
        let host = list.find(e => e.isHost);
        assertEqual(rc.getTimingMethod(), "GameTime", "Timing method is GameTime");
        assertEqual(host.currentTimeSec, 20.0, "Host time is Game Time (20.0s)");
        assertEqual(host.expectedSegmentDisplay, "25.0s", "Expected segment is Game Time PB (50 - 25 = 25s)");

        // Switch focus to RealTime:
        rc.setTimingMethod("RealTime");
        list = rc.getRankedEntrants();
        host = list.find(e => e.isHost);
        assertEqual(rc.getTimingMethod(), "RealTime", "Timing method is RealTime");
        assertEqual(host.currentTimeSec, 26.0, "Host time immediately shifts to Real Time (26.0s)");
        assertEqual(host.expectedSegmentDisplay, "30.0s", "Expected segment immediately shifts to Real Time PB (60 - 30 = 30s)");

        rc.stopSimulation();
      });

      it("Did Not Finish (DNF) runners rank at bottom of leaderboard with DNF badges while competitors continue racing", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);

        // Advance competitors and host into the race
        rc.updateHostProgress(45, 1, [25.0], [30, 60, 90], "Split 2");

        let entrants = rc.getRankedEntrants();
        const activeHost = entrants.find(e => e.isHost);
        assert(activeHost, "Host exists in active simulation");
        assertEqual(typeof activeHost.rank, "number", "Host initially has numeric rank");

        // Simulate host resetting/cancelling run (DNF)
        rc.setHostDNF(true);
        assertEqual(rc.isHostDNF(), true, "isHostDNF returns true");

        entrants = rc.getRankedEntrants();
        const dnfHost = entrants.find(e => e.isHost);
        assertEqual(dnfHost.rank, "DNF", "DNF runner receives 'DNF' rank");
        assertEqual(dnfHost.gapDisplay, "DNF", "DNF runner displays 'DNF' gap");
        assertEqual(dnfHost.expectedType, "DNF", "DNF runner displays 'DNF' expected type");

        // The DNF runner must be at the very bottom of the leaderboard
        assertEqual(entrants[entrants.length - 1].userId, dnfHost.userId, "DNF runner is sorted to the bottom of the standings");

        // Verify remaining competitors still have active ranks and positions
        const p1 = entrants[0];
        assertEqual(p1.rank, 1, "Leader remains in 1st place");
        assert(p1.currentTimeSec > 0, "Competitors continue racing with active time");

        // Render leaderboard and check DOM elements
        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);
        const hostRow = document.querySelector(`.leaderboard-row[data-user-id="${dnfHost.userId}"]`);
        assert(hostRow, "DNF host row rendered in DOM");
        assert(hostRow.classList.contains("is-dnf"), "DNF row receives .is-dnf styling");
        const posBadge = hostRow.querySelector(".pos-badge");
        assertEqual(posBadge.textContent.trim(), "DNF", "Position badge renders 'DNF'");
        assert(posBadge.classList.contains("pos-dnf"), "Position badge has pos-dnf class");

        rc.stopSimulation();
      });

      it("RaceClient dynamically prioritizes therun.gg predictedSingleTime and statistical models over PB for expected segment duration", () => {
        const rc = window.LiveSplit.RaceClient;
        assert(typeof rc.handleRaceMessage === "function", "RaceClient exports handleRaceMessage");

        const telemetryPayload = {
          userId: "racer_stat_pro",
          username: "StatPro",
          currentSplitIndex: 1,
          currentSplitName: "Stage 2",
          currentTime: 50000, // 50.0s (15s into Stage 2)
          splits: [
            {
              name: "Stage 1",
              splitTime: 35000, // 35.0s
              pbSplitTime: 40000
            },
            {
              name: "Stage 2",
              splitTime: null,
              pbSplitTime: 85000, // PB segment would be 85 - 40 = 45s
              predictedSingleTime: 24500, // therun.gg statistical prediction is 24.5s
              single: {
                averageTime: "26000",
                stdDev: "1800"
              },
              comparisons: {
                "Personal Best": 85000,
                "Balanced PB": 78000
              }
            }
          ],
          monteCarloPrediction: {
            bestEstimate: 120000,
            confidenceInterval: { lower: 115000, upper: 125000 }
          }
        };

        rc.handleRaceMessage(telemetryPayload);
        let ranked = rc.getRankedEntrants();
        let statRunner = ranked.find(r => r.userId === "racer_stat_pro");

        assert(statRunner, "StatPro entrant exists in ranked list");
        assertEqual(statRunner.hasStatisticalPrediction, true, "hasStatisticalPrediction is true");
        assertEqual(statRunner.expectedSegmentSec, 24.5, "expectedSegmentSec uses predictedSingleTime (24.5s)");
        assertEqual(statRunner.expectedSegmentDisplay, "24.5s", "expectedSegmentDisplay is 24.5s");

        // Verify dead-reckoned in-segment progress score:
        // elapsed = 50s - 35s = 15s. ratio = 15s / 24.5s = ~0.6122. score = 1 + 0.6122
        const expectedScore = 1 + (15 / 24.5);
        assert(Math.abs(statRunner.score - expectedScore) < 0.01, "score uses statistical prediction duration ratio");

        // Test Priority 2: Fallback to rolling averageTime if predictedSingleTime is absent
        delete statRunner.splits[1].predictedSingleTime;
        ranked = rc.getRankedEntrants();
        statRunner = ranked.find(r => r.userId === "racer_stat_pro");
        assertEqual(statRunner.hasStatisticalPrediction, true, "hasStatisticalPrediction is true for averageTime");
        assertEqual(statRunner.expectedSegmentSec, 26.0, "expectedSegmentSec falls back to rolling averageTime (26.0s)");

        // Test Priority 3: Fallback to Balanced PB if averageTime is absent
        delete statRunner.splits[1].single;
        ranked = rc.getRankedEntrants();
        statRunner = ranked.find(r => r.userId === "racer_stat_pro");
        assertEqual(statRunner.hasStatisticalPrediction, true, "hasStatisticalPrediction is true for Balanced PB");
        assertEqual(statRunner.expectedSegmentSec, 78.0, "expectedSegmentSec falls back to Balanced PB (78s)");

        // Test Priority 4: Fallback to active PB if splits array is cleared
        delete statRunner.splits;
        statRunner.pbCheckpointTimes = [40, 85];
        ranked = rc.getRankedEntrants();
        statRunner = ranked.find(r => r.userId === "racer_stat_pro");
        assertEqual(statRunner.hasStatisticalPrediction, false, "hasStatisticalPrediction is false for standard PB");
        assertEqual(statRunner.expectedSegmentSec, 45.0, "expectedSegmentSec falls back to standard PB (85 - 40 = 45s)");

        rc.disconnectFromRace();
      });

      it("Fastest Segment Diagonal Ribbons (Gold, Silver, Bronze) award top 3 fastest segments on active split and advance on next split", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3", "Finished"], [30, 60, 90, 120]);

        // At start (Split 0), no one has completed a split: no ribbons
        let list = rc.getRankedEntrants();
        assert(!list.some(r => r.segmentRibbon), "No ribbons before first split");

        // 1. Leader (Host) splits on Split 1 at 28.0s: Leader gets the gold ribbon!
        rc.updateHostProgress(28.0, 1, [28.0], [30, 60, 90, 120], "Split 2");
        list = rc.getRankedEntrants();
        const host = list.find(r => r.isHost);
        assertEqual(host.segmentRibbon, "gold", "Leader receives gold ribbon immediately upon splitting Split 1");
        assertEqual(host.ribbonSegmentName, "Split 1", "Ribbon is for Split 1");
        assertEqual(host.ribbonSegmentTime, 28.0, "Ribbon segment time is 28.0s");

        // Render in leaderboard and verify DOM
        window.LiveSplit.Leaderboard.renderLeaderboard(list, true, false, false);
        let hostRow = document.querySelector(`.leaderboard-row[data-user-id="${host.userId}"]`);
        let hostRibbon = hostRow.querySelector(".racer-ribbon");
        assert(hostRibbon && hostRibbon.classList.contains("is-active") && hostRibbon.classList.contains("ribbon-gold"), "Leader row displays active gold diagonal ribbon in DOM");

        // 2. Competitor A splits on Split 1 with 26.5s (faster than leader's 28.0s)
        // Competitor A takes Gold (26.5s), Leader shifts to Silver (28.0s)!
        const compA = list.find(r => !r.isHost);
        compA.currentSplitIndex = 1;
        compA.splitTimes = [26.5];

        list = rc.getRankedEntrants();
        const updatedHost = list.find(r => r.isHost);
        const updatedCompA = list.find(r => r.userId === compA.userId);
        assertEqual(updatedCompA.segmentRibbon, "gold", "Competitor with faster segment claims Gold ribbon");
        assertEqual(updatedCompA.ribbonSegmentTime, 26.5, "Gold ribbon displays faster segment time 26.5s");
        assertEqual(updatedHost.segmentRibbon, "silver", "Previous fastest runner shifts to Silver ribbon");

        // Render and verify DOM transfer
        window.LiveSplit.Leaderboard.renderLeaderboard(list, true, false, false);
        hostRibbon = hostRow.querySelector(".racer-ribbon");
        const compARow = document.querySelector(`.leaderboard-row[data-user-id="${compA.userId}"]`);
        const compARibbon = compARow.querySelector(".racer-ribbon");
        assert(hostRibbon.classList.contains("is-active") && hostRibbon.classList.contains("ribbon-silver"), "Host row updates to silver ribbon in DOM");
        assert(compARibbon && compARibbon.classList.contains("is-active") && compARibbon.classList.contains("ribbon-gold"), "Competitor A row displays active gold ribbon in DOM");

        // 3. Competitor B splits on Split 1 with 29.0s (3rd fastest) -> receives Bronze ribbon,
        // and Competitor C splits with 30.5s (4th fastest) -> receives no ribbon!
        const compB = list.find(r => !r.isHost && r.userId !== compA.userId);
        const compC = list.find(r => !r.isHost && r.userId !== compA.userId && (!compB || r.userId !== compB.userId));
        if (compB && compC) {
          compB.currentSplitIndex = 1;
          compB.splitTimes = [29.0];
          compC.currentSplitIndex = 1;
          compC.splitTimes = [30.5];
          list = rc.getRankedEntrants();
          const checkCompA = list.find(r => r.userId === compA.userId);
          const checkHost = list.find(r => r.isHost);
          const checkCompB = list.find(r => r.userId === compB.userId);
          const checkCompC = list.find(r => r.userId === compC.userId);
          assertEqual(checkCompA.segmentRibbon, "gold", "Competitor A holds Gold ribbon (26.5s)");
          assertEqual(checkHost.segmentRibbon, "silver", "Host holds Silver ribbon (28.0s)");
          assertEqual(checkCompB.segmentRibbon, "bronze", "Competitor B claims Bronze ribbon (29.0s)");
          assertEqual(checkCompC.segmentRibbon, null, "4th fastest competitor C receives no ribbon");

          window.LiveSplit.Leaderboard.renderLeaderboard(list, true, false, false);
          const compBRow = document.querySelector(`.leaderboard-row[data-user-id="${compB.userId}"]`);
          const compBRibbon = compBRow.querySelector(".racer-ribbon");
          const compCRow = document.querySelector(`.leaderboard-row[data-user-id="${compC.userId}"]`);
          const compCRibbon = compCRow.querySelector(".racer-ribbon");
          assert(compBRibbon && compBRibbon.classList.contains("is-active") && compBRibbon.classList.contains("ribbon-bronze"), "Competitor B row renders active bronze ribbon");
          assert(compCRibbon && !compCRibbon.classList.contains("is-active"), "Competitor C row has inactive ribbon");
        }

        // 4. Leader splits on Split 2 at 57.0s (segment = 57.0 - 28.0 = 29.0s)
        // Split in contention advances to Split 2! Leader is the first to complete Split 2, so leader claims Gold ribbon for Split 2!
        rc.updateHostProgress(57.0, 2, [28.0, 57.0], [30, 60, 90, 120], "Split 3");
        list = rc.getRankedEntrants();
        const leaderSplit2 = list.find(r => r.isHost);
        assertEqual(leaderSplit2.segmentRibbon, "gold", "Leader claims gold ribbon for Split 2 upon splitting");
        assertEqual(leaderSplit2.ribbonSegmentName, "Split 2", "Target split advanced to Split 2");
        assertEqual(leaderSplit2.ribbonSegmentTime, 29.0, "Ribbon records segment time on Split 2");

        rc.stopSimulation();
        window.LiveSplit.Leaderboard.reset();
      });

      it("Split-over-Split position delta with Live Overtake Awareness (Option B) and 2+ splits behind backmarker accuracy", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        rc.setHostUsername("HostRunner");

        // 4 racers start at Split 0 (running Split 1): no splits completed -> all deltas 0 ('-')
        rc.handleRaceMessage([
          { userId: "r_a", username: "RunnerA", currentSplitIndex: 0, currentTime: 10000 },
          { userId: "r_b", username: "RunnerB", currentSplitIndex: 0, currentTime: 10000 },
          { userId: "r_c", username: "RunnerC", currentSplitIndex: 0, currentTime: 10000 },
          { userId: "r_d", username: "RunnerD", currentSplitIndex: 0, currentTime: 10000 }
        ]);
        let list = rc.getRankedEntrants();
        assert(list.every(r => r.positionDelta === 0 && r.positionDeltaDisplay === "-"), "All racers show '-' before Split 1 completion");

        // Complete Split 1 (checkpoint 0): establishes baseline Split 1 ranks:
        // P1: RunnerA (25s), P2: RunnerB (27s), P3: RunnerC (29s), P4: RunnerD (31s)
        rc.handleRaceMessage([
          { userId: "r_a", username: "RunnerA", currentSplitIndex: 1, currentTime: 25000, splitTimes: [25.0] },
          { userId: "r_b", username: "RunnerB", currentSplitIndex: 1, currentTime: 27000, splitTimes: [27.0] },
          { userId: "r_c", username: "RunnerC", currentSplitIndex: 1, currentTime: 29000, splitTimes: [29.0] },
          { userId: "r_d", username: "RunnerD", currentSplitIndex: 1, currentTime: 31000, splitTimes: [31.0] }
        ]);
        list = rc.getRankedEntrants();
        assert(list.every(r => r.positionDelta === 0 && r.positionDeltaDisplay === "-"), "All racers show '-' upon establishing Split 1 baseline");

        // Split 2 (checkpoint 1): RunnerC (was P3) splits FIRST at 52s!
        // RunnerA (was P1) and RunnerB (was P2) are still in Split 2 (currentSplitIndex = 1) -> overtaken live!
        rc.handleRaceMessage({
          userId: "r_c", username: "RunnerC", currentSplitIndex: 2, currentTime: 52000, splitTimes: [29.0, 52.0]
        });
        list = rc.getRankedEntrants();
        const cAfterSplit2 = list.find(r => r.userId === "r_c");
        const aMidSplit2 = list.find(r => r.userId === "r_a");
        const bMidSplit2 = list.find(r => r.userId === "r_b");
        const dMidSplit2 = list.find(r => r.userId === "r_d");

        assertEqual(cAfterSplit2.rank, 1, "RunnerC jumps to P1 upon completing Split 2 first");
        assertEqual(cAfterSplit2.positionDelta, 2, "RunnerC shows +2 (climbed from P3 at Split 1 to P1 at Split 2)");
        assertEqual(cAfterSplit2.positionDeltaDisplay, "+2", "RunnerC display is '+2'");

        assertEqual(aMidSplit2.rank, 2, "RunnerA drops to P2 while still in Split 2");
        assertEqual(aMidSplit2.positionDelta, -1, "Live Overtake Awareness: RunnerA immediately shows -1 when overtaken by RunnerC");
        assertEqual(bMidSplit2.rank, 3, "RunnerB drops to P3 while still in Split 2");
        assertEqual(bMidSplit2.positionDelta, -1, "Live Overtake Awareness: RunnerB immediately shows -1 when overtaken by RunnerC");
        assertEqual(dMidSplit2.rank, 4, "RunnerD remains P4");
        assertEqual(dMidSplit2.positionDelta, 0, "RunnerD was already P4 so delta remains 0");

        // Now RunnerA completes Split 2 in 55s (2nd at Split 2), while RunnerB & RunnerD stay behind in Split 2!
        rc.handleRaceMessage({
          userId: "r_a", username: "RunnerA", currentSplitIndex: 2, currentTime: 55000, splitTimes: [25.0, 55.0]
        });
        list = rc.getRankedEntrants();
        assertEqual(list.find(r => r.userId === "r_a").positionDelta, -1, "RunnerA maintains -1 upon completing Split 2 in P2");

        // Leaders (RunnerC and RunnerA) now complete Split 3 (checkpoint 2) and enter Split 4 (currentSplitIndex = 3),
        // putting them TWO SPLITS AHEAD of RunnerB and RunnerD (who are still stuck in Split 2, currentSplitIndex = 1)!
        // RunnerC holds P1 at Split 3 (80s), RunnerA holds P2 at Split 3 (83s).
        rc.handleRaceMessage([
          { userId: "r_c", username: "RunnerC", currentSplitIndex: 3, currentTime: 80000, splitTimes: [29.0, 52.0, 80.0] },
          { userId: "r_a", username: "RunnerA", currentSplitIndex: 3, currentTime: 83000, splitTimes: [25.0, 55.0, 83.0] }
        ]);
        list = rc.getRankedEntrants();
        assertEqual(list.find(r => r.userId === "r_c").positionDelta, 0, "RunnerC held P1 from Split 2 to Split 3 -> delta resets to 0 ('-')");
        assertEqual(list.find(r => r.userId === "r_a").positionDelta, 0, "RunnerA held P2 from Split 2 to Split 3 -> delta resets to 0 ('-')");

        // Meanwhile, 2 splits behind the leaders, RunnerD (was P4 at Split 1) completes Split 2 (at 85s) BEFORE RunnerB (was P2 at Split 1)!
        rc.handleRaceMessage({
          userId: "r_d", username: "RunnerD", currentSplitIndex: 2, currentTime: 85000, splitTimes: [31.0, 85.0]
        });
        list = rc.getRankedEntrants();
        const dBackmarker = list.find(r => r.userId === "r_d");
        const bBackmarker = list.find(r => r.userId === "r_b");

        assertEqual(dBackmarker.rank, 3, "RunnerD (2 splits behind leaders) climbs from P4 to P3 at Split 2");
        assertEqual(dBackmarker.positionDelta, 1, "Backmarker RunnerD shows +1 at Split 2 despite leaders being 2 splits ahead");
        assertEqual(bBackmarker.rank, 4, "RunnerB drops to P4 (overtaken by both RunnerC and RunnerD on Split 2)");
        assertEqual(bBackmarker.positionDelta, -2, "RunnerB shows -2 (dropped from P2 at Split 1 to P4)");

        // Finally RunnerB completes Split 2 at 90s in P4: delta remains -2
        rc.handleRaceMessage({
          userId: "r_b", username: "RunnerB", currentSplitIndex: 2, currentTime: 90000, splitTimes: [27.0, 90.0]
        });
        list = rc.getRankedEntrants();
        assertEqual(list.find(r => r.userId === "r_b").positionDelta, -2, "RunnerB maintains -2 after completing Split 2 in P4");
      });

      it("evaluates split flash types: gold, green, red deltas", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("flash_test_room");

        // 1. Gold split
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "FlashRunner",
            currentSplitIndex: 1,
            currentTime: 25000,
            isGold: true
          }
        });
        let entrants = rc.getRankedEntrants();
        let r = entrants.find(e => e.username === "FlashRunner");
        assertEqual(r.lastSplitEffect?.type, "gold", "Flash is gold when isGold is true");

        // 2. Green split (negative delta)
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "FlashRunner",
            currentSplitIndex: 2,
            currentTime: 50000,
            delta: -1500
          }
        });
        entrants = rc.getRankedEntrants();
        r = entrants.find(e => e.username === "FlashRunner");
        assertEqual(r.lastSplitEffect?.type, "green", "Flash is green when delta is negative");

        // 3. Red split (positive delta)
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "FlashRunner",
            currentSplitIndex: 3,
            currentTime: 80000,
            delta: 2500
          }
        });
        entrants = rc.getRankedEntrants();
        r = entrants.find(e => e.username === "FlashRunner");
        assertEqual(r.lastSplitEffect?.type, "red", "Flash is red when delta is positive");

        rc.disconnectFromRace();
      });

      it("handles dead-reckoning extrapolation and string delta formats", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("dead_reckon_room");

        // String delta ("+3.5") and streaming flag
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            user: "StreamerRacer",
            delta: "+3.5",
            liveData: {
              streaming: true,
              splitStartedAt: Date.now() - 4000,
              currentTime: 20000
            }
          }
        });

        let entrant = rc.getRankedEntrants().find(e => e.username === "StreamerRacer");
        assert(entrant !== null, "StreamerRacer exists");
        assertEqual(entrant.deltaSec, 3.5, "deltaSec parsed from string '+3.5'");
        assertEqual(entrant.isStreaming, true, "isStreaming flag captured");
        assert(entrant.currentTimeSec >= 20, "currentTimeSec computed including elapsed split duration");

        rc.disconnectFromRace();
      });
    });
})();
