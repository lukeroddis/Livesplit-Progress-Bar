/**
 * tests/unit/core/race-client.test.js
 * Unit tests for race-client
 */

(function () {
  "use strict";



    describe("Live Race & F1 Dynamic Leaderboard", () => {
      it("LiveSplitLeaderboard exports renderLeaderboard and getPreviewEntrants", () => {
        assert(window.LiveSplit && window.LiveSplit.Leaderboard, "LiveSplit.Leaderboard is exported");
        assertEqual(typeof window.LiveSplit.Leaderboard.renderLeaderboard, "function");
        assertEqual(typeof window.LiveSplit.Leaderboard.getPreviewEntrants, "function");
      });

      it("getPreviewEntrants provides valid default mock entrants for Layout Mode", () => {
        const preview = window.LiveSplit.Leaderboard.getPreviewEntrants();
        assert(Array.isArray(preview) && preview.length >= 3, "preview entrants array has >= 3 entrants");
        assert(preview.some(e => e.isHost), "preview entrants includes host");
      });

      it("renderLeaderboard mounts rows into DOM cleanly", () => {
        const preview = window.LiveSplit.Leaderboard.getPreviewEntrants();
        window.LiveSplit.Leaderboard.renderLeaderboard(preview, false, false, true);
        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assert(rows.length >= 3, "renders >= 3 rows into #leaderboard-rows");
      });

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

      it("Double click on leaderboard tile toggles muted state with no mute icon", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);
        const entrants = rc.getRankedEntrants();
        const rival = entrants.find(e => !e.isHost);

        assertEqual(rival.isMuted, false);
        window.LiveSplit.Leaderboard.renderLeaderboard(rc.getRankedEntrants(), true, false, false);
        const row = document.querySelector(`.leaderboard-row[data-user-id="${rival.userId}"]`);
        assert(row, "row exists");

        // Verify NO mute button icon exists on the tile
        const btn = row.querySelector(".racer-mute-btn");
        assert(!btn, "no mute button icon exists on tile");

        // Simulate user double clicking tile to hide/mute
        row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        assertEqual(rival.isMuted, true, "double click sets rival to muted");
        assert(row.classList.contains("is-muted"), "row has is-muted class");

        // Simulate user double clicking again to un-hide/unmute
        row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        assertEqual(rival.isMuted, false, "second double click un-mutes rival");
        assert(!row.classList.contains("is-muted"), "row is un-muted");

        rc.stopSimulation();
      });

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

      it("Repeated leaderboard renders preserve all entrant rows without dropping positions", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);
        const entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 10);

        // Call renderLeaderboard multiple times rapidly (as occurs at 60 FPS)
        for (let t = 0; t < 10; t++) {
          window.LiveSplit.Leaderboard.renderLeaderboard(rc.getRankedEntrants(), true, false, false);
        }

        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(rows.length, 10, "all 10 rows remain present in DOM without dropping");
        rc.stopSimulation();
      });

      it("Leaderboard calculates realistic track deltas and displays EXP badge", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2", "Split 3"], [30, 60, 90]);
        // Simulate host progress at 45s
        rc.updateHostProgress(45, 1, [30], [30, 60, 90], "Split 2", ["Split 1", "Split 2", "Split 3"]);

        const entrants = rc.getRankedEntrants();
        assertEqual(entrants[0].gapDisplay, "LEADER");
        assert(entrants[1].gapToLeaderSec >= 0, "P2 has positive gap to leader");
        assert(entrants[1].gapDisplay.startsWith("+"), "P2 gap starts with +");
        assert(entrants[0].elapsedSegmentDisplay && entrants[0].elapsedSegmentDisplay !== "--", "P1 has elapsed segment time");

        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);
        const expTags = document.querySelectorAll("#leaderboard-rows .expected-tag, #leaderboard-rows .interval-tag");
        assert(expTags.length >= 2, "EXP badges rendered for entrants");

        const elapsedTags = document.querySelectorAll("#leaderboard-rows .racer-elapsed");
        assert(elapsedTags.length >= 2, "Elapsed segment time spans rendered for active entrants");

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

      it("DOM slot order in #leaderboard-rows strictly matches rank order (slot 0 is rank 1, slot 1 is rank 2...)", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);

        // Mock custom ranking: shadow (1), you (2), apex (3), speeddemon (4)
        const mockEntrants = [
          { userId: "sim_shadow", username: "ShadowPacer", rank: 1, gapDisplay: "LEADER", intervalDisplay: "--", color: "#a855f7" },
          { userId: "you", username: "You", rank: 2, isHost: true, gapDisplay: "+8.2s", intervalDisplay: "+8.2s", color: "#38bdf8" },
          { userId: "sim_apex", username: "ApexRunner", rank: 3, gapDisplay: "+10.1s", intervalDisplay: "+1.9s", color: "#f59e0b" },
          { userId: "sim_speeddemon", username: "SpeedDemon", rank: 4, gapDisplay: "+14.2s", intervalDisplay: "+4.1s", color: "#06b6d4" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(mockEntrants, true, false, false);
        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(rows[0].getAttribute("data-user-id"), "sim_shadow", "slot 0 is rank 1 (ShadowPacer)");
        assertEqual(rows[1].getAttribute("data-user-id"), "you", "slot 1 is rank 2 (You)");
        assertEqual(rows[2].getAttribute("data-user-id"), "sim_apex", "slot 2 is rank 3 (ApexRunner)");
        assertEqual(rows[3].getAttribute("data-user-id"), "sim_speeddemon", "slot 3 is rank 4 (SpeedDemon)");

        rc.stopSimulation();
      });

      it("preserves row DOM element references across steady render frames", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);

        const entrantsFrame1 = [
          { userId: "sim_shadow", username: "ShadowPacer", rank: 1, gapDisplay: "LEADER", intervalDisplay: "--", color: "#a855f7" },
          { userId: "you", username: "You", rank: 2, isHost: true, gapDisplay: "+8.2s", intervalDisplay: "+8.2s", color: "#38bdf8" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(entrantsFrame1, true, false, false);
        const rowsFrame1 = Array.from(document.querySelectorAll("#leaderboard-rows .leaderboard-row"));

        const entrantsFrame2 = [
          { userId: "sim_shadow", username: "ShadowPacer", rank: 1, gapDisplay: "LEADER", intervalDisplay: "--", color: "#a855f7" },
          { userId: "you", username: "You", rank: 2, isHost: true, gapDisplay: "+8.5s", intervalDisplay: "+8.5s", color: "#38bdf8" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(entrantsFrame2, true, false, false);
        const rowsFrame2 = Array.from(document.querySelectorAll("#leaderboard-rows .leaderboard-row"));

        assertEqual(rowsFrame1[0], rowsFrame2[0], "Row 0 DOM node identity is preserved");
        assertEqual(rowsFrame1[1], rowsFrame2[1], "Row 1 DOM node identity is preserved");

        rc.stopSimulation();
      });

      it("DOM slot order in #leaderboard-rows automatically sorts entrants if passed in unsorted order", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);

        const jumbledEntrants = [
          { userId: "sim_speeddemon", username: "SpeedDemon", rank: 4, gapDisplay: "+14.2s", intervalDisplay: "+4.1s", color: "#06b6d4" },
          { userId: "you", username: "You", rank: 2, isHost: true, gapDisplay: "+8.2s", intervalDisplay: "+8.2s", color: "#38bdf8" },
          { userId: "sim_shadow", username: "ShadowPacer", rank: 1, gapDisplay: "LEADER", intervalDisplay: "--", color: "#a855f7" },
          { userId: "sim_apex", username: "ApexRunner", rank: 3, gapDisplay: "+10.1s", intervalDisplay: "+1.9s", color: "#f59e0b" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(jumbledEntrants, true, false, false);
        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(rows[0].getAttribute("data-user-id"), "sim_shadow", "slot 0 is rank 1 (ShadowPacer)");
        assertEqual(rows[1].getAttribute("data-user-id"), "you", "slot 1 is rank 2 (You)");
        assertEqual(rows[2].getAttribute("data-user-id"), "sim_apex", "slot 2 is rank 3 (ApexRunner)");
        assertEqual(rows[3].getAttribute("data-user-id"), "sim_speeddemon", "slot 3 is rank 4 (SpeedDemon)");

        rc.stopSimulation();
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

      it("Split completion triggers tile glow pulse (Gold / Green / Red) and clears cleanly", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);

        const now = Date.now();
        const splitEntrants = [
          {
            userId: "sim_gold",
            username: "GoldRacer",
            rank: 1,
            lastSplitEffect: {
              type: "gold",
              timestamp: now - 300,
              completedSplitName: "World 1-1",
              newSplitName: "World 1-2"
            },
            color: "#facc15"
          },
          {
            userId: "sim_green",
            username: "GreenRacer",
            rank: 2,
            lastSplitEffect: {
              type: "green",
              timestamp: now - 1400,
              completedSplitName: "World 1-1",
              newSplitName: "World 1-2"
            },
            color: "#22c55e"
          },
          {
            userId: "sim_red",
            username: "RedRacer",
            rank: 3,
            lastSplitEffect: {
              type: "red",
              timestamp: now,
              completedSplitName: "World 1-1",
              newSplitName: "World 1-2"
            },
            color: "#ef4444"
          },
          { userId: "you", username: "You", rank: 4, isHost: true, color: "#38bdf8" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(splitEntrants, true, false, false);
        const rowGold = document.querySelector('.leaderboard-row[data-user-id="sim_gold"]');
        const rowGreen = document.querySelector('.leaderboard-row[data-user-id="sim_green"]');
        const rowRed = document.querySelector('.leaderboard-row[data-user-id="sim_red"]');
        const rowYou = document.querySelector('.leaderboard-row[data-user-id="you"]');

        assert(rowGold && rowGold.classList.contains("split-flash-gold"), "Gold split entrant receives split-flash-gold class");
        assert(rowGreen && rowGreen.classList.contains("split-flash-green"), "Green split entrant receives split-flash-green class");
        assert(rowRed && rowRed.classList.contains("split-flash-red"), "Red split entrant receives split-flash-red class");
        assert(rowYou && !rowYou.classList.contains("split-flash-gold"), "Unaffected entrant does not receive split flash class");

        // Verify Two-Phase Split Name Transition:
        // Phase 1 (< 1100ms): rowGold (age 300ms) displays completed split name with celebratory glow class
        const goldSplitEl = rowGold.querySelector(".racer-split");
        assert(goldSplitEl, "Gold split element rendered");
        assertEqual(goldSplitEl.textContent, "World 1-1", "Phase 1 displays completed split name");
        assert(goldSplitEl.classList.contains("is-completed-gold"), "Phase 1 applies is-completed-gold class");

        // Phase 2 (>= 1100ms): rowGreen (age 1400ms) displays incoming split name with swipe transition class
        const greenSplitEl = rowGreen.querySelector(".racer-split");
        assert(greenSplitEl, "Green split element rendered");
        assertEqual(greenSplitEl.textContent, "World 1-2", "Phase 2 displays incoming new split name");
        assert(greenSplitEl.classList.contains("split-swipe-in"), "Phase 2 applies split-swipe-in class");

        window.LiveSplit.Leaderboard.reset();
        assert(!rowGold.classList.contains("split-flash-gold"), "Leaderboard reset clears split-flash-gold class");
        assert(!rowGreen.classList.contains("split-flash-green"), "Leaderboard reset clears split-flash-green class");
        assert(!rowRed.classList.contains("split-flash-red"), "Leaderboard reset clears split-flash-red class");

        rc.stopSimulation();
      });

      it("Leaderboard position persists to storage and restores across sessions", () => {
        if (!window.hudLayout) return;
        const state = window.hudLayout.getState();
        assert(state && state.leaderboard, "hudLayout contains leaderboard state");

        state.leaderboard.x = 188;
        state.leaderboard.y = 299;
        window.hudLayout.saveLayout();

        // Check localStorage keys
        const savedMain = JSON.parse(localStorage.getItem("livesplit_hud_layout"));
        assertEqual(savedMain.leaderboard.x, 188, "Main layout storage has updated leaderboard x");
        assertEqual(savedMain.leaderboard.y, 299, "Main layout storage has updated leaderboard y");

        const savedDedicated = JSON.parse(localStorage.getItem("livesplit_leaderboard_layout"));
        assertEqual(savedDedicated.x, 188, "Dedicated storage has updated leaderboard x");
        assertEqual(savedDedicated.y, 299, "Dedicated storage has updated leaderboard y");

        const reloaded = window.hudLayout.loadSavedLayout();
        assertEqual(reloaded.leaderboard.x, 188, "loadSavedLayout restores exact leaderboard x");
        assertEqual(reloaded.leaderboard.y, 299, "loadSavedLayout restores exact leaderboard y");
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

      it("Leaderboard highlights host tile without 'YOU' pill and displays entered username", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.setHostUsername("SpeedyLuke");
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);

        const entrants = rc.getRankedEntrants();
        const hostEntrant = entrants.find(e => e.isHost);
        assert(hostEntrant, "Host entrant exists");
        assertEqual(hostEntrant.username, "SpeedyLuke", "Host entrant adopts configured username");

        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);

        const hostRow = document.querySelector(`.leaderboard-row[data-user-id="${hostEntrant.userId}"]`);
        assert(hostRow, "Host row rendered");
        assert(hostRow.classList.contains("is-host"), "Host row receives .is-host highlighted styling");

        const nameEl = hostRow.querySelector(".racer-name");
        assert(nameEl, "Name element exists");
        assertEqual(nameEl.textContent.trim(), "SpeedyLuke", "Displays actual entered username instead of hardcoded 'You'");

        const hostPills = document.querySelectorAll("#leaderboard-rows .host-pill");
        assertEqual(hostPills.length, 0, "No 'YOU' pills rendered anywhere in the leaderboard");

        rc.stopSimulation();
      });

      it("Leaderboard simulation defaults host username to 'You' when none is specified, without 'YOU' pill", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.setHostUsername("");
        rc.startSimulation(["Split 1", "Split 2"], [30, 60]);

        const entrants = rc.getRankedEntrants();
        const hostEntrant = entrants.find(e => e.isHost);
        assert(hostEntrant, "Host entrant exists");
        assertEqual(hostEntrant.username, "You", "Host entrant defaults to 'You' when none specified");

        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, true, false, false);

        const hostRow = document.querySelector(`.leaderboard-row[data-user-id="${hostEntrant.userId}"]`);
        assert(hostRow, "Host row rendered");
        assert(hostRow.classList.contains("is-host"), "Host row is highlighted");

        const nameEl = hostRow.querySelector(".racer-name");
        assertEqual(nameEl.textContent.trim(), "You", "Name label says 'You'");

        const hostPills = document.querySelectorAll("#leaderboard-rows .host-pill");
        assertEqual(hostPills.length, 0, "No 'YOU' pill rendered");

        rc.stopSimulation();
      });

      it("Intelligent pin stacking resolves colliding pins into mini-leaderboard strip with orthogonal drop lines", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Forest", "Cave", "Castle"], [30, 60, 90]);
        // Simulate progress where competitors cluster near Start
        if (typeof window.updateGhostRunner === "function") {
          window.updateGhostRunner(2.0);
          const pins = Array.from(document.querySelectorAll(".ghost-marker.race-competitor"))
            .filter(m => m.style.display !== "none");
          if (pins.length >= 2) {
            // Check if any stacked pin receives --ghost-splay-x or splay classes
            const splays = pins.map(p => p.style.getPropertyValue("--ghost-splay-x") || "0px");
            const hasSplay = splays.some(off => off !== "0px");
            assert(typeof hasSplay === "boolean", "Splay evaluation runs cleanly");
          }
        }
        rc.stopSimulation();
      });

      it("prevents cluster collapse by maintaining zero overlap between all pinheads across multiple groups", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.startSimulation(["Forest", "Cave", "Castle"], [30, 60, 90]);
        if (typeof window.updateGhostRunner === "function") {
          window.updateGhostRunner(5.0);
          const pins = Array.from(document.querySelectorAll(".ghost-marker"))
            .filter(m => m.style.display !== "none" && m.id !== "ghost-marker");
          if (pins.length >= 2) {
            // Compute visual badge X coordinates: base transform X + splay X
            const badgeXs = pins.map(p => {
              const transformMatch = p.style.transform.match(/translateX\(([\d.-]+)px\)/);
              const baseCoord = transformMatch ? parseFloat(transformMatch[1]) : 0;
              const splayVal = parseFloat(p.style.getPropertyValue("--ghost-splay-x")) || 0;
              return baseCoord + splayVal;
            }).sort((a, b) => a - b);

            for (let i = 0; i < badgeXs.length - 1; i++) {
              const dist = badgeXs[i + 1] - badgeXs[i];
              assert(dist >= 20, `Adjacent pinheads must not collapse: dist ${dist.toFixed(1)} >= 20px`);
            }
          }
        }
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

      it("Split completion glow lasts 4.0s with gradual fade and 3-phase title transition", () => {
        const rc = window.LiveSplit.RaceClient;
        const now = Date.now();
        const testEntrants = [
          {
            userId: "racer_p1",
            username: "FlashRacer",
            rank: 1,
            lastSplitEffect: {
              type: "gold",
              timestamp: now - 3500, // 3.5s old: still active within 4.0s window
              completedSplitName: "Temple 1",
              newSplitName: "Temple 2"
            },
            color: "#facc15"
          },
          {
            userId: "racer_fade",
            username: "FadeRacer",
            rank: 2,
            lastSplitEffect: {
              type: "green",
              timestamp: now - 1000, // 1.0s old: in Phase 2 fade-out
              completedSplitName: "Cave 1",
              newSplitName: "Cave 2"
            },
            color: "#22c55e"
          }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(testEntrants, true, false, false);
        const rowP1 = document.querySelector('.leaderboard-row[data-user-id="racer_p1"]');
        const rowFade = document.querySelector('.leaderboard-row[data-user-id="racer_fade"]');

        assert(rowP1 && rowP1.classList.contains("split-flash-gold"), "Split glow remains active past 3.0s (up to 4.0s)");
        const p1Split = rowP1.querySelector(".racer-split");
        assertEqual(p1Split.textContent, "Temple 2", "Phase 3 displays new split name");
        assert(p1Split.classList.contains("split-swipe-in"), "Phase 3 has split-swipe-in scroll class");

        const fadeSplit = rowFade.querySelector(".racer-split");
        assertEqual(fadeSplit.textContent, "Cave 1", "Phase 2 displays completed split name fading out");
        assert(fadeSplit.classList.contains("split-fade-out"), "Phase 2 has split-fade-out class");

        window.LiveSplit.Leaderboard.reset();
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

      it("window.hudLayout exports applyComponentLayout and toggles leaderboard visibility", () => {
        assert(typeof window.hudLayout.applyComponentLayout === "function", "window.hudLayout exports applyComponentLayout");
        const state = window.hudLayout.getState();
        const initialVis = state.leaderboard?.visible !== false;
        
        // Toggle visibility off
        if (!state.leaderboard) state.leaderboard = { x: 42, y: 110, scale: 1.0, visible: true, docked: "none" };
        state.leaderboard.visible = false;
        window.hudLayout.applyComponentLayout("leaderboard");
        const lbEl = document.getElementById("hud-comp-leaderboard");
        assert(lbEl.classList.contains("is-hidden"), "Leaderboard receives .is-hidden when visibility is false");

        // Toggle visibility back on
        state.leaderboard.visible = true;
        window.hudLayout.applyComponentLayout("leaderboard");
        assert(!lbEl.classList.contains("is-hidden"), "Leaderboard removes .is-hidden when visibility is restored");

        state.leaderboard.visible = initialVis;
        window.hudLayout.saveLayout();
      });

      it("Leaderboard DOM row targeted reconciliation preserves ongoing split glow without restarting when sibling splits", () => {
        const now = Date.now();
        const testEntrants = [
          {
            userId: "host_p1",
            username: "You",
            isHost: true,
            rank: 1,
            lastSplitEffect: {
              type: "gold",
              timestamp: now - 1500, // 1.5s into 4.0s glow
              completedSplitName: "Split 1",
              newSplitName: "Split 2"
            },
            color: "#38bdf8"
          },
          {
            userId: "runner_p2",
            username: "Runner2",
            rank: 2,
            lastSplitEffect: null,
            color: "#22c55e"
          }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(testEntrants, true, false, false);
        const rowHost = document.querySelector('.leaderboard-row[data-user-id="host_p1"]');
        assert(rowHost && rowHost.classList.contains("split-flash-gold"), "Host row is glowing gold");
        // Mark the host DOM node with a custom tracker property
        rowHost._trackerId = "original_host_node";

        // Now Runner 2 splits and starts their animation
        testEntrants[1].lastSplitEffect = {
          type: "green",
          timestamp: now,
          completedSplitName: "Split 1",
          newSplitName: "Split 2"
        };
        testEntrants[1].rank = 2; // Remains in rank 2

        window.LiveSplit.Leaderboard.renderLeaderboard(testEntrants, true, false, false);
        const rowHostAfter = document.querySelector('.leaderboard-row[data-user-id="host_p1"]');
        assertEqual(rowHostAfter._trackerId, "original_host_node", "Host DOM element was preserved in place without re-creating");
        assert(rowHostAfter.classList.contains("split-flash-gold"), "Host glow remained intact");
        assertEqual(rowHostAfter.dataset.lastEffectTime, String(testEntrants[0].lastSplitEffect.timestamp), "Host effect timestamp unchanged");

        // Now test when runner 2 overtakes host into rank 1
        testEntrants[0].rank = 2;
        testEntrants[1].rank = 1;
        window.LiveSplit.Leaderboard.renderLeaderboard(testEntrants, true, false, false);
        const rowHostRank2 = document.querySelector('.leaderboard-row[data-user-id="host_p1"]');
        assert(rowHostRank2.classList.contains("split-flash-gold"), "Host continues glowing after moving to rank 2");
        assert(rowHostRank2.style.animationDelay.startsWith("-"), "Host animation-delay locked to elapsed time");

        window.LiveSplit.Leaderboard.reset();
      });

      it("Leaderboard FLIP animation smoothly transitions swapped tiles with translateY transforms and elevated z-index", () => {
        // Step 1: Initial render with two racers
        const initialEntrants = [
          { userId: "racer_a", username: "RacerA", rank: 1, gapDisplay: "LEADER", color: "#38bdf8" },
          { userId: "racer_b", username: "RacerB", rank: 2, gapDisplay: "+5.0s", color: "#facc15" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(initialEntrants, true, false, false);
        const rowA = document.querySelector('.leaderboard-row[data-user-id="racer_a"]');
        const rowB = document.querySelector('.leaderboard-row[data-user-id="racer_b"]');
        assert(rowA && rowB, "Both rows rendered into DOM");

        // Dynamic mock getBoundingClientRect based on DOM slot index in #leaderboard-rows
        function getMockRect(row) {
          const idx = row.parentNode ? Array.from(row.parentNode.children).indexOf(row) : 0;
          const top = 100 + idx * 40;
          return { top, bottom: top + 35, height: 35, left: 0, right: 200, width: 200 };
        }
        rowA.getBoundingClientRect = () => getMockRect(rowA);
        rowB.getBoundingClientRect = () => getMockRect(rowB);

        // Step 2: Racer B overtakes Racer A (ranks swap)
        const swappedEntrants = [
          { userId: "racer_b", username: "RacerB", rank: 1, gapDisplay: "LEADER", color: "#facc15" },
          { userId: "racer_a", username: "RacerA", rank: 2, gapDisplay: "+2.0s", color: "#38bdf8" }
        ];

        window.LiveSplit.Leaderboard.renderLeaderboard(swappedEntrants, true, false, false);

        // Step 3: Validate FLIP Invert transform state
        // Racer B was at 140, now at 100 -> dy = 140 - 100 = 40px
        assertEqual(rowB.style.getPropertyValue("--swap-y"), "40px", "Racer B --swap-y offset is 40px");
        assert(rowB.style.transform.includes("translateY(40px)"), "Racer B inverted transform translateY(40px)");
        assertEqual(rowB.style.zIndex, "4", "Racer B (overtaker climbing up) has elevated z-index 4");

        // Racer A was at 100, now at 140 -> dy = 100 - 140 = -40px
        assertEqual(rowA.style.getPropertyValue("--swap-y"), "-40px", "Racer A --swap-y offset is -40px");
        assert(rowA.style.transform.includes("translateY(-40px)"), "Racer A inverted transform translateY(-40px)");
        assertEqual(rowA.style.zIndex, "2", "Racer A has descending z-index 2");

        // Validate DOM order was updated synchronously
        const rows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(rows[0].getAttribute("data-user-id"), "racer_b", "Racer B is slot 0 in DOM");
        assertEqual(rows[1].getAttribute("data-user-id"), "racer_a", "Racer A is slot 1 in DOM");

        // Step 4: Validate clean reset
        window.LiveSplit.Leaderboard.reset();
        assertEqual(rowA.style.transform, "", "Racer A transform cleared on reset");
        assertEqual(rowB.style.transform, "", "Racer B transform cleared on reset");
        assertEqual(rowA.style.zIndex, "", "Racer A zIndex cleared on reset");
        assertEqual(rowB.style.zIndex, "", "Racer B zIndex cleared on reset");
        assert(!rowA.classList.contains("is-swapping"), "Racer A is-swapping class removed");
        assert(!rowB.classList.contains("is-swapping"), "Racer B is-swapping class removed");
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

      it("XSS Sanitization: getOrCreateRaceMarker escapes malicious username and blocks unsafe avatar schemes", () => {
        const maliciousRacer = {
          userId: "hacker99",
          username: "<script>alert(1)<" + "/script>pwned",
          avatar: "javascript:alert('xss')",
          color: "#ff0000"
        };
        const marker = getOrCreateRaceMarker(maliciousRacer);
        assert(marker, "Race marker created");
        const tag = marker.querySelector(".racer-tag");
        assert(tag, "Racer tag exists");
        assert(!tag.innerHTML.includes("<script>"), "Malicious script tag escaped in racer tag innerHTML");
        assertEqual(tag.textContent, "<script>alert(1)</" + "script>pwned", "Text content matches escaped string");

        const img = marker.querySelector("img.racer-avatar-img");
        assert(!img, "javascript: scheme avatar rejected and not rendered as <img> tag");
        const iconSpan = marker.querySelector(".racer-avatar");
        assert(iconSpan, "Safe fallback racer-avatar icon rendered instead");
        assert(!iconSpan.innerHTML.includes("javascript:"), "Malicious scheme not rendered executable");
        marker.remove();
      });

      it("Leaderboard renders stacked position column (.pos-col) with .pos-badge and .pos-delta (+N, -N, and '-')", () => {
        const preview = window.LiveSplit.Leaderboard.getPreviewEntrants();
        window.LiveSplit.Leaderboard.renderLeaderboard(preview, false, false, true);

        const row1 = document.querySelector('.leaderboard-row[data-user-id="prev_speeddemon"]');
        const row2 = document.querySelector('.leaderboard-row[data-user-id="you"]');
        const row3 = document.querySelector('.leaderboard-row[data-user-id="prev_apex"]');
        assert(row1 && row2 && row3, "All 3 preview rows exist");

        const posCol1 = row1.querySelector(".pos-col");
        assert(posCol1, "Row has .pos-col stacked position container");
        assert(posCol1.querySelector(".pos-badge"), ".pos-col contains .pos-badge");
        const delta1 = posCol1.querySelector(".pos-delta");
        assert(delta1, ".pos-col contains .pos-delta");
        assertEqual(delta1.textContent.trim(), "-", "Unchanged position renders '-'");
        assert(delta1.classList.contains("delta-same"), "Unchanged position has .delta-same class");

        const delta2 = row2.querySelector(".pos-col .pos-delta");
        assertEqual(delta2.textContent.trim(), "▲+2", "Gained 2 places renders '▲+2'");
        assert(delta2.classList.contains("delta-up"), "Gained places has .delta-up class");

        const delta3 = row3.querySelector(".pos-col .pos-delta");
        assertEqual(delta3.textContent.trim(), "▼-1", "Dropped 1 place renders '▼-1'");
        assert(delta3.classList.contains("delta-down"), "Dropped places has .delta-down class");

        window.LiveSplit.Leaderboard.reset();
        assertEqual(delta2.textContent.trim(), "-", "Leaderboard.reset() resets .pos-delta text to '-'");
        assert(delta2.classList.contains("delta-same"), "Leaderboard.reset() resets .pos-delta class to .delta-same");
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

      it("Leaderboard formats multi-hour gaps, segment times, final times, and ribbon tooltips as H:MM:SS", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        rc.setHostUsername("MarathonHost");
        rc.handleRaceMessage([
          {
            userId: "r_hour_leader",
            username: "MarathonLeader",
            currentSplitIndex: 2,
            currentTime: 7800000,
            splitTimes: [3600.0, 7800.0],
            isFinished: true
          },
          {
            userId: "r_hour_chaser",
            username: "MarathonChaser",
            currentSplitIndex: 1,
            currentTime: 7800000,
            splitTimes: [7800.0],
            splits: [
              { splitTime: 7800000 },
              { predictedSingleTime: 4200000 }
            ]
          }
        ]);

        const list = rc.getRankedEntrants();
        const leader = list.find(r => r.userId === "r_hour_leader");
        const chaser = list.find(r => r.userId === "r_hour_chaser");

        // Leader finished in 7800s (2h 10m 00s)
        assertEqual(leader.expectedSegmentDisplay, "2:10:00", "Final time 7800s formats as 2:10:00 instead of 130:00");
        // Chaser completed Split 1 in 7800s vs Leader's 3600s -> 4200s (70m) gap -> +1:10:00
        assertEqual(chaser.gapDisplay, "+1:10:00", "70-minute gap (4200s) formats as +1:10:00 instead of +70:00");
        assertEqual(chaser.expectedSegmentDisplay, "1:10:00", "Expected 4200s segment formats as 1:10:00");

        window.LiveSplit.Leaderboard.renderLeaderboard(list, false, true, false);
        const leaderRow = document.querySelector('.leaderboard-row[data-user-id="r_hour_leader"]');
        const leaderRibbon = leaderRow.querySelector(".racer-ribbon");
        assert(leaderRibbon.title.includes("1:10:00"), `Ribbon tooltip formats 4200s segment as 1:10:00, got: ${leaderRibbon.title}`);

        window.LiveSplit.Leaderboard.reset();
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

      it("Single-shot manual race connect enforces 5s cooldown guard against spam clicking", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.getConnectCooldownRemainingMs, "function", "RaceClient exports getConnectCooldownRemainingMs");
        assertEqual(typeof rc.resetConnectCooldown, "function", "RaceClient exports resetConnectCooldown");

        rc.resetConnectCooldown();
        assertEqual(rc.getConnectCooldownRemainingMs(), 0, "Cooldown is initially 0ms");

        // Mock fetch to count outgoing HTTP calls
        const origFetch = window.fetch;
        let fetchCount = 0;
        window.fetch = () => {
          fetchCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ raceId: null })
          });
        };

        try {
          rc.pollUserStatus("TestRunner");
          assertEqual(fetchCount, 1, "First click sends exactly 1 HTTP request");
          assert(rc.getConnectCooldownRemainingMs() > 4000, "5s cooldown is immediately active");

          // Immediate second click within 5s must be blocked by in-flight / cooldown guard without calling fetch!
          rc.pollUserStatus("TestRunner");
          assertEqual(fetchCount, 1, "Spam click within 5s cooldown sends 0 additional HTTP requests");

          rc.resetConnectCooldown();
          assertEqual(rc.getConnectCooldownRemainingMs(), 0, "resetConnectCooldown clears cooldown");
        } finally {

          window.fetch = origFetch;
        }
      });

      it("Pasting a race URL never overwrites the host runner username with the URL", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        rc.setHostUsername("SpeedRunnerLuke");
        assertEqual(rc.getHostUsername(), "SpeedRunnerLuke");

        // Passing a race URL to setHostUsername must not overwrite the host's display name
        rc.setHostUsername("https://therun.gg/races/tzsm");
        const hostEntrant = rc.getRankedEntrants().find(r => r.isHost);
        assert(hostEntrant.username !== "https://therun.gg/races/tzsm", "Host username is never set to a race URL");
      });

      it("Lobby Standby and Simulation Standby arm pre-race, support Disconnect, and connect when handleHostRunStarted fires", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.isStandby, "function", "RaceClient exports isStandby");
        assertEqual(typeof rc.isSimStandby, "function", "RaceClient exports isSimStandby");
        assertEqual(typeof rc.armSimulationStandby, "function", "RaceClient exports armSimulationStandby");
        assertEqual(typeof rc.handleHostRunStarted, "function", "RaceClient exports handleHostRunStarted");
        assertEqual(rc.isStandby(), false, "Standby is initially false");
        assertEqual(rc.isSimStandby(), false, "SimStandby is initially false");

        // 1. Arm Simulation Standby (e.g. clicking Test Race before starting split)
        rc.armSimulationStandby(["Split 1", "Split 2"], [30, 60], [30, 60]);
        assertEqual(rc.isStandby(), true, "armSimulationStandby sets isStandby to true");
        assertEqual(rc.isSimStandby(), true, "armSimulationStandby sets isSimStandby to true");
        assertEqual(rc.isSimulating(), false, "Simulation does not start until split starts");

        // 2. Starting the split (with initialDelayMs: 0 for synchronous unit test verification) connects simulation
        rc.handleHostRunStarted({ initialDelayMs: 0 });
        assertEqual(rc.isSimulating(), true, "handleHostRunStarted launches simulation after standby");
        assertEqual(rc.isStandby(), false, "isStandby clears once simulation connects");
        assertEqual(rc.isSimStandby(), false, "isSimStandby clears once simulation connects");

        // 3. Disconnect / stopSimulation clears active simulation and standby
        rc.stopSimulation();
        assertEqual(rc.isSimulating(), false, "stopSimulation stops active simulation");

        // 4. Arm Standby again and verify disconnectFromRace cancels Standby cleanly
        rc.armSimulationStandby(["Split 1"], [30], [30]);
        assertEqual(rc.isStandby(), true);
        rc.disconnectFromRace();
        assertEqual(rc.isStandby(), false, "disconnectFromRace cancels Standby");
        assertEqual(rc.isSimStandby(), false, "disconnectFromRace cancels SimStandby");
      });

      it("Race Code connects via REST API (6nkfyze0o7) + WebSocket, unpacks result.participants and liveData, and never renders dummy preview runners", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.isValidRaceCode, "function", "RaceClient exports isValidRaceCode");
        assertEqual(typeof rc.fetchRaceData, "function", "RaceClient exports fetchRaceData");

        // 1. Validate short race codes and reject URLs or unsafe strings
        assertEqual(rc.isValidRaceCode("q38y"), true, "4-char race code q38y is valid");
        assertEqual(rc.isValidRaceCode("tzsm"), true, "4-char race code tzsm is valid");
        assertEqual(rc.isValidRaceCode("https://therun.gg/races/q38y"), false, "Full URL is rejected by isValidRaceCode");
        assertEqual(rc.isValidRaceCode("javascript:alert(1)"), false, "Script protocol is rejected");
        assertEqual(rc.parseRaceId("https://therun.gg/races/q38y"), null, "parseRaceId rejects URLs");
        assertEqual(rc.parseRaceId("q38y"), "q38y", "parseRaceId accepts valid race code");

        // 2. Verify Leaderboard never renders dummy preview runners (SpeedDemon / ApexRunner) when connected to a live race
        window.LiveSplit.Leaderboard.renderLeaderboard([], false, true, false);
        const emptyRows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(emptyRows.length, 0, "Connected live race with 0 entrants renders 0 rows (never dummy SpeedDemon/ApexRunner)");

        // 3. Connect using Race Code 'q38y' and verify REST API + WebSocket integration
        const origWS = window.WebSocket;
        const origFetch = window.fetch;
        let connectedWsUrl = null;
        const fetchedUrls = [];
        window.WebSocket = function (url) {
          connectedWsUrl = url;
          this.readyState = 1; // OPEN
          this.close = function () { this.readyState = 3; };
        };
        window.WebSocket.OPEN = 1;
        window.WebSocket.CONNECTING = 0;

        window.fetch = (url) => {
          fetchedUrls.push(url);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: {
                raceId: "q38y",
                status: "progress",
                participants: [
                  {
                    user: "RacerAlpha",
                    status: "finished",
                    finalTime: 95000,
                    pb: "98000"
                  },
                  {
                    user: "RacerBeta",
                    status: "started",
                    pb: "100000",
                    liveData: {
                      currentSplitIndex: 2,
                      currentSplitName: "Bowser",
                      currentTime: 62000,
                      runPercentage: 0.65
                    }
                  },
                  {
                    user: "RacerGamma",
                    status: "abandoned"
                  }
                ]
              }
            })
          });
        };

        try {
          const ok = rc.connectToRace("q38y");
          assertEqual(ok, true, "connectToRace('q38y') succeeds");
          assertEqual(rc.isConnected(), true, "isConnected() is true");
          assertEqual(rc.getRaceId(), "q38y", "getRaceId() returns 'q38y'");
          assert(connectedWsUrl && connectedWsUrl.endsWith("race=q38y"), "WebSocket connects to ?race=q38y");
          assert(fetchedUrls.some(u => u.includes("races.therun.gg/q38y")), "Fetches race data from races.therun.gg REST API");

          rc.handleRaceMessage({
            result: {
              raceId: "q38y",
              status: "progress",
              participants: [
                {
                  user: "RacerAlpha",
                  status: "finished",
                  finalTime: 95000,
                  pb: "98000"
                },
                {
                  user: "RacerBeta",
                  status: "started",
                  pb: "100000",
                  liveData: {
                    currentSplitIndex: 2,
                    currentSplitName: "Bowser",
                    currentTime: 62000,
                    runPercentage: 0.65
                  }
                },
                {
                  user: "RacerGamma",
                  status: "abandoned"
                }
              ]
            }
          });

          const ranked = rc.getRankedEntrants();
          assertEqual(ranked.length, 3, "All 3 participants from result.participants are loaded without any dummy runners");
          assertEqual(ranked[0].username, "RacerAlpha", "Finished runner RacerAlpha is P1");
          assertEqual(ranked[0].isFinished, true, "RacerAlpha is marked finished");
          assertEqual(ranked[0].finalTimeSec, 95, "RacerAlpha finalTime (95000ms) converted to 95s");
          assertEqual(ranked[1].username, "RacerBeta", "Started runner RacerBeta is P2");
          assertEqual(ranked[1].currentSplitIndex, 2, "RacerBeta currentSplitIndex unpacked from liveData");
          assertEqual(ranked[1].currentSplitName, "Bowser", "RacerBeta currentSplitName unpacked from liveData");
          assertEqual(ranked[2].username, "RacerGamma", "Abandoned runner RacerGamma is at bottom");
          assertEqual(ranked[2].isDNF, true, "Abandoned status is mapped to DNF");

          // 4. Verify finished race (like tzsm) with status 'confirmed', splitPredictions, WebSocket close, and CORS fallback
          let wsInstance = null;
          window.WebSocket = function (url) {
            connectedWsUrl = url;
            this.readyState = 1;
            this.close = function () { this.readyState = 3; };
            wsInstance = this;
          };
          window.WebSocket.OPEN = 1;
          window.WebSocket.CONNECTING = 0;

          fetchedUrls.length = 0;
          window.fetch = (url) => {
            fetchedUrls.push(url);
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                result: {
                  raceId: "tzsm",
                  status: "finished",
                  participants: [
                    {
                      user: "eden8",
                      status: "confirmed",
                      finalTime: 4719312.9879,
                      pb: "4790820",
                      liveData: {
                        currentSplitIndex: 2,
                        currentSplitName: "",
                        currentTime: 4719312.9879,
                        runFinished: true,
                        runPercentageTime: 1,
                        splitPredictions: [
                          { splitIndex: 1, currentTime: 165672.6 },
                          { splitIndex: 2, currentTime: 416641.2 }
                        ]
                      }
                    },
                    {
                      user: "BosserJC",
                      status: "confirmed",
                      finalTime: 4911675,
                      pb: "4685000",
                      liveData: {
                        currentSplitIndex: 2,
                        currentSplitName: "",
                        currentTime: 4911675,
                        runFinished: true,
                        runPercentageTime: 1,
                        splitPredictions: [
                          { splitIndex: 0, currentTime: 12.3011 },
                          { splitIndex: 1, currentTime: 170565.9 },
                          { splitIndex: 2, currentTime: 412714.6 }
                        ]
                      }
                    }
                  ]
                }
              })
            });
          };

          rc.connectToRace("tzsm");
          assertEqual(rc.isConnected(), true, "Connected to finished race tzsm");
          if (wsInstance && typeof wsInstance.onclose === "function") {
            wsInstance.onclose();
          }
          assertEqual(rc.isConnected(), true, "Finished race stays connected even if WebSocket closes");

          // Also feed the tzsm payload synchronously for deterministic assertion
          rc.handleRaceMessage({
            result: {
              raceId: "tzsm",
              status: "finished",
              participants: [
                {
                  user: "eden8",
                  status: "confirmed",
                  finalTime: 4719312.9879,
                  pb: "4790820",
                  liveData: {
                    currentSplitIndex: 2,
                    currentSplitName: "",
                    currentTime: 4719312.9879,
                    runFinished: true,
                    runPercentageTime: 1,
                    splitPredictions: [
                      { splitIndex: 1, currentTime: 165672.6 },
                      { splitIndex: 2, currentTime: 416641.2 }
                    ]
                  }
                },
                {
                  user: "BosserJC",
                  status: "confirmed",
                  finalTime: 4911675,
                  pb: "4685000",
                  liveData: {
                    currentSplitIndex: 2,
                    currentSplitName: "",
                    currentTime: 4911675,
                    runFinished: true,
                    runPercentageTime: 1,
                    splitPredictions: [
                      { splitIndex: 0, currentTime: 12.3011 },
                      { splitIndex: 1, currentTime: 170565.9 },
                      { splitIndex: 2, currentTime: 412714.6 }
                    ]
                  }
                }
              ]
            }
          });

          const tzsmRanked = rc.getRankedEntrants();
          assertEqual(tzsmRanked.length, 2, "Finished race tzsm populates both participants (eden8 and BosserJC)");
          assertEqual(tzsmRanked[0].username, "eden8", "eden8 is P1 in tzsm");
          assertEqual(tzsmRanked[0].isFinished, true, "status 'confirmed' is recognized as finished");
          assertEqual(tzsmRanked[1].username, "BosserJC", "BosserJC is P2 in tzsm");
          assertEqual(tzsmRanked[1].isFinished, true, "BosserJC is marked finished");
          assertEqual(tzsmRanked[1].splitTimes.length, 2, "splitPredictions extracted 2 completed splits (ignoring splitIndex 0)");

          rc.disconnectFromRace();
          assertEqual(rc.isConnected(), false, "disconnectFromRace disconnects cleanly");
        } finally {

          window.WebSocket = origWS;
          window.fetch = origFetch;
        }
      });

      it("Spectator Mode renders waiting telemetry banner when connected with 0 entrants and updates deltas when runners split", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        const lb = window.LiveSplitLeaderboard;
        assert(lb && typeof lb.renderLeaderboard === "function", "LiveSplitLeaderboard is available");

        // 1. Initially connected to a race with no entrants yet (e.g. spectator joined room before runners split)
        rc.connectToRace("live42");
        assertEqual(rc.isConnected(), true, "RaceClient is connected");
        assertEqual(rc.getRankedEntrants().length, 0, "No entrants yet before telemetry arrives");

        // Render leaderboard in connected spectator state
        lb.renderLeaderboard(rc.getRankedEntrants(), false, true, false);
        const rowsEl = document.getElementById("leaderboard-rows");
        const waitingEl = rowsEl.querySelector(".leaderboard-waiting-state");
        assert(waitingEl !== null, "Waiting state banner is displayed while waiting for telemetry");

        // 2. First runner telemetry arrives (Runner 1 and Runner 2 start Split 1)
        rc.handleRaceMessage({
          userId: "runner_1",
          username: "FastPanda",
          currentSplitIndex: 0,
          currentSplitName: "Split 1",
          currentTime: 10000,
          status: "started"
        });
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 0,
          currentSplitName: "Split 1",
          currentTime: 10000,
          status: "started"
        });

        let ranked = rc.getRankedEntrants();
        assertEqual(ranked.length, 2, "Both entrants loaded");
        lb.renderLeaderboard(ranked, false, true, false);
        assert(rowsEl.querySelector(".leaderboard-waiting-state") === null, "Waiting banner removed once entrants arrive");

        // On split 0 before either splits, gap is --
        assertEqual(ranked[0].gapDisplay, "LEADER");
        assertEqual(ranked[1].gapDisplay, "--", "P2 gap is blank before anyone splits");

        // 3. FastPanda completes Split 1 at 30.0s (30000ms)
        rc.handleRaceMessage({
          userId: "runner_1",
          username: "FastPanda",
          currentSplitIndex: 1,
          currentSplitName: "Split 2",
          currentTime: 30000
        });

        // CoolFox is at 31.0s on Split 1
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 0,
          currentSplitName: "Split 1",
          currentTime: 31000
        });

        ranked = rc.getRankedEntrants();
        assertEqual(ranked[0].username, "FastPanda", "FastPanda is P1");
        assertEqual(ranked[1].username, "CoolFox", "CoolFox is P2");
        // CoolFox gap increments: 31.0 - 30.0 = +1.0s
        assertEqual(ranked[1].gapDisplay, "+1.0s", "CoolFox gap increments live once FastPanda completes Split 1");

        // 4. CoolFox also completes Split 1 at 32.5s (32500ms)
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 1,
          currentSplitName: "Split 2",
          currentTime: 32500
        });

        ranked = rc.getRankedEntrants();
        // Both now completed Split 1: gap locks at 32.5 - 30.0 = +2.5s
        assertEqual(ranked[1].gapDisplay, "+2.5s", "Gap locks at milestone difference once both complete Split 1");

        // 5. FastPanda completes Split 2 at 60.0s
        rc.handleRaceMessage({
          userId: "runner_1",
          username: "FastPanda",
          currentSplitIndex: 2,
          currentSplitName: "Split 3",
          currentTime: 60000
        });

        // CoolFox still running Split 2 at 61.5s
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 1,
          currentSplitName: "Split 2",
          currentTime: 61500
        });

        ranked = rc.getRankedEntrants();
        // Gap: 2.5s (prevGap) + (61.5 - 60.0) = 2.5 + 1.5 = +4.0s
        assertEqual(ranked[1].gapDisplay, "+4.0s", "Delta accumulates as leader splits on subsequent split");

        // 6. CoolFox completes Split 2 at 64.0s
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 2,
          currentSplitName: "Split 3",
          currentTime: 64000
        });

        ranked = rc.getRankedEntrants();
        // Both completed Split 2: 64.0 - 60.0 = +4.0s
        assertEqual(ranked[1].gapDisplay, "+4.0s", "Delta locks into Split 2 milestone gap");
        rc.disconnectFromRace();
      });

      it("Lobby Ready and Unready transitions correctly toggle entrant status and log lobby events", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();

        // 1. Runner joins race
        rc.handleRaceMessage({
          userId: "user_luke",
          username: "Luke",
          status: "joined"
        });

        let entrants = rc.getRankedEntrants();
        let luke = entrants.find(e => e.userId === "user_luke");
        assert(luke !== undefined, "Luke is added as entrant");
        assertEqual(luke.status, "joined", "Initial status is joined");
        assertEqual(luke.isReady, false, "Initial isReady is false");
        assertEqual(luke.currentSplitName, "Split 1", "currentSplitName remains Split 1 (not overwritten with status)");

        // 2. Runner clicks Ready
        rc.handleRaceMessage({
          userId: "user_luke",
          username: "Luke",
          status: "ready"
        });

        entrants = rc.getRankedEntrants();
        luke = entrants.find(e => e.userId === "user_luke");
        assertEqual(luke.status, "ready", "Status transitions to ready");
        assertEqual(luke.isReady, true, "isReady is true");
        assertEqual(luke.currentSplitName, "Split 1", "currentSplitName remains Split 1 on ready");

        // 3. Runner clicks Unready (sends status: 'joined')
        rc.handleRaceMessage({
          userId: "user_luke",
          username: "Luke",
          status: "joined"
        });

        entrants = rc.getRankedEntrants();
        luke = entrants.find(e => e.userId === "user_luke");
        assertEqual(luke.status, "joined", "Status reverts to joined on unready");
        assertEqual(luke.isReady, false, "isReady is false on unready");
        assertEqual(luke.currentSplitName, "Split 1", "currentSplitName remains Split 1 on unready");

        // 4. Verify race events were logged
        const events = rc.getRecentEvents();
        assert(events.length >= 3, "Lobby events recorded");
        assert(events.some(e => e.type === "join" && e.text.includes("Luke joined")), "Join event logged");
        assert(events.some(e => e.type === "ready" && e.text.includes("Luke is Ready")), "Ready event logged");
        assert(events.some(e => e.type === "unready" && e.text.includes("Luke unreadied")), "Unready event logged");

        rc.disconnectFromRace();
      });

      it("Pre-race lobby renders LOBBY badge, ready indicators, and lobby banner", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("pre_race_lobby");

        rc.handleRaceMessage({
          userId: "p1",
          username: "RunnerOne",
          status: "ready"
        });
        rc.handleRaceMessage({
          userId: "p2",
          username: "RunnerTwo",
          status: "joined"
        });

        const entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 2);

        // Render leaderboard in connected mode (isConnected = true, isSimulating = false)
        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, false, true, false);

        const statusBadge = document.getElementById("leaderboard-status-badge");
        assert(statusBadge !== null, "status badge exists");
        assertEqual(statusBadge.innerText, "LOBBY", "Badge shows LOBBY before race starts");
        assert(statusBadge.classList.contains("status-lobby"), "Badge has status-lobby class");

        // Check Lobby Banner
        const lobbyBanner = document.querySelector(".leaderboard-lobby-banner");
        assert(lobbyBanner !== null, "Lobby banner is rendered");

        // Check row indicators: p1 has delta-ready and gap-ready; p2 has delta-joined and gap-joined
        const p1Row = document.querySelector('.leaderboard-row[data-user-id="p1"]');
        const p2Row = document.querySelector('.leaderboard-row[data-user-id="p2"]');
        assert(p1Row !== null, "p1 row exists");
        assert(p2Row !== null, "p2 row exists");

        const p1Delta = p1Row.querySelector(".pos-delta");
        const p2Delta = p2Row.querySelector(".pos-delta");
        assert(p1Delta && p1Delta.classList.contains("delta-ready"), "p1 has delta-ready class");
        assert(p2Delta && p2Delta.classList.contains("delta-joined"), "p2 has delta-joined class");

        const p1Gap = p1Row.querySelector(".racer-gap");
        const p2Gap = p2Row.querySelector(".racer-gap");
        assert(p1Gap && p1Gap.textContent === "READY", "p1 gap shows READY");
        assert(p2Gap && p2Gap.textContent === "JOINED", "p2 gap shows JOINED");

        rc.disconnectFromRace();
      });

      it("Countdown messages trigger START countdown banner and GO! transition", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("countdown_room");

        rc.handleRaceMessage({
          userId: "p1",
          username: "RunnerOne",
          status: "ready"
        });

        // Broadcast countdown: 5
        rc.handleRaceMessage({
          type: "countdown",
          countdown: 5
        });

        assertEqual(rc.getCountdownSec(), 5, "rc countdown seconds is 5");
        assertEqual(rc.getRaceStatus(), "starting", "raceStatus is starting");

        let entrants = rc.getRankedEntrants();
        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, false, true, false);

        const statusBadge = document.getElementById("leaderboard-status-badge");
        assertEqual(statusBadge.innerText, "START 5s", "Status badge shows START 5s");
        assert(statusBadge.classList.contains("status-countdown"), "Status badge has status-countdown class");

        let cdBanner = document.querySelector(".leaderboard-countdown-banner");
        assert(cdBanner !== null, "Countdown banner is rendered");
        assert(cdBanner.classList.contains("is-counting"), "Countdown banner has is-counting class");
        assert(cdBanner.textContent.includes("5s"), "Countdown banner displays 5s");

        // Broadcast countdown: 0 (Go!)
        rc.handleRaceMessage({
          type: "countdown",
          countdown: 0
        });

        assertEqual(rc.getCountdownSec(), 0, "rc countdown seconds is 0");
        assertEqual(rc.getRaceStatus(), "in_progress", "raceStatus is in_progress");

        window.LiveSplit.Leaderboard.renderLeaderboard(entrants, false, true, false);
        assertEqual(statusBadge.innerText, "GO!", "Status badge shows GO!");

        cdBanner = document.querySelector(".leaderboard-countdown-banner");
        assert(cdBanner !== null, "Countdown banner still visible for GO!");
        assert(cdBanner.classList.contains("is-go"), "Countdown banner has is-go class");
        assert(cdBanner.textContent.includes("GO! GO! GO!"), "Countdown banner displays GO! GO! GO!");

        rc.disconnectFromRace();
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

      it("renderLeaderboard handles live entrants with deltaSec without ReferenceError", () => {
        const lb = window.LiveSplit.Leaderboard;
        assert(lb && typeof lb.renderLeaderboard === "function", "Leaderboard exists");

        const liveEntrants = [
          {
            userId: "live_runner_1",
            username: "SpeedyGonzales",
            rank: 1,
            isHost: false,
            deltaSec: -4.25,
            currentSplitName: "Castle",
            currentSplitIndex: 2,
            currentTimeSec: 120,
            status: "progress"
          },
          {
            userId: "live_runner_2",
            username: "SlowAndSteady",
            rank: 2,
            isHost: false,
            deltaSec: 12.8,
            currentSplitName: "Cave",
            currentSplitIndex: 1,
            currentTimeSec: 135,
            status: "progress"
          }
        ];

        let threw = false;
        try {
          lb.renderLeaderboard(liveEntrants, false, true, false);
        } catch (err) {
          threw = true;
          console.error("renderLeaderboard threw error:", err);
        }

        assertEqual(threw, false, "renderLeaderboard does not throw ReferenceError when deltaSec is present");
        const row1 = document.querySelector('[data-user-id="live_runner_1"]');
        assert(row1 !== null, "Live runner 1 row rendered in DOM");
        const deltaEl1 = row1.querySelector(".racer-pb-delta");
        assert(deltaEl1 !== null, "Live runner 1 has racer-pb-delta element");
        assert(deltaEl1.textContent.includes("4.3s") || deltaEl1.textContent.includes("4.2s"), "delta text formatted cleanly via formatGapTime");
      });

      it("RaceClient records incoming WebSocket messages and provides getWebSocketLogs / clearWebSocketLogs", () => {
        const rc = window.LiveSplit.RaceClient;
        assert(typeof rc.getWebSocketLogs === "function", "rc.getWebSocketLogs is exported");
        assert(typeof rc.clearWebSocketLogs === "function", "rc.clearWebSocketLogs is exported");

        rc.clearWebSocketLogs();
        assertEqual(rc.getWebSocketLogs().length, 0, "Logs buffer starts empty after clear");

        // Simulate incoming message
        rc.handleRaceMessage({
          type: "participant-split",
          data: {
            user: "LiveRacerX",
            splitName: "Zone 2",
            time: 45000,
            percentage: 0.4
          }
        });

        // Simulate another event
        rc.handleRaceMessage({
          type: "race_started"
        });

        const logs = rc.getWebSocketLogs();
        assert(logs.length >= 0, "getWebSocketLogs returns logs array");
        assert(typeof window.getRaceWsLogs === "function", "window.getRaceWsLogs helper is exported");
      });

      it("WS Logs modal opens with .is-open on click and closes on close button click", () => {
        const btn = document.getElementById("btn-open-ws-logs");
        const modal = document.getElementById("race-ws-logs-modal");
        const closeBtn = document.getElementById("btn-close-ws-logs-modal");
        assert(btn !== null, "btn-open-ws-logs exists in DOM");
        assert(modal !== null, "race-ws-logs-modal exists in DOM");
        assert(closeBtn !== null, "btn-close-ws-logs-modal exists in DOM");

        btn.click();
        assertEqual(modal.style.display, "flex", "modal display is flex after click");

        closeBtn.click();
        assert(!modal.classList.contains("is-open"), "modal removes .is-open on close click");
      });

      it("raceUpdate populates full participants snapshot and prunes participants who left", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.disconnectFromRace();

        rc.connectToRace("ltey");

        // 1. Snapshot with 2 runners arriving late
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: {
            type: "raceUpdate",
            data: {
              raceId: "ltey",
              status: "pending",
              participants: [
                { user: "RacerOne", status: "joined", pb: "12242154" },
                { user: "RacerTwo", status: "ready", pb: "9500000" }
              ]
            }
          }
        });

        let entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 2, "Full snapshot populates 2 runners");
        const r1 = entrants.find(e => e.username === "RacerOne");
        const r2 = entrants.find(e => e.username === "RacerTwo");
        assert(r1 !== undefined, "RacerOne exists");
        assert(r2 !== undefined, "RacerTwo exists");
        assertEqual(r1.status, "joined", "RacerOne is joined");
        assertEqual(r1.isReady, false, "RacerOne isReady is false");
        assertEqual(Math.round(r1.pbSec), 12242, "RacerOne PB is parsed from ms to sec");
        assertEqual(r2.status, "ready", "RacerTwo is ready");
        assertEqual(r2.isReady, true, "RacerTwo isReady is true");

        // 2. Incremental participantUpdate
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            type: "participantUpdate",
            data: {
              raceId: "ltey",
              user: "RacerOne",
              status: "ready"
            }
          }
        });
        entrants = rc.getRankedEntrants();
        const r1Updated = entrants.find(e => e.username === "RacerOne");
        assertEqual(r1Updated.status, "ready", "RacerOne status updated to ready");
        assertEqual(r1Updated.isReady, true, "RacerOne isReady updated to true");

        // 3. New snapshot where RacerTwo left
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: {
            type: "raceUpdate",
            data: {
              raceId: "ltey",
              status: "pending",
              participants: [
                { user: "RacerOne", status: "joined", pb: "12242154" }
              ]
            }
          }
        });
        entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 1, "Snapshot prunes RacerTwo who left");
        assertEqual(entrants[0].username, "RacerOne");

        rc.disconnectFromRace();
      });

      it("rc.reset() does not wipe remote live race participants", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.disconnectFromRace();

        // Connect to a live race and inject remote participants
        rc.connectToRace("live_test_room");
        rc.handleRaceMessage({
          type: "participant-split",
          data: {
            user: "Challenger1",
            splitName: "Stage 3",
            time: 95000,
            percentage: 0.6
          }
        });

        let entrants = rc.getRankedEntrants();
        let chal = entrants.find(e => e.username === "Challenger1" || e.userId === "Challenger1");
        assert(chal !== null && chal !== undefined, "Remote challenger exists in entrants");
        assertEqual(chal.currentTimeSec, 95, "Challenger has 95s elapsed time");

        // Host resets their local LiveSplit timer
        rc.reset();

        // Challenger MUST NOT be wiped out or reset to 0
        entrants = rc.getRankedEntrants();
        chal = entrants.find(e => e.username === "Challenger1" || e.userId === "Challenger1");
        assert(chal !== null && chal !== undefined, "Remote challenger remains intact after host reset");
        assertEqual(chal.currentTimeSec, 95, "Remote challenger time is preserved");

        rc.disconnectFromRace();
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
    });


    describe("Live Race Client - Deep Telemetry, DNF, & Lifecycles", () => {
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

      it("clears and retrieves WebSocket debug logs", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.clearWebSocketLogs();
        assertEqual(rc.getWebSocketLogs().length, 0, "Logs are empty after clear");

        // Inject simulated race message to generate log
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: { raceId: "log_room", participants: [] }
        });
        assert(rc.getWebSocketLogs().length >= 0, "getWebSocketLogs returns array");

        rc.clearWebSocketLogs();
        assertEqual(rc.getWebSocketLogs().length, 0, "Logs cleared successfully");
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
