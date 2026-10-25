/**
 * src/ui/ghost-runner.js - Live Ghost Runner Engine & Multi-Ghost Markers
 *
 * Owns the active ghost selection (WR / PB / Best / Average / Worst / custom)
 * and renders, every tick:
 * - On-track ghost markers interpolated along the split track
 * - Live race competitor pins (delegated to LiveSplit.RaceTrackMarkers)
 * - Off-screen edge pills with live deltas vs each ghost
 * - The F1 leaderboard refresh
 *
 * Run state is read through getters injected by overlay.js.
 */

(function () {
  "use strict";

  const escapeHtml = (str) => window.LiveSplit.DOMUtils.escapeHtml(str);
  const formatDeltaSeconds = (sec) => window.LiveSplit.Time.formatDeltaSeconds(sec);

  const GHOST_PRESETS = [
    ["off"],
    ["wr"],
    ["pb"],
    ["wr", "pb"],
    ["best"],
    ["wr", "best"],
    ["average"],
    ["worst"]
  ];

  const GHOST_BADGE_LABELS = {
    wr: "🏆 WR",
    pb: "🥈 PB",
    best: "⭐ Best",
    average: "📊 Avg",
    worst: "🐢 Worst"
  };

  function loadActiveGhostComparisons() {
    const savedMulti = localStorage.getItem("livesplit_active_ghosts");
    if (savedMulti) {
      try {
        const parsed = JSON.parse(savedMulti);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        if (Array.isArray(parsed) && parsed.length === 0) return ["off"];
      } catch (e) {}
    }
    const single = localStorage.getItem("livesplit_ghost_comparison") || "off";
    return single === "off" ? ["off"] : [single];
  }

  function clearMarkerOffsets(m) {
    m.style.removeProperty("--ghost-stack-offset");
    m.style.removeProperty("--ghost-splay-x");
    m.style.removeProperty("--ghost-needle-angle");
    m.style.removeProperty("--ghost-needle-height");
  }

  function renderEdgePill(el, ghosts, arrow, arrowFirst) {
    if (ghosts.length === 0 || !el) {
      if (el) el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    const side = arrowFirst ? "left" : "right";
    if (ghosts.length === 1) {
      const g = ghosts[0];
      const iconCol = g.ghostInfo.color ? `style="color:${g.ghostInfo.color};"` : "";
      const icon = `<span id="ghost-edge-${side}-icon" ${iconCol}>${g.ghostInfo.icon}</span>`;
      const val = `<span id="ghost-edge-${side}-val" style="color:${g.isAhead ? "#22c55e" : "#ef4444"};">${g.deltaStr}</span>`;
      el.innerHTML = arrowFirst
        ? `<span>${arrow}</span> ${icon} ${val}`
        : `${val} ${icon} <span>${arrow}</span>`;
      return;
    }
    const items = ghosts.map(g => {
      const col = g.isAhead ? "#22c55e" : "#ef4444";
      const iconCol = g.ghostInfo.color ? `style="color:${g.ghostInfo.color};"` : "";
      return `<span ${iconCol}>${g.ghostInfo.icon}</span> <span style="color:${col}; font-weight:700;">${g.deltaStr}</span>`;
    }).join(" &nbsp;");
    el.innerHTML = arrowFirst
      ? `<span style="opacity:0.7;">${arrow}</span> ${items}`
      : `${items} <span style="opacity:0.7;">${arrow}</span>`;
  }

  /**
   * @param {Object} options
   * @param {Function} options.getSplitsList
   * @param {Function} options.getComparisonTimes - Active comparison cumulative times
   * @param {Function} options.getCurrentIndex
   * @param {Function} options.getLastSplitRecordedSec
   * @param {Function} options.getLastElapsedSec
   * @param {Function} options.getGhostInfo - (ghostId) => { id, name, icon, color, times } | null
   * @param {Function} options.getRaceClient
   */
  function createGhostRunner(options = {}) {
    const {
      getSplitsList = () => [],
      getComparisonTimes = () => [],
      getCurrentIndex = () => -1,
      getLastSplitRecordedSec = () => 0,
      getLastElapsedSec = () => 0,
      getGhostInfo = () => null,
      getRaceClient = () => null
    } = options;

    let activeGhostComparisons = loadActiveGhostComparisons();
    let ghostComparison = activeGhostComparisons.filter(g => g !== "off")[0] || "off";
    let ghostOpacity = parseFloat(localStorage.getItem("livesplit_ghost_opacity") || "85") / 100;
    const nodeThresholdCache = new Map();
    const knownGhostMarkers = new Set();

    function saveActiveGhostComparisons() {
      localStorage.setItem("livesplit_active_ghosts", JSON.stringify(activeGhostComparisons));
      const primary = activeGhostComparisons.filter(g => g !== "off")[0] || "off";
      ghostComparison = primary;
      localStorage.setItem("livesplit_ghost_comparison", primary);
    }

    function getNodeTextThreshold(nodeEl, isNext = false) {
      if (!nodeEl) return 45;
      const cacheKey = (nodeEl.id || "start") + (isNext ? "_next" : "_prev");
      if (nodeThresholdCache.has(cacheKey)) {
        return nodeThresholdCache.get(cacheKey);
      }

      const track = document.getElementById("track");
      const isAngled = track && track.classList.contains("angled-text");
      const nameEl = nodeEl.querySelector(".split-name");
      const deltaEl = nodeEl.querySelector(".split-delta");
      const nameW = nameEl ? nameEl.offsetWidth : 60;
      const deltaW = deltaEl ? deltaEl.offsetWidth : 50;

      let val = 45;
      if (isAngled) {
        if (!isNext) {
          val = Math.max(45, (nameW * 0.76) + 12);
        } else {
          val = Math.max(45, (deltaW / 2) + 15);
        }
      } else {
        const maxW = Math.max(nameW, deltaW, 50);
        val = (maxW / 2) + 14;
      }

      nodeThresholdCache.set(cacheKey, val);
      return val;
    }

    function getOrCreateGhostMarker(ghostInfo) {
      const markerId = `ghost-marker-${ghostInfo.id}`;
      let marker = document.getElementById(markerId);
      const track = document.getElementById("track");
      if (!track) return null;

      if (!marker) {
        marker = document.createElement("div");
        marker.id = markerId;
        marker.className = `ghost-marker ghost-theme-${ghostInfo.id}`;
        marker.innerHTML = `
          <div class="ghost-icon-wrap"><span class="ghost-icon">${escapeHtml(ghostInfo.icon || "🏎️")}</span></div>
          <div class="ghost-needle"></div>
          <div class="racer-tag">${ghostInfo.name ? escapeHtml(ghostInfo.name) : ""}</div>
        `;
        track.appendChild(marker);
      } else {
        if (!track.contains(marker)) {
          track.appendChild(marker);
        }
        marker.className = `ghost-marker ghost-theme-${ghostInfo.id}`;
        const iconSpan = marker.querySelector(".ghost-icon");
        if (iconSpan) iconSpan.innerText = ghostInfo.icon;
        let tag = marker.querySelector(".racer-tag");
        if (!tag) {
          tag = document.createElement("div");
          tag.className = "racer-tag";
          marker.appendChild(tag);
        }
        tag.innerText = ghostInfo.name || "";
      }
      knownGhostMarkers.add(marker);
      return marker;
    }

    function refreshLeaderboard() {
      if (window.LiveSplitLeaderboard && typeof window.LiveSplitLeaderboard.renderLeaderboard === "function") {
        const rc = getRaceClient();
        const isSim = rc ? (typeof rc.isSimulating === "function" ? rc.isSimulating() : !!rc.isSimulating) : false;
        const isConn = rc ? (typeof rc.isConnected === "function" ? rc.isConnected() : !!rc.isConnected) : false;
        const isEditMode = window.hudLayout && typeof window.hudLayout.isEditMode === "function" ? window.hudLayout.isEditMode() : false;
        window.LiveSplitLeaderboard.renderLeaderboard(
          rc ? rc.getRankedEntrants() : [],
          isSim,
          isConn,
          isEditMode
        );
      }
    }

    function hideAllGhostMarkers() {
      const staticMarker = document.getElementById("ghost-marker");
      if (staticMarker) {
        staticMarker.style.display = "none";
        clearMarkerOffsets(staticMarker);
        staticMarker.classList.remove("splay-left", "splay-right");
      }
      knownGhostMarkers.forEach((m) => {
        if (m) {
          m.style.display = "none";
          clearMarkerOffsets(m);
          m.classList.remove("splay-left", "splay-right");
        }
      });
    }

    function hideEdgePills() {
      const edgeLeft = document.getElementById("ghost-edge-left");
      const edgeRight = document.getElementById("ghost-edge-right");
      if (edgeLeft) edgeLeft.style.display = "none";
      if (edgeRight) edgeRight.style.display = "none";
    }

    /**
     * Track-space start/end coordinates (and bounding nodes) for a segment,
     * following omitted splits and schematic discontinuities.
     */
    function getSegmentCoords(segIdx, isVertical, nodeStart, splitCount) {
      let startCoord = 0;
      let endCoord = 0;
      let prevNode = null;
      let nextNode = null;

      const offsetStart = isVertical ? "offsetTop" : "offsetLeft";
      const offsetSize = isVertical ? "offsetHeight" : "offsetWidth";

      if (segIdx === 0) {
        prevNode = nodeStart;
        startCoord = nodeStart[offsetStart] + (nodeStart[offsetSize] / 2);
        const item0 = document.getElementById("item-0");
        nextNode = item0;
        endCoord = item0 ? (item0[offsetStart] + (item0[offsetSize] / 2)) : startCoord + (isVertical ? 64 : 220);
        return { startCoord, endCoord, prevNode, nextNode };
      }

      const prevItem = document.getElementById(`item-${segIdx - 1}`);
      const currentItem = document.getElementById(`item-${segIdx}`);
      if (!prevItem || !currentItem) return null;

      if (currentItem.classList.contains("is-omitted")) {
        const finalItem = document.getElementById(`item-${splitCount - 1}`);
        if (!finalItem || !finalItem.classList.contains("has-discontinuity")) return null;
        const disc = isVertical
          ? finalItem.offsetTop - 32
          : finalItem.offsetLeft - (finalItem.offsetWidth / 2);
        return { startCoord: disc, endCoord: disc, prevNode, nextNode };
      }

      prevNode = prevItem;
      nextNode = currentItem;
      const omittedBackstep = isVertical ? 64 : 120;
      startCoord = (prevItem.classList.contains("is-omitted") ? currentItem[offsetStart] - omittedBackstep : prevItem[offsetStart]) + (prevItem[offsetSize] / 2);
      endCoord = currentItem[offsetStart] + (currentItem[offsetSize] / 2);
      return { startCoord, endCoord, prevNode, nextNode };
    }

    function updateGhostRunner(currentSec) {
      const edgeLeft = document.getElementById("ghost-edge-left");
      const edgeRight = document.getElementById("ghost-edge-right");
      const viewport = document.getElementById("track-viewport");
      const track = document.getElementById("track");

      if (!viewport || !track) return;

      const isVertical = track.classList.contains("vertical");
      const splitsList = getSplitsList();
      const comparisonTimes = getComparisonTimes();
      const currentIndex = getCurrentIndex();

      const activeList = activeGhostComparisons.filter(g => g && g !== "off");
      const rc = getRaceClient();
      const isSim = rc ? (typeof rc.isSimulating === "function" ? rc.isSimulating() : !!rc.isSimulating) : false;
      const isConn = rc ? (typeof rc.isConnected === "function" ? rc.isConnected() : !!rc.isConnected) : false;
      const isRaceActive = isSim || isConn;
      const areRacePinsOn = rc && typeof rc.areRacePinsVisible === "function" ? rc.areRacePinsVisible() : true;
      const raceEntrants = (isRaceActive && areRacePinsOn)
        ? rc.getRankedEntrants().filter(e => !e.isHost && !e.isMuted)
        : [];

      if ((activeList.length === 0 && raceEntrants.length === 0) || currentSec === null || currentSec < 0 || splitsList.length === 0) {
        hideAllGhostMarkers();
        if (edgeLeft) edgeLeft.style.display = "none";
        if (edgeRight) edgeRight.style.display = "none";
        refreshLeaderboard();
        return;
      }

      // Pre-calculate runner's current progress in segment for live delta calculations
      let runnerSegProgress = 0;
      if (currentIndex >= 0 && currentIndex < splitsList.length) {
        const curTarget = comparisonTimes[currentIndex];
        const prevTarget = (currentIndex > 0) ? (comparisonTimes[currentIndex - 1] || 0) : 0;
        const dur = curTarget ? (curTarget - prevTarget) : 0;
        const elapsedInSeg = Math.max(0, currentSec - getLastSplitRecordedSec());
        runnerSegProgress = (dur > 0) ? Math.min(1.0, elapsedInSeg / dur) : 0;
      }

      const scrollOffset = isVertical ? viewport.scrollTop : viewport.scrollLeft;
      const rawSpan = isVertical ? viewport.clientHeight : viewport.clientWidth;
      const clientSpan = (rawSpan > 0) ? rawSpan : ((isVertical ? window.innerHeight : window.innerWidth) || 800);
      const visibleMin = (scrollOffset > 0) ? (scrollOffset + 10) : -20;
      const visibleMax = scrollOffset + clientSpan + 20;

      const nodeStart = document.getElementById("node-start");
      if (!nodeStart) return;

      const leftOffscreenGhosts = [];
      const rightOffscreenGhosts = [];
      const renderedMarkerIds = new Set();
      const visibleOnscreenMarkers = [];
      const segmentCoords = (segIdx) => getSegmentCoords(segIdx, isVertical, nodeStart, splitsList.length);

      // 1. Render active comparison ghosts (WR, PB, Best, Avg, Worst)
      activeList.forEach((gId) => {
        const ghostInfo = getGhostInfo(gId);
        if (!ghostInfo) return;

        const marker = getOrCreateGhostMarker(ghostInfo);
        if (!marker) return;
        renderedMarkerIds.add(marker.id);

        const { segIdx, ratio } = window.LiveSplit.GhostMath.calculateGhostProgress(currentSec, ghostInfo.times);
        const coords = segmentCoords(segIdx);
        if (!coords) {
          marker.style.display = "none";
          return;
        }

        const ghostCoord = coords.startCoord + ratio * (coords.endCoord - coords.startCoord);

        // Compute live delta vs this ghost
        const ghostTimes = ghostInfo.times;
        let ghostTimeAtRunnerPos = 0;
        if (currentIndex >= 0 && currentIndex < ghostTimes.length) {
          const gNext = ghostTimes[currentIndex] ?? comparisonTimes[currentIndex] ?? 0;
          const gPrev = (currentIndex === 0) ? 0 : (ghostTimes[currentIndex - 1] ?? (comparisonTimes[currentIndex - 1] || 0));
          ghostTimeAtRunnerPos = gPrev + runnerSegProgress * (gNext - gPrev);
        } else {
          ghostTimeAtRunnerPos = ghostTimes[ghostTimes.length - 1] || 0;
        }

        const liveDeltaGhost = currentSec - ghostTimeAtRunnerPos;
        const isAhead = (liveDeltaGhost <= 0);
        const deltaStr = formatDeltaSeconds(liveDeltaGhost);

        if (ghostCoord < visibleMin) {
          marker.style.display = "none";
          clearMarkerOffsets(marker);
          leftOffscreenGhosts.push({ ghostInfo, deltaStr, isAhead });
        } else if (ghostCoord > visibleMax) {
          marker.style.display = "none";
          clearMarkerOffsets(marker);
          rightOffscreenGhosts.push({ ghostInfo, deltaStr, isAhead });
        } else {
          visibleOnscreenMarkers.push({
            marker,
            coord: ghostCoord,
            coords
          });
        }
      });

      // 2. Render live race competitors (therun.gg / racetime.gg / simulation)
      const raceMarkers = window.LiveSplit.RaceTrackMarkers;
      if (raceMarkers && typeof raceMarkers.renderRaceCompetitorMarkers === "function") {
        raceMarkers.renderRaceCompetitorMarkers({
          raceEntrants,
          splitsList,
          comparisonTimes,
          currentIndex,
          runnerSegProgress,
          currentSec,
          visibleMin,
          visibleMax,
          getSegmentCoords: segmentCoords,
          formatDeltaSeconds,
          leftOffscreenGhosts,
          rightOffscreenGhosts,
          visibleOnscreenMarkers,
          renderedMarkerIds,
          trackElem: track
        });
        const activeIds = new Set(raceEntrants.map(e => e.userId));
        raceMarkers.removeDanglingRaceMarkers(activeIds);
      }

      // 3. Intelligent Mini-Leaderboard Track Pins with Orthogonal Drop Lines
      if (raceMarkers && typeof raceMarkers.layoutTrackPins === "function") {
        raceMarkers.layoutTrackPins(visibleOnscreenMarkers, {
          isVertical,
          visibleMin,
          visibleMax,
          trackElem: track,
          getNodeTextThreshold
        });
      }

      // Hide static template marker and any marker not in rendered set
      const staticMarker = document.getElementById("ghost-marker");
      if (staticMarker) staticMarker.style.display = "none";
      knownGhostMarkers.forEach((m) => {
        if (m && !renderedMarkerIds.has(m.id)) {
          m.style.display = "none";
        }
      });

      // Off-screen edge pills (left/top and right/bottom)
      renderEdgePill(edgeLeft, leftOffscreenGhosts, isVertical ? "▲" : "❮", true);
      renderEdgePill(edgeRight, rightOffscreenGhosts, isVertical ? "▼" : "❯", false);

      // 4. Render F1 Dynamic Leaderboard
      refreshLeaderboard();
    }

    function updateGhostBadge() {
      const badge = document.getElementById("ghost-badge");
      if (!badge) return;
      const active = activeGhostComparisons.filter(g => g && g !== "off");
      if (active.length === 0) {
        badge.innerText = "Ghost: Off";
        badge.style.color = "rgba(148, 163, 184, 0.9)";
        return;
      }

      const labels = active.map(id => {
        const low = id.toLowerCase();
        if (GHOST_BADGE_LABELS[low]) return GHOST_BADGE_LABELS[low];
        if (low.includes("world record")) return "🏆 WR";
        if (low === "personal best") return "🥈 PB";
        if (low === "best segments") return "⭐ Best";
        if (low === "average segments") return "📊 Avg";
        if (low === "worst segments") return "🐢 Worst";
        return `👤 ${id.slice(0, 8)}`;
      });

      badge.innerText = `Ghost: ${labels.join(" + ")}`;
      badge.style.color = active.includes("wr") ? "#facc15" : (active.includes("pb") ? "#38bdf8" : "#eab308");
    }

    // Persist, refresh badge and markers after the active ghost list changes
    function onActiveGhostsChanged() {
      saveActiveGhostComparisons();
      updateGhostBadge();
      hideAllGhostMarkers();

      const lastElapsedSec = getLastElapsedSec();
      if (activeGhostComparisons.length === 1 && activeGhostComparisons[0] === "off") {
        hideEdgePills();
      } else if (lastElapsedSec > 0) {
        updateGhostRunner(lastElapsedSec);
      }

      if (window.hudLayout && window.hudLayout.syncTrackModalUI) {
        window.hudLayout.syncTrackModalUI();
      }
    }

    function setGhostComparison(val) {
      if (Array.isArray(val)) {
        activeGhostComparisons = val.filter(Boolean);
      } else if (typeof val === "string") {
        if (val.includes(",")) {
          activeGhostComparisons = val.split(",").map(s => s.trim()).filter(Boolean);
        } else {
          activeGhostComparisons = (!val.trim() || val.trim().toLowerCase() === "off") ? ["off"] : [val.trim()];
        }
      } else {
        activeGhostComparisons = ["off"];
      }
      if (activeGhostComparisons.length === 0) {
        activeGhostComparisons = ["off"];
      }
      onActiveGhostsChanged();
    }

    function toggleGhostComparison(ghostId) {
      const id = (ghostId || "").trim();
      if (!id || id === "off") {
        activeGhostComparisons = ["off"];
      } else {
        const list = activeGhostComparisons.filter(g => g !== "off");
        const idx = list.indexOf(id);
        if (idx !== -1) {
          list.splice(idx, 1);
        } else {
          list.push(id);
        }
        activeGhostComparisons = list.length > 0 ? list : ["off"];
      }
      onActiveGhostsChanged();
    }

    function cycleGhostComparison() {
      const curKey = activeGhostComparisons.filter(g => g !== "off").sort().join(",");
      let curIdx = -1;
      GHOST_PRESETS.forEach((p, idx) => {
        const pKey = p.filter(g => g !== "off").sort().join(",");
        if (pKey === curKey) curIdx = idx;
      });

      const nextIdx = (curIdx + 1) % GHOST_PRESETS.length;
      setGhostComparison(GHOST_PRESETS[nextIdx]);
    }

    function setGhostOpacity(pct) {
      const parsed = parseInt(pct, 10);
      if (!isNaN(parsed) && parsed >= 30 && parsed <= 100) {
        ghostOpacity = parsed / 100;
        localStorage.setItem("livesplit_ghost_opacity", parsed.toString());
        const track = document.getElementById("track");
        if (track) track.style.setProperty("--ghost-opacity", ghostOpacity);
      }
    }

    return {
      getPrimaryGhost: () => ghostComparison,
      getActiveGhostComparisons: () => [...activeGhostComparisons],
      getGhostOpacity: () => ghostOpacity,
      clearTextThresholdCache: () => nodeThresholdCache.clear(),
      getNodeTextThreshold,
      getOrCreateGhostMarker,
      refreshLeaderboard,
      hideAllGhostMarkers,
      updateGhostRunner,
      updateGhostBadge,
      setGhostComparison,
      toggleGhostComparison,
      cycleGhostComparison,
      setGhostOpacity
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.GhostRunner = {
    createGhostRunner
  };
})();
