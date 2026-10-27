/**
 * tests/unit/core/run-tracker.test.js
 * End-to-end poll loop tests against the scriptable fake LiveSplit Server
 * (tests/harness/fake-livesplit.js). These run after all synchronous specs.
 */

(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(condition, label, timeoutMs = 3000) {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
      await sleep(20);
    }
  }

  describe("Run Tracker: LiveSplit poll loop end-to-end (fake server)", () => {
    const fake = window.FakeLiveSplit;
    const item = (i) => document.getElementById(`item-${i}`);

    it("connects, tracks a start, a gold split and a reset, and never sends gettimingmethod", async () => {
      fake.reset();
      window.clearInRunState();
      window.updateTrackStatus(-1);

      fake.acceptConnection();
      await waitFor(() => document.getElementById("connection-status")?.innerText === "CONNECTED", "status pill CONNECTED");
      await waitFor(() => fake.sent.includes("getsplitindex"), "poll loop running");

      // Timer starts: split index 0
      fake.state.gameTime = 5;
      fake.state.splitIndex = 0;
      await waitFor(() => window.getCurrentIndex() === 0, "run start (index 0)");
      assert(item(0).classList.contains("current"), "split 0 is current");
      await waitFor(() => document.getElementById("timer-igt").innerText === "5.00", "game time mirrored to HUD");

      // Split 0 completes at 25s against a 30s target (and a 30s best segment by default)
      fake.state.gameTime = 25;
      fake.state.lastSplitTime = 25;
      fake.state.delta = "-5.00";
      fake.state.splitIndex = 1;
      await waitFor(() => window.getCurrentIndex() === 1 && window.getLockedDeltas()[0], "split 0 locked");
      const locked = window.getLockedDeltas()[0];
      assertEqual(locked.splitTimeSec, 25, "recorded split time");
      assert(locked.stateClass !== "uncoloured", `split 0 is coloured (got ${locked.stateClass})`);
      assert(locked.deltaInfo.isAhead, "split 0 delta is ahead");
      assert(item(0).classList.contains("completed"), "split 0 marked completed");
      assert(fake.sent.includes("getlastsplittime") && fake.sent.includes("getdelta"), "transition queries sent once per split");

      // Reset
      fake.state.splitIndex = -1;
      fake.state.gameTime = 0;
      fake.state.lastSplitTime = null;
      await waitFor(() => window.getCurrentIndex() === -1, "reset (index -1)");
      assertEqual(Object.keys(window.getLockedDeltas()), [], "locked deltas cleared on reset");
      assert(!item(0).classList.contains("completed"), "split 0 no longer completed");

      assert(!fake.sent.includes("gettimingmethod"), "gettimingmethod is blacklisted");

      fake.dropConnection();
      await waitFor(() => document.getElementById("connection-status")?.innerText === "DISCONNECTED", "status pill DISCONNECTED");
    });
  });
})();
