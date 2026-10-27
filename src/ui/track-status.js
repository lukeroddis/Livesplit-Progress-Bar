/**
 * src/ui/track-status.js - Track Status, Split Deltas & Live Segment Progress
 *
 * - Renders the track for the loaded splits and applies the sliding window
 * - Per-split completed / current / upcoming classes and locked delta display
 * - Wheel/arrow window shifting state
 * - 60 FPS live segment fill, overdue glow, and on-pace hidden delta reveal
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function installTrackStatus(app) {
    const { state } = app;

    function renderTrack() {
      if (liveElementCache) liveElementCache.invalidate();
      app.ghostRunner.clearTextThresholdCache();
      const track = document.getElementById("track");
      const targetLabels = state.splitsList.map((_, i) => app.formatTargetTime(state.comparisonTimes[i]));
      window.LiveSplit.TrackRenderer.buildTrackDom(track, state.splitsList, targetLabels, state.currentIndex >= 0);
      track.style.setProperty("--ghost-opacity", app.ghostRunner.getGhostOpacity());

      app.updateTrackDensityAndAngle();
      updateTrackStatus(state.currentIndex);
    }

    // Sliding-window mode is on when "Always Show Last Split" is enabled (and not "Fit All")
    function isTrackWindowingEnabled() {
      const alwaysShowLast = localStorage.getItem(STORAGE_KEYS.ALWAYS_SHOW_LAST) !== "false";
      const splitPref = localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto";
      return alwaysShowLast && splitPref !== "all";
    }

    function isTrackWindowed() {
      const N = state.splitsList.length;
      if (N <= 1 || !isTrackWindowingEnabled()) return false;
      return (N + 1 > app.getVisibleSplitsCapacity());
    }

    function shiftTrackWindow(direction) {
      const N = state.splitsList.length;
      if (N <= 1) return false;
      if (!isTrackWindowed()) return false;

      const V = app.getVisibleSplitsCapacity();
      const { k: currentK, defaultK, maxK } = window.LiveSplit.TrackRenderer.getTrackWindowPosition(state.currentIndex, N, V, state.trackManualScrollOffset);
      const newK = Math.max(0, Math.min(maxK, currentK + direction));

      if (newK !== currentK) {
        state.trackManualScrollOffset = newK - defaultK;
        updateTrackWindow(state.currentIndex);
        if (state.lastElapsedSec > 0) {
          app.updateGhostRunner(state.lastElapsedSec);
        }
        return true;
      }
      return false;
    }

    // Applies the sliding window (pinned final split + discontinuity break); returns true when windowed
    function updateTrackWindow(idx) {
      const N = state.splitsList.length;
      const enabled = N > 1 && isTrackWindowingEnabled();
      const V = enabled ? app.getVisibleSplitsCapacity() : N + 1;
      const win = window.LiveSplit.TrackRenderer.calculateTrackWindow(idx, N, V, state.trackManualScrollOffset, enabled);
      window.LiveSplit.TrackRenderer.applyTrackWindow(N, win);
      return win.isWindowed;
    }

    function clearDeltaSpan(i) {
      const deltaSpan = document.getElementById(`delta-val-${i}`);
      if (deltaSpan) {
        deltaSpan.innerText = "";
        deltaSpan.className = "split-delta-val";
      }
    }

    function updateTrackStatus(idx) {
      if (idx !== state.currentIndex) {
        state.trackManualScrollOffset = 0;
      }
      state.currentIndex = idx;
      const nodeStart = document.getElementById("node-start");
      if (nodeStart) {
        nodeStart.classList.toggle("active", idx >= 0);
      }

      const isVertical = document.getElementById("track")?.classList.contains("vertical");
      const resetSegmentFill = window.LiveSplit.TrackRenderer.resetSegmentFill;

      for (let i = 0; i < state.splitsList.length; i++) {
        const item = document.getElementById(`item-${i}`);
        const fill = document.getElementById(`fill-${i}`);
        if (!item) continue;

        item.classList.remove("current");

        if (idx < 0) {
          // Before the run: clear all state and show comparison targets
          item.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
          if (fill) resetSegmentFill(fill, isVertical);
          clearDeltaSpan(i);
          const timeSpan = document.getElementById(`time-val-${i}`);
          if (timeSpan) {
            const targetVal = app.formatTargetTime(state.comparisonTimes[i]);
            timeSpan.innerText = targetVal || "-";
            timeSpan.className = "split-time-val target-time";
          }
        } else if (i < idx) {
          item.classList.add("completed");
          if (state.lockedDeltas[i]) {
            const { deltaInfo, stateClass, splitTimeSec } = state.lockedDeltas[i];
            setDeltaDisplay(i, deltaInfo, stateClass, splitTimeSec);
          } else if (fill) {
            fill.style.width = "100%";
            fill.style.height = "100%";
            fill.className = "segment-bar-fill uncoloured";
            item.classList.add("uncoloured");
            if (fill.parentElement) fill.parentElement.classList.remove("overdue");
          }
        } else if (i === idx) {
          item.classList.add("current");
          item.classList.remove("completed");
          if (!state.lockedDeltas[i]) clearDeltaSpan(i);
        } else {
          item.classList.remove("completed");
          if (fill) resetSegmentFill(fill, isVertical);
          clearDeltaSpan(i);
        }
      }

      // Update sliding window & discontinuity after status classes are updated
      const isWindowed = updateTrackWindow(idx);
      window.LiveSplit.TrackRenderer.scrollTrackToIndex(idx, isWindowed, isVertical);
    }

    let liveElementCache = null;

    function getLiveElements(idx) {
      if (!liveElementCache) {
        liveElementCache = window.LiveSplit.TrackRenderer.createLiveElementCache();
      }
      return liveElementCache.getElements(idx);
    }

    function updateLiveSegmentProgress(currentSec) {
      if (state.currentIndex < 0 || state.currentIndex >= state.splitsList.length || currentSec === null) return;

      const { fill, deltaSpan, isVertical } = getLiveElements(state.currentIndex);

      const prevTargetSec = (state.currentIndex > 0 && state.comparisonTimes[state.currentIndex - 1] !== null)
        ? state.comparisonTimes[state.currentIndex - 1]
        : 0;

      const currentTargetSec = state.comparisonTimes[state.currentIndex];
      if (!currentTargetSec || currentTargetSec <= prevTargetSec) return;

      const expectedDuration = currentTargetSec - prevTargetSec;
      const elapsedInSegment = Math.max(0, currentSec - state.lastSplitRecordedSec);

      if (expectedDuration <= 0) return;

      // 1. Progress Bar Fill (universal for horizontal and vertical)
      if (fill) {
        const progressRatio = Math.max(0, elapsedInSegment / expectedDuration);
        const pct = Math.min(100, progressRatio * 100);
        if (isVertical) {
          fill.style.width = "100%";
          fill.style.height = `${pct.toFixed(1)}%`;
        } else {
          fill.style.width = `${pct.toFixed(1)}%`;
          fill.style.height = "100%";
        }

        if (progressRatio > 1.0) {
          fill.classList.add("overdue");
          if (fill.parentElement) fill.parentElement.classList.add("overdue");
        } else {
          fill.classList.remove("overdue");
          if (fill.parentElement) fill.parentElement.classList.remove("overdue");
        }
      }

      // 2. Live Delta on Current Split:
      // Displays and updates live once the runner begins losing time to the Best Segment
      if (deltaSpan) {
        const isGoldsEnabled = state.cachedEnableGolds;
        const bestSec = (state.currentIndex < state.bestSegmentTimes.length && state.bestSegmentTimes[state.currentIndex] !== null && state.bestSegmentTimes[state.currentIndex] > 0)
          ? state.bestSegmentTimes[state.currentIndex]
          : null;

        const liveDeltaSec = currentSec - currentTargetSec;
        const deltaChange = liveDeltaSec - state.previousDeltaSeconds;
        const gainedTime = deltaChange <= 0.001;

        // Losing time condition:
        // If Golds are enabled and a Best Segment is recorded, triggers as soon as segment elapsed time exceeds best segment.
        // Otherwise triggers when segment elapsed time exceeds expected PB duration or delta is losing time vs previous split.
        const isLosingTimeToBest = (isGoldsEnabled && bestSec !== null)
          ? (elapsedInSegment > bestSec)
          : (elapsedInSegment > expectedDuration || deltaChange > 0);

        if (isLosingTimeToBest) {
          deltaSpan.innerText = app.formatDeltaSeconds(liveDeltaSec);
          const targetClass = liveDeltaSec <= 0
            ? (gainedTime ? "delta-ahead-gaining" : "delta-ahead-losing")
            : (gainedTime ? "delta-behind-gaining" : "delta-behind-losing");
          const expectedClass = `split-delta-val ${targetClass}`;
          if (deltaSpan.className !== expectedClass) {
            deltaSpan.className = expectedClass;
          }
        } else {
          // While still on pace to gold (within best segment time), keep delta hidden
          if (deltaSpan.innerText !== "") {
            deltaSpan.innerText = "";
          }
          if (deltaSpan.className !== "split-delta-val") {
            deltaSpan.className = "split-delta-val";
          }
        }
      }
    }

    function setDeltaDisplay(index, deltaInfo, stateClass, splitTimeSec) {
      if (index < 0 || index >= state.splitsList.length) return;
      const el = document.getElementById(`delta-${index}`);
      const item = document.getElementById(`item-${index}`);
      const fill = document.getElementById(`fill-${index}`);
      if (!el || !item) return;

      const deltaSpan = document.getElementById(`delta-val-${index}`) || el.querySelector(".split-delta-val");
      const timeSpan = document.getElementById(`time-val-${index}`) || el.querySelector(".split-time-val");

      // Clean up previous state classes
      el.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
      item.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);

      if (deltaSpan) {
        deltaSpan.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
        if (deltaInfo && deltaInfo.text) {
          deltaSpan.innerText = deltaInfo.text;
          deltaSpan.classList.add(`delta-${stateClass}`);
        } else {
          deltaSpan.innerText = "";
        }
      }

      if (timeSpan) {
        timeSpan.classList.remove(...app.ALL_SPLIT_STATE_CLASSES);
        if (splitTimeSec !== null && splitTimeSec !== undefined && !isNaN(splitTimeSec)) {
          timeSpan.innerText = app.formatTargetTime(splitTimeSec);
          timeSpan.className = "split-time-val";
        } else {
          const targetVal = app.formatTargetTime(state.comparisonTimes[index]);
          timeSpan.innerText = (stateClass === "uncoloured" && (splitTimeSec === null || splitTimeSec === undefined))
            ? "-"
            : (targetVal || "-");
          timeSpan.className = "split-time-val target-time";
        }
      }

      if (fill) {
        fill.style.width = "100%";
        fill.style.height = "100%";
        fill.className = `segment-bar-fill ${stateClass}`;
        if (fill.parentElement) fill.parentElement.classList.remove("overdue");
      }

      item.classList.add("completed", stateClass);
    }

    return Object.assign(app, {
      renderTrack,
      isTrackWindowingEnabled,
      isTrackWindowed,
      shiftTrackWindow,
      updateTrackWindow,
      clearDeltaSpan,
      updateTrackStatus,
      getLiveElements,
      updateLiveSegmentProgress,
      setDeltaDisplay
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.TrackStatus = {
    installTrackStatus
  };
})();
