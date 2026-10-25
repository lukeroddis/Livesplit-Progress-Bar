/**
 * tests/unit/race/leaderboard-rendering.test.js
 * F1 timing tower DOM, row reconciliation, split glows, FLIP animations, badges and banners.
 * (Split from the former tests/unit/core/race-client.test.js.)
 */

(function () {
  "use strict";

    describe("Race: Leaderboard rendering", () => {
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

      it("Split completion glow lasts 4.0s with gradual fade and 3-phase title transition", () => {
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
            currentTime: 12000000,
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
        // Chaser is still on Split 2 at 12000s, 4200s (70m) after the leader finished -> +1:10:00
        assertEqual(chaser.gapDisplay, "+1:10:00", "70-minute gap (4200s) formats as +1:10:00 instead of +70:00");
        assertEqual(chaser.expectedSegmentDisplay, "1:10:00", "Expected 4200s segment formats as 1:10:00");

        window.LiveSplit.Leaderboard.renderLeaderboard(list, false, true, false);
        const leaderRow = document.querySelector('.leaderboard-row[data-user-id="r_hour_leader"]');
        const leaderRibbon = leaderRow.querySelector(".racer-ribbon");
        assert(leaderRibbon.title.includes("1:10:00"), `Ribbon tooltip formats 4200s segment as 1:10:00, got: ${leaderRibbon.title}`);

        window.LiveSplit.Leaderboard.reset();
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
    });
})();
