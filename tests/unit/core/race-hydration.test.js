/**
 * tests/unit/core/race-hydration.test.js
 * Catch-up of runners first seen mid-race and avatar lookups (LiveSplit.RaceHydration),
 * driven through FakeTherun so no real therun.gg request is made.
 */

(function () {
  "use strict";

  const LIVE = "https://therun.gg/api/live";
  const USERS = "https://therun.gg/api/users";
  const PIC = (name) => `https://static-cdn.jtvnw.net/jtv_user_pictures/${name}-profile_image-150x150.png`;

  function liveRun(user, raceId, overrides = {}) {
    return Object.assign({
      user,
      raceId,
      picture: PIC(user),
      currentSplitIndex: 3,
      currentSplitName: "Split 4",
      currentTime: 95000,
      delta: -1200,
      insertedAt: Date.now() - 5000,
      hasReset: false,
      splits: [
        { name: "Split 1", splitTime: 30000, pbSplitTime: 31000 },
        { name: "Split 2", splitTime: 62000, pbSplitTime: 63000 },
        { name: "Split 3", splitTime: 95000, pbSplitTime: 96000 },
        { name: "Split 4", splitTime: null, pbSplitTime: 130000, predictedSingleTime: 34000 }
      ]
    }, overrides);
  }

  function freshClient() {
    window.FakeTherun.reset();
    window.LiveSplit.RaceHydration.clearPictureCache();
    return window.LiveSplit.RaceClient.createRaceClient();
  }

  describe("Race Hydration: LiveSplit.RaceHydration", () => {
    it("converts a therun.gg live run into participant telemetry", () => {
      const t = window.LiveSplit.RaceHydration.liveRunToTelemetry(liveRun("Zak", "t95e"));
      assertEqual(t.user, "Zak");
      assertEqual(t.status, "started");
      assertEqual(t.liveData.currentSplitIndex, 3);
      assertEqual(t.liveData.splits.length, 4);
      assert(t.liveData.splitStartedAt > 0, "insertedAt maps to splitStartedAt");
    });

    it("catches the host up on connect from their therun.gg live run", async () => {
      const rc = freshClient();
      rc.setHostUsername("HostRunner");
      window.FakeTherun.respond(`${LIVE}/HostRunner`, liveRun("HostRunner", "hyd1"));

      rc.connectToRace("hyd1");
      await window.FakeTherun.flush();

      const host = rc.getRankedEntrants().find(e => e.username === "HostRunner");
      assert(host, "Host entrant created before they split again");
      assertEqual(host.currentSplitIndex, 3);
      assertEqual(host.splitTimes, [30, 62, 95], "Completed split history from the live run");
      assertEqual(host.deltaSec, -1.2);
      assertEqual(host.avatar, PIC("HostRunner"));
      assertEqual(host.lastSplitEffect || null, null, "Catch-up does not flash a split");
      assert(host.elapsedSegmentSec >= 4 && host.elapsedSegmentSec < 10, `Segment time counts from the last split, got ${host.elapsedSegmentSec}`);
      rc.disconnectFromRace();
    });

    it("ignores a live run that belongs to another race", async () => {
      const rc = freshClient();
      rc.setHostUsername("HostRunner");
      window.FakeTherun.respond(`${LIVE}/HostRunner`, liveRun("HostRunner", "some_other_race"));

      rc.connectToRace("hyd2");
      await window.FakeTherun.flush();

      assertEqual(rc.getRankedEntrants().length, 0, "No entrant from an unrelated run");
      rc.disconnectFromRace();
    });

    it("fetches a newly seen runner's avatar from their therun.gg profile", async () => {
      const rc = freshClient();
      const updates = [];
      rc.subscribe((type) => updates.push(type));
      window.FakeTherun.respond(`${USERS}/LobbyRunner/global`, { user: "LobbyRunner", picture: PIC("LobbyRunner") });

      rc.connectToRace("hyd3");
      rc.handleRaceMessage({ type: "message", data: { raceId: "hyd3", type: "participant-join", data: { user: "LobbyRunner" } } });
      assertEqual(rc.getRankedEntrants()[0].avatar, "", "No avatar until the profile lookup returns");

      await window.FakeTherun.flush();
      assertEqual(rc.getRankedEntrants()[0].avatar, PIC("LobbyRunner"));
      assert(updates.includes("entrants_update"), "Listeners are told to re-render");
      rc.disconnectFromRace();
    });

    it("looks each runner up once per race and reuses cached pictures", async () => {
      const rc = freshClient();
      window.FakeTherun.respond(`${USERS}/Repeat/global`, { user: "Repeat", picture: PIC("Repeat") });

      rc.connectToRace("hyd4");
      rc.handleRaceMessage({ user: "Repeat", status: "joined" });
      rc.handleRaceMessage({ user: "Repeat", status: "ready" });
      await window.FakeTherun.flush();
      const firstCount = window.FakeTherun.requests.filter(u => u.includes("/Repeat")).length;
      assertEqual(firstCount, 2, "One live-run and one profile request");

      // Reconnecting to the race re-runs the catch-up but the picture comes from cache
      rc.connectToRace("hyd5");
      rc.handleRaceMessage({ user: "Repeat", status: "joined" });
      assertEqual(rc.getRankedEntrants()[0].avatar, PIC("Repeat"), "Cached picture applied immediately");
      await window.FakeTherun.flush();
      const profileRequests = window.FakeTherun.requests.filter(u => u === `${USERS}/Repeat/global`).length;
      assertEqual(profileRequests, 1, "Profile fetched only once");
      rc.disconnectFromRace();
    });
  });
})();
