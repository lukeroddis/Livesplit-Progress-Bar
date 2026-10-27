/**
 * overlay.js - Application Composition Root
 *
 * Creates the shared overlay state and `app` registry, installs every controller
 * onto it, wires the stateful UI helpers (connection, ghost runner, track density,
 * menus), and boots the overlay. Behaviour lives in the modules under src/:
 *
 *   src/core/overlay-state.js         shared run & comparison state
 *   src/core/livesplit-connection.js  LiveSplit Server socket + command queue
 *   src/core/run-tracker.js           poll loop and split transitions
 *   src/core/run-persistence.js       in-run state across reloads
 *   src/core/comparison-controller.js active comparison & timing method
 *   src/core/splits-loader.js         .lss apply and cached restore
 *   src/ui/track-status.js            track render, split states, live progress
 *   src/ui/timing-controls.js         timer display mode & gold toggle
 *   src/ui/hud-titles.js              game / category titles
 *   src/ui/hud-bindings.js            badge, hotkey and control bindings
 *   src/core/window-api.js            window.* API for layout.js and tests
 *
 * Controllers call each other through app.<fn> at call time, so script order
 * between them does not matter (only that they load before this file).
 */

// safeStorage is provided by src/core/storage.js (window.LiveSplit.Storage.safeStorage).
const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

const APP_VERSION = "v2.0.0";

// Generic fallback splits used if no .lss is loaded
const DEFAULT_SPLITS = [
  "Split 1", "Split 2", "Split 3", "Split 4", "Split 5",
  "Split 6", "Split 7", "Split 8", "Split 9", "Finish"
];
const DEFAULT_TARGETS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
const DEFAULT_BESTS = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30];

// ============================================================
// 1. SHARED STATE & CONTROLLER REGISTRY
// ============================================================
const state = window.LiveSplit.OverlayState.createOverlayState();
const app = { state };

window.LiveSplit.RunTracker.installRunTracker(app);
window.LiveSplit.RunPersistence.installRunPersistence(app);
window.LiveSplit.ComparisonController.installComparisonController(app);
window.LiveSplit.SplitsLoader.installSplitsLoader(app);
window.LiveSplit.TrackStatus.installTrackStatus(app);
window.LiveSplit.TimingControls.installTimingControls(app);
window.LiveSplit.HudTitles.installHudTitles(app);
window.LiveSplit.HudBindings.installHudBindings(app);

const ALL_DELTA_CLASSES = window.LiveSplit.TrackRenderer.ALL_DELTA_CLASSES;
const ALL_SPLIT_STATE_CLASSES = window.LiveSplit.TrackRenderer.ALL_SPLIT_STATE_CLASSES;
const getVisibleSplitsCapacity = window.LiveSplit.TrackRenderer.getVisibleSplitsCapacity;

function getRaceClient() {
  const rc = window.LiveSplit.RaceClient;
  return rc ? (rc.instance || rc) : null;
}

// Thin aliases onto LiveSplit.Time / DOMUtils / SplitEngine / GhostMath / ToastManager
function timeStringToSeconds(tStr) {
  return window.LiveSplit.Time.timeStringToSeconds(tStr);
}

function escapeHtml(str) {
  return window.LiveSplit.DOMUtils.escapeHtml(str);
}

function formatTimerDisplay(rawTime) {
  return window.LiveSplit.Time.formatTimerDisplay(rawTime);
}

function formatTargetTime(sec) {
  return window.LiveSplit.Time.formatTargetTime(sec);
}

function formatDeltaSeconds(signedSec) {
  return window.LiveSplit.Time.formatDeltaSeconds(signedSec);
}

function formatDeltaLive(raw) {
  return window.LiveSplit.Time.formatDeltaLive(raw);
}

function sanitizeComparisonTimes(times, fallbackTimes, targetLen = null) {
  return window.LiveSplit.SplitEngine.sanitizeComparisonTimes(times, fallbackTimes, targetLen);
}

function getShortComparisonName(name) {
  return window.LiveSplit.SplitEngine.getShortComparisonName(name);
}

function calculateGhostProgress(currentSec, times) {
  return window.LiveSplit.GhostMath.calculateGhostProgress(currentSec, times);
}

function showComparisonToast(compName) {
  return window.LiveSplit.ToastManager.showComparisonToast(compName);
}

// ============================================================
// 2. LIVESPLIT SERVER CONNECTION (src/core/livesplit-connection.js)
// ============================================================
let isPolling = false;

const connection = window.LiveSplit.LiveSplitConnection.createLiveSplitConnection({
  onOpen: async () => {
    state.canQueryComparison = true;
    const rcConn = getRaceClient();
    if (rcConn && typeof rcConn.setExternalHostConnected === "function") {
      rcConn.setExternalHostConnected(true);
    }

    // Query Game and Category from LiveSplit if not loaded from .lss
    if (!localStorage.getItem(STORAGE_KEYS.RAW_LSS)) {
      await app.syncLiveSplitMetadata();
    }

    if (!isPolling) {
      isPolling = true;
      app.pollLoop();
    }
  },
  onClose: () => {
    isPolling = false;
    const rcDisconn = getRaceClient();
    if (rcDisconn && typeof rcDisconn.setExternalHostConnected === "function") {
      rcDisconn.setExternalHostConnected(false);
    }
  }
});

function sendCommand(cmd, timeoutMs = 400, isProbe = false) {
  return connection.sendCommand(cmd, timeoutMs, isProbe);
}

// Fire-and-forget command (LiveSplit sends no reply), skipped while disconnected
function sendRaw(cmd) {
  connection.sendRaw(cmd);
}

