/**
 * src/core/window-api.js - Overlay Public API (window.LiveSplit.Overlay)
 *
 * The overlay's public surface for layout.js, layout-side modules (settings panels,
 * profiles, drag) and the in-browser test suite. Every entry reads from the shared
 * `app` registry, so it is filled in after all controllers are registered.
 *
 * App code calls it at call time as `window.LiveSplit.Overlay.fn?.(...)`: the object
 * exists from page load (empty until initOverlay), so callers need no window guards.
 * Every entry is also copied onto `window.*` for the browser console and older tests;
 * app code must not read those copies (tests/test_project_rules.py enforces this).
 * Keep names stable.
 */

(function () {
  "use strict";

  function installWindowApi(app) {
    const { state, ghostRunner } = app;

    const api = {
      APP_VERSION: app.APP_VERSION,
      initOverlay: app.initOverlay,

      // Comparisons & timing method
      applyActiveComparison: app.applyActiveComparison,
      getCurrentComparison: () => state.currentComparison,
      getComparisonsList: () => state.comparisonsList,
      cycleComparison: app.cycleComparison,
      normalizeComparisonName: app.normalizeComparisonName,
      getShortComparisonName: app.getShortComparisonName,
      showComparisonToast: app.showComparisonToast,
      sanitizeComparisonTimes: app.sanitizeComparisonTimes,
      detectTimingMethodFromComp: app.detectTimingMethodFromComp,
      applyActiveTimingMethod: app.applyActiveTimingMethod,
      getCurrentTimingMethod: () => state.currentTimingMethod,
      setTimerDisplayMode: app.setTimerDisplayMode,
      setTimingMethodFocus: app.setTimingMethodFocus,
      getTimerDisplayMode: () => state.timerDisplayMode,
      toggleTimingMethod: app.toggleTimingMethod,
      updateTimingMethodBadge: app.updateTimingMethodBadge,
      updateTimerDisplayHierarchy: app.updateTimerDisplayHierarchy,

      // Time formatting
      timeStringToSeconds: app.timeStringToSeconds,
      formatTargetTime: app.formatTargetTime,
      formatDeltaSeconds: app.formatDeltaSeconds,
      formatDeltaLive: app.formatDeltaLive,
      formatTimerDisplay: app.formatTimerDisplay,

      // Ghosts
      getGhostComparison: () => ghostRunner.getPrimaryGhost(),
      getActiveGhostComparisons: () => ghostRunner.getActiveGhostComparisons(),
      setGhostComparison: app.setGhostComparison,
      toggleGhostComparison: app.toggleGhostComparison,
      cycleGhostComparison: app.cycleGhostComparison,
      getGhostComparisonInfo: app.getGhostComparisonInfo,
      getOrCreateGhostMarker: app.getOrCreateGhostMarker,
      calculateGhostProgress: app.calculateGhostProgress,
      getNodeTextThreshold: app.getNodeTextThreshold,
      setGhostOpacity: app.setGhostOpacity,
      updateGhostBadge: app.updateGhostBadge,
      updateGhostRunner: app.updateGhostRunner,

      // Run progress & track
      handleUndoSplit: app.handleUndoSplit,
      setDeltaDisplay: app.setDeltaDisplay,
      saveInRunState: app.saveInRunState,
      clearInRunState: app.clearInRunState,
      loadInRunState: app.loadInRunState,
      getLockedDeltas: () => state.lockedDeltas,
      getCurrentIndex: () => state.currentIndex,
      getLastElapsedSec: () => state.lastElapsedSec,
      updateTrackStatus: app.updateTrackStatus,
      updateTrackWindow: app.updateTrackWindow,
      shiftTrackWindow: app.shiftTrackWindow,
      isTrackWindowed: app.isTrackWindowed,
      getVisibleSplitsCapacity: app.getVisibleSplitsCapacity,
      getTrackManualScrollOffset: () => state.trackManualScrollOffset,
      updateTrackDensityAndAngle: app.updateTrackDensityAndAngle,
      // Re-measure density / angle, then re-render the track at the current split
      refreshTrack: () => {
        app.updateTrackDensityAndAngle();
        app.updateTrackStatus(state.currentIndex);
      },
      setupTrackScrollInteractions: app.setupTrackScrollInteractions,

      // Live settings by id (src/core/settings-registry.js)
      settings: app.settings,

      // Settings menu & dev mode
      resetSettingsMenuPosition: app.resetSettingsMenuPosition,
      toggleSettingsMenu: app.toggleSettingsMenu,
      isDevMode: app.isDevModeActive,
      setDevMode: app.setDevMode,
      toggleDevMode: app.toggleDevMode,
      showDevModeToast: window.LiveSplit.ToastManager.showDevModeToast
    };

    Object.assign(window.LiveSplit.Overlay, api);
    Object.assign(window, api);
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Overlay = window.LiveSplit.Overlay || {};
  window.LiveSplit.WindowApi = {
    installWindowApi
  };
})();
