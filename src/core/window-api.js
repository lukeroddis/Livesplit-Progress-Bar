/**
 * src/core/window-api.js - Global window.* API
 *
 * The overlay's public surface for layout.js, layout modules, and the in-browser
 * test suite. Every export reads from the shared `app` registry, so this must be
 * installed after all controllers and overlay helpers are registered.
 *
 * Keep names stable: layout.js, src/ui/* and tests/unit/* call these directly.
 */

(function () {
  "use strict";

  function installWindowApi(app) {
    const { state, ghostRunner } = app;

    Object.assign(window, {
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
      setupTrackScrollInteractions: app.setupTrackScrollInteractions,

      // Settings menu & dev mode
      resetSettingsMenuPosition: app.resetSettingsMenuPosition,
      toggleSettingsMenu: app.toggleSettingsMenu,
      isDevMode: app.isDevModeActive,
      setDevMode: app.setDevMode,
      toggleDevMode: app.toggleDevMode,
      showDevModeToast: window.LiveSplit.ToastManager.showDevModeToast
    });

    window.LiveSplit.getLastElapsedSec = () => state.lastElapsedSec;
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.WindowApi = {
    installWindowApi
  };
})();