// ============================================================
// 3. GHOST RUNNER (src/ui/ghost-runner.js)
// ============================================================
const ghostRunner = window.LiveSplit.GhostRunner.createGhostRunner({
  getSplitsList: () => state.splitsList,
  getComparisonTimes: () => state.comparisonTimes,
  getCurrentIndex: () => state.currentIndex,
  getLastSplitRecordedSec: () => state.lastSplitRecordedSec,
  getLastElapsedSec: () => state.lastElapsedSec,
  getGhostInfo: (ghostId) => app.getGhostComparisonInfo(ghostId),
  getRaceClient
});

// ============================================================
// 4. FILE LOADERS, TRACK DENSITY & SCROLL INPUT
//    (src/ui/splits-file-loader.js, track-density.js, track-scroll.js)
// ============================================================
window.LiveSplit.SplitsFileLoader.bindSplitsFileLoaders({
  onSplitsText: (xmlText) => app.parseLSS(xmlText, true)
});

const trackDensity = window.LiveSplit.TrackDensity.createTrackDensityController({
  getSplitCount: () => state.splitsList.length,
  onOrientationChange: () => { state.trackManualScrollOffset = 0; },
  refresh: () => updateTrackDensityAndAngle()
});

function updateTrackDensityAndAngle() {
  ghostRunner.clearTextThresholdCache();
  if (trackDensity.update()) {
    app.updateTrackStatus(state.currentIndex);
  }
}

function setupTrackScrollInteractions() {
  window.LiveSplit.TrackScroll.setupTrackScrollInteractions({
    isTrackWindowed: app.isTrackWindowed,
    shiftTrackWindow: app.shiftTrackWindow
  });
}

// ============================================================
// 5. INITIALIZATION
// ============================================================
let isOverlayInitialized = false;

function initOverlay() {
  if (isOverlayInitialized) return;
  isOverlayInitialized = true;

  app.bindHudControls();

  // Live race controls & WebSocket telemetry log (src/ui/race-controls.js, src/ui/ws-log-panel.js)
  const raceClient = getRaceClient();
  window.LiveSplit.RaceControls.bindRaceControls({
    raceClient,
    refreshLeaderboard: ghostRunner.refreshLeaderboard,
    refreshGhosts: () => ghostRunner.updateGhostRunner(state.lastElapsedSec),
    getSimulationInputs: () => {
      const gtComparisons = (state.comparisonTimesGT && state.comparisonTimesGT.length > 0) ? state.comparisonTimesGT : state.comparisonTimes;
      const rtComparisons = (state.comparisonTimesRT && state.comparisonTimesRT.length > 0) ? state.comparisonTimesRT : gtComparisons;
      const isAlreadyRunning = (state.currentIndex >= 0 && typeof state.lastElapsedSec === "number" && state.lastElapsedSec > 0);
      return { splitsList: state.splitsList, gtComparisons, rtComparisons, isAlreadyRunning };
    }
  });
  window.LiveSplit.WsLogPanel.bindWsLogPanel(raceClient);

  window.LiveSplit.SettingsMenu.initSettingsMenuDraggable();
  setupTrackScrollInteractions();
  app.loadCachedSplits();
  updateTrackDensityAndAngle();
  ghostRunner.updateGhostBadge();

  window.LiveSplit.DevMode.initDevMode();

  const verEl = document.getElementById("overlay-version");
  if (verEl) verEl.innerText = APP_VERSION;

  connection.connect();
}

// Overlay-level helpers and wired controllers that other controllers call through app.<name>
Object.assign(app, {
  APP_VERSION,
  DEFAULT_SPLITS,
  DEFAULT_TARGETS,
  DEFAULT_BESTS,
  ALL_DELTA_CLASSES,
  ALL_SPLIT_STATE_CLASSES,
  getVisibleSplitsCapacity,
  getRaceClient,
  timeStringToSeconds,
  escapeHtml,
  formatTimerDisplay,
  formatTargetTime,
  formatDeltaSeconds,
  formatDeltaLive,
  sanitizeComparisonTimes,
  getShortComparisonName,
  calculateGhostProgress,
  showComparisonToast,
  connection,
  sendCommand,
  sendRaw,
  ghostRunner,
  getNodeTextThreshold: ghostRunner.getNodeTextThreshold,
  getOrCreateGhostMarker: ghostRunner.getOrCreateGhostMarker,
  refreshLeaderboard: ghostRunner.refreshLeaderboard,
  updateGhostRunner: ghostRunner.updateGhostRunner,
  updateGhostBadge: ghostRunner.updateGhostBadge,
  setGhostComparison: ghostRunner.setGhostComparison,
  toggleGhostComparison: ghostRunner.toggleGhostComparison,
  cycleGhostComparison: ghostRunner.cycleGhostComparison,
  setGhostOpacity: ghostRunner.setGhostOpacity,
  trackDensity,
  cycleVisibleSplits: trackDensity.cycleVisibleSplits,
  cycleSplitAngle: trackDensity.cycleSplitAngle,
  updateTrackDensityAndAngle,
  setupTrackScrollInteractions,
  resetSettingsMenuPosition: window.LiveSplit.SettingsMenu.resetSettingsMenuPosition,
  toggleSettingsMenu: window.LiveSplit.SettingsMenu.toggleSettingsMenu,
  isDevModeActive: window.LiveSplit.DevMode.isDevModeActive,
  setDevMode: window.LiveSplit.DevMode.setDevMode,
  toggleDevMode: window.LiveSplit.DevMode.toggleDevMode,
  initOverlay
});

window.LiveSplit.WindowApi.installWindowApi(app);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOverlay);
} else {
  initOverlay();
}
