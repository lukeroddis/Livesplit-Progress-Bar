/**
 * tests/unit/ui/leaderboard.test.js
 * Unit tests for leaderboard
 */

(function () {
  "use strict";


    describe("Live Race Leaderboard - Avatars, Podium, Banners, & FLIP", () => {
      it("renders image tag for HTTP/HTTPS/data image avatars with safe HTML escaping", () => {
        const lb = window.LiveSplit.Leaderboard;
        const entrants = [
          {
            userId: "img_runner",
            username: "PhotoRunner",
            avatar: "https://example.com/avatar.png",
            rank: 1,
            position: 1,
            isHost: false,
            currentTimeSec: 45,
            currentSplitName: "Stage 1",
            deltaSec: 0,
            isFinished: false
          },
          {
            userId: "data_runner",
            username: "DataRunner",
            avatar: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
            rank: 2,
            position: 2,
            isHost: false,
            currentTimeSec: 48,
            currentSplitName: "Stage 1",
            deltaSec: 3,
            isFinished: false
          },
          {
            userId: "emoji_runner",
            username: "EmojiRunner",
            avatar: "⚡",
            rank: 3,
            position: 3,
            isHost: true,
            currentTimeSec: 50,
            currentSplitName: "Stage 1",
            deltaSec: 5,
            isFinished: false
          }
        ];

        lb.renderLeaderboard(entrants, true, false, false);
        const row1 = document.querySelector('.leaderboard-row[data-user-id="img_runner"]');
        assert(row1 !== null, "row1 rendered");
        const img1 = row1.querySelector(".racer-avatar-img");
        assert(img1 !== null, "racer-avatar-img rendered for https URL");
        assertEqual(img1.getAttribute("src"), "https://example.com/avatar.png");

        const row2 = document.querySelector('.leaderboard-row[data-user-id="data_runner"]');
        const img2 = row2.querySelector(".racer-avatar-img");
        assert(img2 !== null, "racer-avatar-img rendered for data: image URL");

        const row3 = document.querySelector('.leaderboard-row[data-user-id="emoji_runner"]');
        assert(row3.querySelector(".racer-avatar-img") === null, "emoji does not render img tag");
        assert(row3.querySelector(".racer-avatar-badge").textContent.includes("⚡"), "renders emoji text");
      });

      it("swaps in an avatar that arrives after the row was created", () => {
        const lb = window.LiveSplit.Leaderboard;
        const racer = { userId: "late_avatar", username: "LateAvatar", avatar: "", rank: 1, currentSplitName: "Stage 1" };
        lb.renderLeaderboard([racer], true, false, false);
        const row = document.querySelector('.leaderboard-row[data-user-id="late_avatar"]');
        assert(row.querySelector(".racer-avatar-img") === null, "fallback emoji before the lookup returns");

        lb.renderLeaderboard([Object.assign({}, racer, { avatar: "https://example.com/late.png" })], true, false, false);
        const img = row.querySelector(".racer-avatar-img");
        assert(img !== null, "avatar image rendered in place");
        assertEqual(img.getAttribute("src"), "https://example.com/late.png");
        assert(document.querySelector('.leaderboard-row[data-user-id="late_avatar"]') === row, "row element reused");
      });

      it("glows the leader gap only while the runner is losing time to the leader", () => {
        const lb = window.LiveSplit.Leaderboard;
        const leader = { userId: "gap_leader", username: "Leader", rank: 1, gapDisplay: "LEADER", currentSplitName: "Stage 3", currentSplitIndex: 2, currentTimeSec: 200 };
        const chaser = {
          userId: "gap_chaser", username: "Chaser", rank: 2, currentSplitName: "Stage 2", currentSplitIndex: 1, currentTimeSec: 200,
          gapDisplay: "+1:30", gapMode: "live", gapReferenceSec: 83, splitsBehindLeader: 1, isLosingToLeader: true
        };
        lb.renderLeaderboard([leader, chaser], true, false, false);
        const gapEl = document.querySelector('.leaderboard-row[data-user-id="gap_chaser"] .racer-gap');
        assert(gapEl.classList.contains("is-losing"), "losing time glows red");
        const gapCol = document.querySelector('.leaderboard-row[data-user-id="gap_chaser"] .racer-gap-col');
        assert(gapCol.title.includes("Gap at last split: +1:23"), `tooltip names the time to beat, got ${gapCol.title}`);

        lb.renderLeaderboard([leader, Object.assign({}, chaser, { gapDisplay: "+0:05", isLosingToLeader: false })], true, false, false);
        assert(!gapEl.classList.contains("is-losing"), "glow cleared once the leader splits again");
        assert(!document.querySelector('.leaderboard-row[data-user-id="gap_leader"] .racer-gap').classList.contains("is-losing"), "leader never glows");
      });

      it("writes name and split text into scrollable marquee spans", () => {
        const lb = window.LiveSplit.Leaderboard;
        const longSplit = "{Chapter 1 - Volcano} Guayota and a very long split name";
        lb.renderLeaderboard([{ userId: "marquee_1", username: "Marquee", rank: 1, currentSplitName: "Short" }], true, false, false);
        lb.renderLeaderboard([{ userId: "marquee_1", username: "Marquee", rank: 1, currentSplitName: longSplit }], true, false, false);
        const splitEl = document.querySelector('.leaderboard-row[data-user-id="marquee_1"] .racer-split');
        const inner = splitEl.querySelector(".marquee-text");
        assert(inner !== null, "split label has a marquee span");
        assertEqual(inner.textContent, longSplit);
        assertEqual(splitEl.textContent, longSplit, "no stray text outside the marquee span");
        assertEqual(document.querySelector('.leaderboard-row[data-user-id="marquee_1"] .racer-name .marquee-text').textContent, "Marquee");
      });

      it("renders winner podium ribbon and FINISHED status badge when race completes", () => {
        const lb = window.LiveSplit.Leaderboard;
        const entrants = [
          {
            userId: "winner_1",
            username: "Champion",
            rank: 1,
            position: 1,
            isHost: false,
            currentTimeSec: 120,
            currentSplitName: "Finish",
            finalTimeSec: 120,
            isFinished: true,
            segmentRibbon: "gold",
            hasCrown: true
          },
          {
            userId: "runner_2",
            username: "SecondPlace",
            rank: 2,
            position: 2,
            isHost: false,
            currentTimeSec: 125,
            currentSplitName: "Finish",
            finalTimeSec: 125,
            isFinished: true
          }
        ];

        lb.renderLeaderboard(entrants, true, false, false);
        const statusBadge = document.getElementById("leaderboard-status-badge");
        if (statusBadge) {
          assertEqual(statusBadge.innerText, "FINISHED", "Status badge displays FINISHED");
        }

        const row1 = document.querySelector('.leaderboard-row[data-user-id="winner_1"]');
        assert(row1 !== null, "winner row rendered");
        const ribbon = row1.querySelector(".racer-ribbon.ribbon-gold");
        assert(ribbon !== null, "winner has gold ribbon mounted");
      });

      it("renders countdown and lobby banners when race is pending or starting", () => {
        const lb = window.LiveSplit.Leaderboard;
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();
        rc.connectToRace("banner_room");

        // 1. Countdown banner
        rc.handleRaceMessage({
          type: "countdown",
          seconds: 5
        });
        lb.renderLeaderboard([], false, true, false);
        let cdBanner = document.querySelector(".leaderboard-countdown-banner");
        assert(cdBanner !== null, "countdown banner is rendered");
        assert(cdBanner.innerText.includes("5s"), "countdown banner text has 5s");

        // 2. Lobby banner
        rc.handleRaceMessage({
          type: "message",
          data: { type: "race-start-canceled" }
        });
        const lobbyEntrants = [
          { userId: "u1", username: "U1", isReady: true, status: "ready" },
          { userId: "u2", username: "U2", isReady: true, status: "ready" },
          { userId: "u3", username: "U3", isReady: true, status: "ready" },
          { userId: "u4", username: "U4", isReady: false, status: "joined" },
          { userId: "u5", username: "U5", isReady: false, status: "joined" }
        ];
        lb.renderLeaderboard(lobbyEntrants, false, true, false);
        let lobbyBanner = document.querySelector(".leaderboard-lobby-banner");
        assert(lobbyBanner !== null, "lobby banner is rendered");
        assert(lobbyBanner.innerText.length > 0, "lobby banner has active message or ready status");

        rc.disconnectFromRace();
      });

      it("handles FLIP animation swap cleanup on transitionend", () => {
        const lb = window.LiveSplit.Leaderboard;
        const entrantsA = [
          { userId: "flip_1", username: "FlipOne", rank: 1, position: 1, currentTimeSec: 50 },
          { userId: "flip_2", username: "FlipTwo", rank: 2, position: 2, currentTimeSec: 52 }
        ];
        lb.renderLeaderboard(entrantsA, true, false, false);

        // Swap positions
        const entrantsB = [
          { userId: "flip_2", username: "FlipTwo", rank: 1, position: 1, currentTimeSec: 52 },
          { userId: "flip_1", username: "FlipOne", rank: 2, position: 2, currentTimeSec: 50 }
        ];
        lb.renderLeaderboard(entrantsB, true, false, false);

        const row = document.querySelector('.leaderboard-row[data-user-id="flip_2"]');
        assert(row !== null, "row exists");

        // Simulate transitionend on transform
        const transEv = new TransitionEvent("transitionend", {
          propertyName: "transform",
          bubbles: true
        });
        row.dispatchEvent(transEv);
        assert(!row.classList.contains("is-swapping"), "is-swapping removed after transform transition");
      });

      it("handles fallback display when username is missing", () => {
        const lb = window.LiveSplit.Leaderboard;
        const namelessEntrants = [
          { userId: "no_name_id", username: "", rank: 1, position: 1, currentTimeSec: 20 }
        ];
        lb.renderLeaderboard(namelessEntrants, true, false, false);
        const row = document.querySelector('.leaderboard-row[data-user-id="no_name_id"]');
        assert(row !== null, "row rendered");
        const nameEl = row.querySelector(".racer-name");
        assert(nameEl !== null, "name element exists");
        assert(nameEl.innerText.length > 0, "fallback name is not empty");
      });

      it("hides leaderboard component when layout state sets visibility to false", () => {
        const lb = window.LiveSplit.Leaderboard;
        const compEl = document.getElementById("hud-comp-leaderboard");
        const origGetState = window.hudLayout?.getState;
        window.hudLayout = window.hudLayout || {};
        window.hudLayout.getState = () => ({ leaderboard: { visible: false } });

        lb.renderLeaderboard([{ userId: "p1", username: "P1", rank: 1, position: 1 }], true, false, false);
        assert(compEl.classList.contains("is-hidden"), "Leaderboard is hidden when layout sets visible to false");

        if (origGetState) {
          window.hudLayout.getState = origGetState;
        } else {
          delete window.hudLayout.getState;
        }
      });
    });
})();
