/**
 * tests/unit/core/splits-loader.test.js
 * LiveSplit.SplitsLoader against real .lss files from tests/fixtures (window.TestFixtures):
 * - Final Fantasy X: GameTime + RealTime, extra "World Record" comparison, 33 splits
 * - Spyro 2: RealTime PB, but GameTime in best segments / history (old load-removed runs), 18 splits
 * - The Simpsons Hit & Run: GameTime only, 50 splits with subsplit names, 2 MB
 */

(function () {
  "use strict";

  const KEYS = window.LiveSplit.Storage.KEYS;
  const fixture = (prefix) => {
    const name = Object.keys(window.TestFixtures).find((n) => n.startsWith(prefix));
    assert(name, `fixture ${prefix}* exists`);
    return window.TestFixtures[name];
  };
  const FFX = () => fixture("Final Fantasy X");
  const SPYRO = () => fixture("Spyro 2");
  const SIMPSONS = () => fixture("The Simpsons");

  const close = (actual, expected, label) =>
    assert(Math.abs(actual - expected) < 0.01, `${label}: expected ~${expected}, got ${actual}`);
  const last = (arr) => arr[arr.length - 1];

  // The loader writes the app's real storage keys; snapshot and restore them around each test.
  // Go through safeStorage so its in-memory copies are cleared too.
  const store = window.LiveSplit.Storage.safeStorage;
  function withCleanStorage(fn) {
    const saved = {};
    Object.values(KEYS).forEach((k) => { saved[k] = localStorage.getItem(k); store.removeItem(k); });
    try {
      return fn();
    } finally {
      Object.entries(saved).forEach(([k, v]) => (v === null ? store.removeItem(k) : store.setItem(k, v)));
    }
  }

  // Minimal RealTime-only splits file (no GameTime anywhere)
  const RT_ONLY_LSS = `<?xml version="1.0" encoding="UTF-8"?>
<Run version="1.7.0"><GameName>Console Game</GameName><CategoryName>Any%</CategoryName><Segments>
  <Segment><Name>One</Name><SplitTimes><SplitTime name="Personal Best"><RealTime>00:01:00.0000000</RealTime></SplitTime></SplitTimes>
    <BestSegmentTime><RealTime>00:00:55.0000000</RealTime></BestSegmentTime><SegmentHistory /></Segment>
  <Segment><Name>Two</Name><SplitTimes><SplitTime name="Personal Best"><RealTime>00:02:30.0000000</RealTime></SplitTime></SplitTimes>
    <BestSegmentTime><RealTime>00:01:20.0000000</RealTime></BestSegmentTime><SegmentHistory /></Segment>
</Segments></Run>`;

  // A fresh app registry with recording stubs for the controllers the loader calls
  function makeApp() {
    const calls = [];
    const record = (name) => (...args) => { calls.push({ name, args }); };
    const app = {
      state: window.LiveSplit.OverlayState.createOverlayState(),
      calls,
      called: (name) => calls.filter((c) => c.name === name),
      gameName: null,
      categoryName: null,
      setGameName: (n) => { app.gameName = n; },
      setCategoryName: (n) => { app.categoryName = n; },
      sanitizeComparisonTimes: window.LiveSplit.SplitEngine.sanitizeComparisonTimes,
      DEFAULT_SPLITS: ["D1", "D2"],
      DEFAULT_TARGETS: [10, 20],
      DEFAULT_BESTS: [9, 9]
    };
    ["clearInRunState", "applyActiveComparison", "loadInRunState", "renderTrack",
      "applyActiveTimingMethod", "initDefaultComparisons"].forEach((n) => { app[n] = record(n); });
    window.LiveSplit.SplitsLoader.installSplitsLoader(app);
    return app;
  }

  function assertCurvesOrdered(data, label) {
    const best = last(data["Best Segments"]);
    const avg = last(data["Average Segments"]);
    const worst = last(data["Worst Segments"]);
    assert(best > 0 && best <= avg && avg <= worst, `${label}: Best (${best}) <= Average (${avg}) <= Worst (${worst})`);
  }

  describe("Splits Loader: parsing real .lss fixtures", () => {
    it("loads Final Fantasy X with both timing methods and its World Record comparison", () => withCleanStorage(() => {
      const app = makeApp();
      app.parseLSS(FFX());
      const s = app.state;

      assertEqual(app.gameName, "Final Fantasy X");
      assertEqual(app.categoryName, "Cutscene Remover, TrueRNG%");
      assertEqual(s.splitsList.length, 33);
      assertEqual(s.splitsList[0], "Sinspawn Ammes");
      assertEqual(last(s.splitsList), "Yu Yevon");
      assertEqual(s.currentTimingMethod, "GameTime", "GameTime detected from the PB");
      close(last(s.comparisonTimesGT), 3 * 3600 + 24 * 60 + 2.154, "PB final GameTime");
      close(last(s.comparisonTimesRT), 3 * 3600 + 29 * 60 + 26.541, "PB final RealTime");
      assert(s.comparisonsList.includes("World Record"), "World Record comparison listed");
      assertEqual(s.comparisonsDataGT["World Record"].length, 33, "World Record has a time per split");
      assertCurvesOrdered(s.comparisonsDataGT, "FFX GameTime curves");
      assertCurvesOrdered(s.comparisonsDataRT, "FFX RealTime curves");
      assertEqual(s.baselineBestSegmentTimesGT, s.bestSegmentTimesGT, "gold baselines captured");
      assert(s.baselineBestSegmentTimesGT !== s.bestSegmentTimesGT, "baselines are a copy");
      assertEqual(app.called("renderTrack").length, 1, "track rendered");
      assertEqual(app.called("loadInRunState").length, 1, "in-run state restored for a non-drop load");
    }));

    it("detects RealTime for Spyro 2: the PB is RealTime even though old golds have GameTime", () => withCleanStorage(() => {
      const app = makeApp();
      app.parseLSS(SPYRO());
      const s = app.state;

      assertEqual(app.gameName, "Spyro 2: Ripto's Rage!");
      assertEqual(s.splitsList.length, 18);
      close(last(s.comparisonTimesRT), 32 * 60 + 17.937, "PB final RealTime");
      assert(!s.comparisonTimesGT.some((t) => t > 0), "the PB has no GameTime targets");
      assert(s.bestSegmentTimesGT.some((t) => t > 0), "best segments do have GameTime");
      assertEqual(s.currentTimingMethod, "RealTime", "the PB's method wins over the golds'");
      assertCurvesOrdered(s.comparisonsDataRT, "Spyro RealTime curves");
    }));

    it("detects RealTime for a file with no GameTime at all", () => withCleanStorage(() => {
      const app = makeApp();
      app.parseLSS(RT_ONLY_LSS);
      assertEqual(app.state.splitsList, ["One", "Two"]);
      assertEqual(app.state.currentTimingMethod, "RealTime");
      assertEqual(localStorage.getItem(KEYS.TIMING_METHOD), "RealTime", "detected method persisted");
    }));

    it("loads a 2 MB GameTime-only file with subsplit names (Simpsons Hit & Run)", () => withCleanStorage(() => {
      const app = makeApp();
      app.parseLSS(SIMPSONS());
      const s = app.state;

      assertEqual(s.splitsList.length, 50);
      assertEqual(s.splitsList[0], "-The Cola Caper", "subsplit names are kept verbatim");
      assertEqual(s.currentTimingMethod, "GameTime");
      close(last(s.comparisonTimesGT), 3600 + 57 * 60 + 55.172, "PB final GameTime");
      assertCurvesOrdered(s.comparisonsDataGT, "Simpsons GameTime curves");
    }));

    it("keeps a manually chosen timing method instead of auto-detecting", () => withCleanStorage(() => {
      localStorage.setItem(KEYS.TIMING_METHOD_MANUAL, "true");
      localStorage.setItem(KEYS.TIMING_METHOD, "RealTime");
      const app = makeApp();
      app.parseLSS(FFX());
      assertEqual(app.state.currentTimingMethod, "RealTime", "manual RealTime kept despite GameTime in file");
    }));

    it("falls back to detection when the manual flag has no valid saved method", () => withCleanStorage(() => {
      localStorage.setItem(KEYS.TIMING_METHOD_MANUAL, "true");
      localStorage.setItem(KEYS.TIMING_METHOD, "bogus");
      const app = makeApp();
      app.parseLSS(RT_ONLY_LSS);
      assertEqual(app.state.currentTimingMethod, "RealTime");
    }));

    it("a new drop clears the previous run's progress and skips in-run restore", () => withCleanStorage(() => {
      const app = makeApp();
      Object.assign(app.state, { currentIndex: 4, lockedDeltas: { 0: {} }, completedSplitTimes: { 0: 1 }, lastSplitRecordedSec: 99 });
      app.parseLSS(SPYRO(), true);
      assertEqual(app.state.currentIndex, -1);
      assertEqual(app.state.lockedDeltas, {});
      assertEqual(app.state.completedSplitTimes, {});
      assertEqual(app.state.lastSplitRecordedSec, 0);
      assertEqual(app.called("clearInRunState").length, 1, "saved in-run state cleared");
      assertEqual(app.called("loadInRunState").length, 0, "no in-run restore for a fresh drop");
    }));

    it("updates the dropzone description with the game and split count", () => withCleanStorage(() => {
      const desc = document.createElement("div");
      desc.id = "dropzone-desc";
      document.body.appendChild(desc);
      try {
        makeApp().parseLSS(SPYRO());
        assertEqual(desc.innerText, "Active: Spyro 2: Ripto's Rage! • 18 splits loaded ✓");
      } finally {
        desc.remove();
      }
    }));

    it("ignores malformed XML and files without segments", () => withCleanStorage(() => {
      const app = makeApp();
      app.parseLSS("<Run><GameName>Broken");
      app.parseLSS("<Run><GameName>Empty</GameName><Segments></Segments></Run>");
      assertEqual(app.state.splitsList, [], "state untouched");
      assertEqual(app.called("renderTrack").length, 0);
    }));

    it("still loads and renders when the splits file is too big to cache", () => withCleanStorage(() => {
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === KEYS.RAW_LSS) throw new DOMException("quota", "QuotaExceededError");
        return realSetItem.call(this, key, value);
      };
      let app;
      try {
        app = makeApp();
        app.parseLSS(SPYRO());
      } finally {
        Storage.prototype.setItem = realSetItem;
      }
      assertEqual(app.state.splitsList.length, 18);
      assertEqual(app.called("renderTrack").length, 1, "track rendered despite the storage failure");
    }));
  });

  describe("Splits Loader: restoring cached splits on startup", () => {
    it("re-parses the cached raw .lss and restores saved preferences", () => withCleanStorage(() => {
      makeApp().parseLSS(FFX());
      localStorage.setItem(KEYS.CURRENT_COMPARISON, "World Record");
      localStorage.setItem(KEYS.TIMER_DISPLAY_MODE, "realtime");
      localStorage.setItem(KEYS.ENABLE_GOLDS, "false");

      const app = makeApp();
      app.loadCachedSplits();
      assertEqual(app.state.splitsList.length, 33, "splits restored from the cached .lss");
      assertEqual(app.state.currentComparison, "World Record");
      assertEqual(app.state.timerDisplayMode, "realtime");
      assertEqual(app.state.cachedEnableGolds, false);
      assertEqual(app.gameName, "Final Fantasy X");
    }));

    it("restores from cached JSON when no raw .lss is stored, cross-filling one-method comparisons", () => withCleanStorage(() => {
      makeApp().parseLSS(SPYRO());
      store.removeItem(KEYS.RAW_LSS);
      // A custom comparison saved with RealTime only should gain a GameTime curve
      const compsRT = JSON.parse(localStorage.getItem(KEYS.COMPARISONS_RT));
      compsRT["Friend"] = compsRT["Personal Best"].map((t) => t + 5);
      localStorage.setItem(KEYS.COMPARISONS_RT, JSON.stringify(compsRT));

      const app = makeApp();
      app.loadCachedSplits();
      const s = app.state;
      assertEqual(s.splitsList.length, 18);
      assertEqual(s.currentTimingMethod, "RealTime", "PB-first detection on the cached path too");
      assertEqual(s.comparisonsDataGT["Friend"].length, 18, "GameTime curve filled from RealTime");
      assertEqual(app.called("applyActiveTimingMethod").length, 1);
      assertEqual(app.called("renderTrack").length, 1);
    }));

    it("rebuilds gold baselines from bests when none were cached", () => withCleanStorage(() => {
      makeApp().parseLSS(SPYRO());
      store.removeItem(KEYS.RAW_LSS);
      store.removeItem(KEYS.BASELINE_GOLDS_GT);
      const app = makeApp();
      app.loadCachedSplits();
      assertEqual(app.state.baselineBestSegmentTimesRT, app.state.bestSegmentTimesRT);
    }));

    it("falls back to the default splits when nothing (or corrupt JSON) is cached", () => withCleanStorage(() => {
      localStorage.setItem(KEYS.SEGMENTS, "{not json");
      const app = makeApp();
      app.loadCachedSplits();
      assertEqual(app.state.splitsList, ["D1", "D2"]);
      assertEqual(app.state.comparisonTimesGT, [10, 20]);
      assertEqual(app.called("initDefaultComparisons").length, 1);
      assertEqual(app.called("renderTrack").length, 1);
    }));

    it("derives the timing method from a saved single-method timer display", () => withCleanStorage(() => {
      localStorage.setItem(KEYS.TIMER_DISPLAY_MODE, "gametime");
      const app = makeApp();
      app.state.currentTimingMethod = "RealTime";
      app.loadCachedSplits();
      assertEqual(app.state.currentTimingMethod, "GameTime");
    }));
  });
})();
