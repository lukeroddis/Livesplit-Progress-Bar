/**
 * tests/unit/core/race-protocol.test.js
 * Unit tests for LiveSplit.RaceProtocol message and telemetry parser
 */

(function () {
  "use strict";

  describe("Race Telemetry Protocol: LiveSplit.RaceProtocol", () => {
    function createMockContext() {
      const entrants = new Map();
      const events = [];
      const notifications = [];
      let raceStatus = "open";
      let countdownTargetMs = null;
      let countdownSeconds = null;

      return {
        entrants,
        hostState: { userId: "you", username: "You" },
        hostUsername: "You",
        activeSplitsList: ["Stage 1", "Stage 2", "Stage 3", "Final"],
        isLiveRoom: true,
        getRaceStatus: () => raceStatus,
        setRaceStatus: (s) => { raceStatus = s; },
        getCountdownTargetMs: () => countdownTargetMs,
        setCountdownTargetMs: (ms) => { countdownTargetMs = ms; },
        getCountdownSeconds: () => countdownSeconds,
        setCountdownSeconds: (s) => { countdownSeconds = s; },
        lastKnownRanks: new Map(),
        checkpointRankHistory: new Map(),
        pushRaceEvent: (evt) => events.push(evt),
        notifyListeners: (type, payload) => notifications.push({ type, payload }),
        events,
        notifications
      };
    }

    it("exports complete public API on window.LiveSplit.RaceProtocol", () => {
      const rp = window.LiveSplit && window.LiveSplit.RaceProtocol;
      assert(rp !== undefined && rp !== null, "RaceProtocol is exposed on window.LiveSplit");
      assert(Array.isArray(rp.DEFAULT_RACER_PALETTE), "DEFAULT_RACER_PALETTE is an array");
      assertEqual(typeof rp.updateEntrantFromTelemetry, "function", "updateEntrantFromTelemetry is a function");
      assertEqual(typeof rp.parseRaceMessage, "function", "parseRaceMessage is a function");
    });

    it("parseRaceMessage ignores pure chat messages on race websocket", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.parseRaceMessage({ type: "chat", message: "gl hf!" }, ctx);
      assertEqual(ctx.entrants.size, 0, "No entrants created from chat");
      assertEqual(ctx.events.length, 0, "No events created from chat");

      rp.parseRaceMessage({ type: "message", message: "just chatting" }, ctx);
      assertEqual(ctx.entrants.size, 0);
    });

    it("parseRaceMessage unwraps nested envelopes and updates race status and countdowns", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Nested envelope with countdown
      const msg = {
        result: {
          data: {
            raceStatus: "starting",
            countdown: 5
          }
        }
      };

      rp.parseRaceMessage(msg, ctx);
      assertEqual(ctx.getRaceStatus(), "starting");
      assertEqual(ctx.getCountdownSeconds(), 5);
      assert(ctx.events.some(e => e.type === "countdown"), "Pushes countdown event");

      // Race start message
      rp.parseRaceMessage({ type: "race-started" }, ctx);
      assertEqual(ctx.getRaceStatus(), "in_progress");
      assertEqual(ctx.getCountdownSeconds(), 0);
      assert(ctx.events.some(e => e.type === "started"), "Pushes started event");
    });

    it("updateEntrantFromTelemetry measures split progress from the last split, not the run start", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // therun.gg race participant update: no splits array, completed times in splitPredictions
      rp.updateEntrantFromTelemetry({
        user: "Racer",
        status: "started",
        liveData: {
          currentSplitIndex: 3,
          currentTime: 663191.89,
          splitStartedAt: Date.now(),
          totalSplits: 17,
          runPercentageTime: 0.13,
          splitPredictions: [
            { splitIndex: 0, currentTime: -988.7 },
            { splitIndex: 1, currentTime: 196661.09 },
            { splitIndex: 2, currentTime: 508495.39 },
            { splitIndex: 3, currentTime: 663191.89 }
          ]
        }
      }, ctx);

      const racer = ctx.entrants.get("Racer");
      assertEqual(racer.currentSplitIndex, 3);
      assert(racer.score >= 3 && racer.score < 3.1, `just split, so at the start of split 4 (score ${racer.score})`);
    });

    it("updateEntrantFromTelemetry parses newcomer entrant with palette colors", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.updateEntrantFromTelemetry({
        userId: "competitor_1",
        username: "Speedy",
        status: "joined"
      }, ctx);

      assert(ctx.entrants.has("competitor_1"), "Entrant registered in Map");
      const entrant = ctx.entrants.get("competitor_1");
      assertEqual(entrant.username, "Speedy");
      assertEqual(entrant.isHost, false);
      assert(entrant.color.startsWith("#"), "Assigned a hex color from palette");
      assert(ctx.events.some(e => e.type === "join"), "Emits join event");
    });

    it("updateEntrantFromTelemetry converts millisecond telemetry and calculates split completions", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Initial registration
      rp.updateEntrantFromTelemetry({
        user: "RacerX",
        status: "ready"
      }, ctx);

      const entrant = ctx.entrants.get("RacerX");
      assertEqual(entrant.currentSplitIndex, 0);

      // Advances to Split 2 (index 1) with 35,000ms elapsed time and gold flag
      rp.updateEntrantFromTelemetry({
        user: "RacerX",
        currentTime: 35000,
        currentSplitIndex: 1,
        currentSplitName: "Stage 2",
        isGold: true
      }, ctx);

      assertEqual(entrant.currentSplitIndex, 1);
      assertEqual(entrant.currentTimeSec, 35.0, "Converts 35000ms to 35.0s");
      assertEqual(entrant.lastSplitEffect.type, "gold", "Identifies gold split effect");
      assertEqual(entrant.splitTimes[0], 35.0, "Records checkpoint time for split 1");
    });

    it("updateEntrantFromTelemetry resolves finished and DNF states cleanly", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Finish state
      rp.updateEntrantFromTelemetry({
        user: "Finisher",
        status: "finished",
        finalTime: 72500
      }, ctx);

      const finRunner = ctx.entrants.get("Finisher");
      assertEqual(finRunner.isFinished, true);
      assertEqual(finRunner.finalTimeSec, 72.5);
      assertEqual(finRunner.currentSplitName, "Finished");

      // DNF state
      rp.updateEntrantFromTelemetry({
        user: "Quitter",
        status: "forfeited",
        currentTime: 42000
      }, ctx);

      const dnfRunner = ctx.entrants.get("Quitter");
      assertEqual(dnfRunner.isDNF, true);
      assertEqual(dnfRunner.isFinished, false);
      assertEqual(dnfRunner.currentSplitName, "DNF");
    });

    it("parseRaceMessage prunes participants who left the room on authoritative snapshot", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      // Add two competitors
      rp.updateEntrantFromTelemetry({ user: "Alice" }, ctx);
      rp.updateEntrantFromTelemetry({ user: "Bob" }, ctx);
      assertEqual(ctx.entrants.size, 2);

      // Authoritative snapshot contains only Alice: Bob has left the room
      rp.parseRaceMessage({
        participants: [{ user: "Alice", status: "ready" }]
      }, ctx);

      assert(ctx.entrants.has("Alice"), "Alice remains in room");
      assert(!ctx.entrants.has("Bob"), "Bob was pruned from entrants Map");
    });

    // Trimmed from a real therun.gg room: participantUpdate (new split "Guilt") followed by
    // the participant-split room message naming the split just COMPLETED
    function zakUpdate(splitIndex, currentSplitName, previousSplitName, currentTime) {
      const preds = [{ splitIndex: 0, splitName: "Town 1", currentTime: null }];
      for (let i = 1; i <= splitIndex; i++) {
        preds.push({ splitIndex: i, splitName: `S${i}`, currentTime: i === splitIndex ? currentTime : i * 100000 });
      }
      return {
        type: "participantUpdate",
        data: {
          raceId: "t95e",
          user: "ZakTheRobot",
          status: "started",
          liveData: {
            currentSplitIndex: splitIndex,
            currentSplitName,
            previousSplitName,
            currentTime,
            delta: 102929.912,
            splitStartedAt: Date.now(),
            totalSplits: 39,
            splitPredictions: preds
          }
        }
      };
    }

    function zakSplitMessage(splitName, time) {
      return {
        type: "message",
        data: {
          raceId: "t95e",
          data: { splitName, percentage: 0.55, time, user: "ZakTheRobot" },
          time: "2026-10-25T21:31:41.055Z",
          type: "participant-split"
        }
      };
    }

    it("participant-split arriving after participantUpdate does not revert the current split name", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.parseRaceMessage(zakUpdate(20, "Timeflux Channeler 3", "Canal Hamlet", 2256044.9957), ctx);
      rp.parseRaceMessage(zakUpdate(21, "Guilt", "Timeflux Channeler 3", 2500643.4137), ctx);
      rp.parseRaceMessage(zakSplitMessage("Timeflux Channeler 3", 2500643.4137), ctx);

      const zak = ctx.entrants.get("ZakTheRobot");
      assertEqual(zak.currentSplitIndex, 21);
      assertEqual(zak.currentSplitName, "Guilt", "Split name stays on the new split");
      assertEqual(zak.lastSplitEffect.completedSplitName, "Timeflux Channeler 3");
      assertEqual(zak.lastSplitEffect.newSplitName, "Guilt");
    });

    it("participant-split arriving before participantUpdate also ends on the new split name", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.parseRaceMessage(zakUpdate(20, "Timeflux Channeler 3", "Canal Hamlet", 2256044.9957), ctx);
      rp.parseRaceMessage(zakSplitMessage("Timeflux Channeler 3", 2500643.4137), ctx);
      assertEqual(ctx.entrants.get("ZakTheRobot").currentSplitName, "Timeflux Channeler 3", "Still on the split being completed");

      rp.parseRaceMessage(zakUpdate(21, "Guilt", "Timeflux Channeler 3", 2500643.4137), ctx);
      assertEqual(ctx.entrants.get("ZakTheRobot").currentSplitName, "Guilt");
    });

    it("runner first seen mid-race gets index-aligned split history from splitPredictions", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.parseRaceMessage(zakUpdate(21, "Guilt", "Timeflux Channeler 3", 2500643.4137), ctx);

      const zak = ctx.entrants.get("ZakTheRobot");
      assertEqual(zak.splitTimes.length, 21, "21 completed splits known");
      assertEqual(zak.splitTimes[0], 100, "Split 1 time from splitPredictions[1]");
      assert(Math.abs(zak.splitTimes[20] - 2500.643) < 0.001, "Latest split at index 20");
      assert(Math.abs(zak.deltaSec - 102.93) < 0.001, "PB delta converted from ms");

      const ranked = window.LiveSplit.RaceRanking.calculateRankedEntrants({ entrants: ctx.entrants, nowMs: Date.now() });
      assert(ranked[0].elapsedSegmentSec < 5, `Segment time counts from the last split, got ${ranked[0].elapsedSegmentSec}`);
    });

    it("runner first seen long after their last split does not flash a split", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();
      const msg = zakUpdate(21, "Guilt", "Timeflux Channeler 3", 2500643.4137);
      msg.data.liveData.splitStartedAt = Date.now() - 60000;

      rp.parseRaceMessage(msg, ctx);
      assertEqual(ctx.entrants.get("ZakTheRobot").lastSplitEffect || null, null, "No stale split flash");
    });

    it("numeric deltas are always milliseconds, even under half a second", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();

      rp.updateEntrantFromTelemetry({ user: "Close", liveData: { delta: 320, currentTime: 60000 } }, ctx);
      assertEqual(ctx.entrants.get("Close").deltaSec, 0.32, "320ms reads as 0.32s, not 320s");

      rp.updateEntrantFromTelemetry({ user: "Close", liveData: { delta: -45 } }, ctx);
      assertEqual(ctx.entrants.get("Close").deltaSec, -0.045);
    });

    it("notifies onEntrantDiscovered once per new runner", () => {
      const rp = window.LiveSplit.RaceProtocol;
      const ctx = createMockContext();
      const discovered = [];
      ctx.onEntrantDiscovered = (e) => discovered.push(e.username);

      rp.updateEntrantFromTelemetry({ user: "Alice", status: "joined" }, ctx);
      rp.updateEntrantFromTelemetry({ user: "Alice", status: "ready" }, ctx);
      rp.updateEntrantFromTelemetry({ user: "Bob" }, ctx);
      assertEqual(discovered, ["Alice", "Bob"]);
    });
  });
})();
