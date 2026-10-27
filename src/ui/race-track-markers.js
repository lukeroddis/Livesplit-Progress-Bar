/**
 * src/ui/race-track-markers.js - Live Race Competitor Track Pin Markers & Needle Clustering
 * 
 * Manages DOM element lifecycle, orthogonal drop-lines, needle clustering,
 * off-screen edge indicator pills, and dead-reckoning pin placement for
 * online speedrun race competitors on the overlay's progress track.
 */

(function () {
  "use strict";

  // Cache mapping markerId -> DOM element for zero-allocation 60 FPS animation loop
  const raceMarkerMap = new Map();

  const DOMUtils = (window.LiveSplit && window.LiveSplit.DOMUtils) ? window.LiveSplit.DOMUtils : null;

  /**
   * Safely escapes strings for innerHTML embedding (delegates to LiveSplit.DOMUtils).
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (DOMUtils && typeof DOMUtils.escapeHtml === "function") {
      return DOMUtils.escapeHtml(str);
    }
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/[\x22]/g, "&quot;")
      .replace(/[\x27]/g, "&#039;");
  }

  /**
   * Validates whether an avatar string is a safe remote URL or data image URI.
   * @param {string} rawAvatar
   * @returns {boolean}
   */
  function isSafeAvatarUrl(rawAvatar) {
    if (DOMUtils && typeof DOMUtils.isSafeAvatarUrl === "function") {
      return DOMUtils.isSafeAvatarUrl(rawAvatar);
    }
    return typeof rawAvatar === "string" && (
      rawAvatar.startsWith("https://") ||
      rawAvatar.startsWith("http://") ||
      rawAvatar.startsWith("data:image/")
    );
  }

  /**
   * Retrieves or creates a cached competitor track marker element.
   * 
   * @param {Object} racer - Entrant telemetry object
   * @param {HTMLElement} [trackElem] - Optional track container DOM element
   * @returns {HTMLElement|null}
   */
  function getOrCreateRaceMarker(racer, trackElem) {
    if (!racer || !racer.userId) return null;
    const markerId = `ghost-marker-race-${racer.userId}`;
    let marker = raceMarkerMap.get(markerId);
    if (!marker || !document.contains(marker)) {
      marker = document.getElementById(markerId);
      if (marker) raceMarkerMap.set(markerId, marker);
    }
    const track = trackElem || document.getElementById("track");
    if (!track) return null;

    const color = racer.color || "#38bdf8";
    const rawAvatar = racer.avatar || "";
    const isSafeImg = isSafeAvatarUrl(rawAvatar);
    const isLikelyUrl = typeof rawAvatar === "string" && (
      rawAvatar.includes(":") || rawAvatar.includes("/")
    );
    const fallbackIcon = rawAvatar && !isLikelyUrl ? rawAvatar : "🏎️";
    const avatarHtml = isSafeImg
      ? `<img class="racer-avatar-img" src="${escapeHtml(rawAvatar)}" alt="" />`
      : `<span class="ghost-icon racer-avatar">${escapeHtml(fallbackIcon)}</span>`;

    if (!marker) {
      marker = document.createElement("div");
      marker.id = markerId;
      marker.className = "ghost-marker race-competitor";
      marker.style.setProperty("--racer-color", color);
      marker.innerHTML = `
        <div class="ghost-icon-wrap racer-avatar-wrap">${avatarHtml}</div>
        <div class="ghost-needle racer-needle"></div>
        <div class="racer-tag">${escapeHtml(racer.username || "")}</div>
      `;
      track.appendChild(marker);
      raceMarkerMap.set(markerId, marker);
    } else {
      if (!track.contains(marker)) {
        track.appendChild(marker);
      }
      marker.style.setProperty("--racer-color", color);
      const wrap = marker.querySelector(".racer-avatar-wrap");
      if (wrap) wrap.innerHTML = avatarHtml;
      const tag = marker.querySelector(".racer-tag");
      if (tag && tag.textContent !== (racer.username || "")) {
        tag.textContent = racer.username || "";
      }
    }
    if (racer.isDNF) {
      marker.classList.add("is-dnf");
    } else {
      marker.classList.remove("is-dnf");
    }
    return marker;
  }

  /**
   * Prunes competitor markers from DOM whose racers are no longer present in the race room.
   * @param {Set|Array} activeEntrantIds - Set or array of active entrant userIds
   */
  function removeDanglingRaceMarkers(activeEntrantIds) {
    const idSet = activeEntrantIds instanceof Set ? activeEntrantIds : new Set(activeEntrantIds || []);
    for (const [markerId, marker] of raceMarkerMap.entries()) {
      const userId = markerId.replace(/^ghost-marker-race-/, "");
      if (!idSet.has(userId)) {
        if (marker && marker.parentNode) {
          marker.parentNode.removeChild(marker);
        }
        raceMarkerMap.delete(markerId);
      }
    }
  }

  /**
   * Sets display: none on all cached race competitor markers and removes splay styling.
   */
  function hideAllRaceMarkers() {
    raceMarkerMap.forEach((marker) => {
      if (marker) {
        marker.style.display = "none";
        marker.style.removeProperty("--ghost-stack-offset");
        marker.style.removeProperty("--ghost-splay-x");
        marker.style.removeProperty("--ghost-needle-angle");
        marker.style.removeProperty("--ghost-needle-height");
        marker.classList.remove("splay-left", "splay-right");
      }
    });
  }

  /**
   * Calculates continuous comparison time for a fractional split score.
   * @param {number} sc - Split score (e.g. 2.45)
   * @param {Array<number>} comparisonTimes - Target split times in seconds
   * @returns {number}
   */
  function getCompetitorTrackRef(sc, comparisonTimes) {
    const s = Math.max(0, sc || 0);
    const idx = Math.floor(s);
    const rat = Math.max(0, Math.min(1.0, s - idx));
    const times = Array.isArray(comparisonTimes) ? comparisonTimes : [];
    const tP = idx > 0 ? (times[idx - 1] || (idx * 30)) : 0;
    const tN = (idx < times.length) ? (times[idx] || ((idx + 1) * 30)) : (tP + 30);
    return tP + rat * (tN - tP);
  }

  // racer -> { splits, track, index }: their checkpoints mapped onto the local track
  const trackMapCache = new WeakMap();

  /**
   * Maps a racer's score (in their own splits) onto the local track when their splits
   * file has a different number of splits: each of their splits spans the local splits
   * it was matched to by name (RaceRanking.mapCheckpointsToCourse).
   * @param {Object} racer - Race entrant with totalSplits, splits and score
   * @param {Array} splitsList - Local split names
   * @returns {number} Score in local track splits
   */
  function mapRacerScoreToTrack(racer, splitsList) {
    const rr = window.LiveSplit.RaceRanking;
    const ownCount = racer.totalSplits;
    const numSplits = splitsList.length;
    let cached = trackMapCache.get(racer);
    if (!cached || cached.splits !== racer.splits || cached.track !== splitsList || cached.index.length !== ownCount) {
      const nameOf = s => rr.normalizeSplitName(typeof s === "string" ? s : (s && (s.name || s.splitName)));
      const ownNames = Array.isArray(racer.splits) ? racer.splits.map(nameOf) : [];
      const trackNames = splitsList.map(nameOf);
      cached = { splits: racer.splits, track: splitsList, index: rr.mapCheckpointsToCourse(ownNames, ownCount, trackNames, numSplits).index };
      trackMapCache.set(racer, cached);
    }
    const score = Math.max(0, racer.score || 0);
    const sIdx = Math.min(ownCount - 1, Math.floor(score));
    const frac = Math.min(1, score - sIdx);
    const start = sIdx > 0 ? cached.index[sIdx - 1] + 1 : 0;
    const end = cached.index[sIdx] + 1;
    return start + frac * (end - start);
  }

  /**
   * Evaluates race competitor positions, creates/updates markers, and segregates
   * markers into on-screen and off-screen collections.
   * 
   * @param {Object} params
   */
  function renderRaceCompetitorMarkers(params) {
    const {
      raceEntrants,
      splitsList,
      comparisonTimes,
      currentIndex,
      runnerSegProgress,
      currentSec,
      visibleMin,
      visibleMax,
      getSegmentCoords,
      formatDeltaSeconds,
      leftOffscreenGhosts,
      rightOffscreenGhosts,
      visibleOnscreenMarkers,
      renderedMarkerIds,
      trackElem
    } = params;

    if (!Array.isArray(raceEntrants) || raceEntrants.length === 0 || !splitsList || splitsList.length === 0) {
      return;
    }

    const numSplits = splitsList.length;

    raceEntrants.forEach((racer) => {
      let segIdx = 0;
      let ratio = 0;

      if (racer.isFinished) {
        segIdx = numSplits - 1;
        ratio = 1.0;
      } else if (racer.isDNF && typeof racer.dnfScore === "number") {
        segIdx = Math.floor(racer.dnfScore);
        ratio = racer.dnfScore - segIdx;
      } else if (racer.totalSplits > 0 && racer.totalSplits !== numSplits) {
        // Split count mismatch: place the racer on the local split matching theirs
        const mappedScore = Math.max(0, Math.min(numSplits - 0.001, mapRacerScoreToTrack(racer, splitsList)));
        segIdx = Math.floor(mappedScore);
        ratio = mappedScore - segIdx;
      } else {
        segIdx = Math.floor(racer.score || 0);
        ratio = (racer.score || 0) - segIdx;
      }
      segIdx = Math.max(0, Math.min(numSplits - 1, segIdx));
      ratio = Math.max(0, Math.min(1.0, ratio));

      const coords = typeof getSegmentCoords === "function" ? getSegmentCoords(segIdx) : null;
      if (!coords) return;

      const marker = getOrCreateRaceMarker(racer, trackElem);
      if (!marker) return;
      if (renderedMarkerIds) renderedMarkerIds.add(marker.id);

      const ghostCoord = coords.startCoord + ratio * (coords.endCoord - coords.startCoord);

      // Racer progress in local track splits (score is in the racer's own splits)
      const trackScore = racer.isFinished ? numSplits : segIdx + ratio;
      const hostScore = Math.max(0, currentIndex) + runnerSegProgress;
      const isAhead = (hostScore >= trackScore);

      const hostCourseSec = getCompetitorTrackRef(hostScore, comparisonTimes);
      const racerCourseSec = racer.isFinished && typeof racer.finalTimeSec === "number"
        ? racer.finalTimeSec
        : getCompetitorTrackRef(trackScore, comparisonTimes);
      const deltaSec = currentSec - (racer.currentTimeSec || 0) !== 0 && hostScore === trackScore
        ? 0
        : (hostCourseSec - racerCourseSec);
      const deltaStr = typeof formatDeltaSeconds === "function" ? formatDeltaSeconds(-deltaSec) : `${-deltaSec.toFixed(1)}s`;

      if (ghostCoord < visibleMin) {
        marker.style.display = "none";
        marker.style.removeProperty("--ghost-stack-offset");
        marker.style.removeProperty("--ghost-splay-x");
        marker.style.removeProperty("--ghost-needle-angle");
        marker.style.removeProperty("--ghost-needle-height");
        if (leftOffscreenGhosts) {
          leftOffscreenGhosts.push({
            ghostInfo: { id: racer.userId, icon: racer.avatar || "🏎️", color: racer.color },
            deltaStr,
            isAhead
          });
        }
      } else if (ghostCoord > visibleMax) {
        marker.style.display = "none";
        marker.style.removeProperty("--ghost-stack-offset");
        marker.style.removeProperty("--ghost-splay-x");
        marker.style.removeProperty("--ghost-needle-angle");
        marker.style.removeProperty("--ghost-needle-height");
        if (rightOffscreenGhosts) {
          rightOffscreenGhosts.push({
            ghostInfo: { id: racer.userId, icon: racer.avatar || "🏎️", color: racer.color },
            deltaStr,
            isAhead
          });
        }
      } else {
        if (visibleOnscreenMarkers) {
          visibleOnscreenMarkers.push({
            marker,
            coord: ghostCoord,
            coords
          });
        }
      }
    });
  }

  /**
   * Intelligently lays out visible on-screen pins with orthogonal leader lines
   * and non-overlapping mini-leaderboard cluster merging.
   * 
   * @param {Array<Object>} visibleOnscreenMarkers - On-screen marker objects
   * @param {Object} options - Layout configuration options
   */
  function layoutTrackPins(visibleOnscreenMarkers, options = {}) {
    if (!Array.isArray(visibleOnscreenMarkers) || visibleOnscreenMarkers.length === 0) {
      return;
    }

    const {
      isVertical = false,
      visibleMin = -20,
      visibleMax = 1200,
      trackElem = document.getElementById("track"),
      getNodeTextThreshold
    } = options;

    const configuredPinSize = trackElem ? (parseFloat(getComputedStyle(trackElem).getPropertyValue("--ghost-pin-size")) || 26) : 26;
    const COLLISION_THRESHOLD = configuredPinSize + 2; // px - zero overlap

    visibleOnscreenMarkers.sort((a, b) => {
      if (Math.abs(a.coord - b.coord) > 0.001) {
        return a.coord - b.coord;
      }
      const idA = a.marker?.id || "";
      const idB = b.marker?.id || "";
      return idA.localeCompare(idB);
    });

    if (isVertical) {
      // In vertical track orientation, tier pins horizontally to the right
      const activeTiers = [];
      visibleOnscreenMarkers.forEach((item) => {
        let tier = 0;
        while (activeTiers[tier] !== undefined && (item.coord - activeTiers[tier]) < COLLISION_THRESHOLD) {
          tier++;
        }
        tier = Math.min(tier, 2);
        activeTiers[tier] = item.coord;

        const marker = item.marker;
        if (!marker) return;
        marker.style.display = "flex";
        const offsetX = tier * (configuredPinSize + 2);
        marker.style.transform = `translateY(${item.coord}px) translateY(-50%) translateX(calc(-50% + ${offsetX}px))`;
        marker.style.zIndex = `${20 + tier}`;
        marker.style.removeProperty("--ghost-stack-offset");
        marker.style.removeProperty("--ghost-splay-x");
        marker.style.removeProperty("--ghost-needle-angle");
        marker.style.removeProperty("--ghost-needle-height");
        marker.classList.remove("splay-left", "splay-right");
      });
    } else {
      // Horizontal track orientation: Globally Non-Overlapping Mini-Leaderboard Strip with Orthogonal Drop Lines
      const leftBound = visibleMin + (configuredPinSize / 2) + 2;
      const rightBound = visibleMax - (configuredPinSize / 2) - 2;
      const maxAllowedSpan = Math.max(1, rightBound - leftBound);

      let badgeSpacing = configuredPinSize + 2;
      const totalPins = visibleOnscreenMarkers.length;
      if (totalPins > 1 && (totalPins - 1) * badgeSpacing > maxAllowedSpan) {
        badgeSpacing = Math.max(12, maxAllowedSpan / (totalPins - 1));
      }

      const getClusterSpan = (c) => (c.items.length - 1) * badgeSpacing;
      const getClusterRawCenter = (c) => c.items.reduce((acc, it) => acc + it.coord, 0) / c.items.length;
      const getClusterClampedCenter = (c) => {
        const span = getClusterSpan(c);
        let center = getClusterRawCenter(c);
        const half = span / 2;
        if (center - half < leftBound) center = leftBound + half;
        if (center + half > rightBound) center = rightBound - half;
        return center;
      };
      const getClusterFirstBadge = (c) => getClusterClampedCenter(c) - getClusterSpan(c) / 2;
      const getClusterLastBadge = (c) => getClusterClampedCenter(c) + getClusterSpan(c) / 2;

      // 1. Initialize each marker as its own cluster
      let clusters = visibleOnscreenMarkers.map((item) => ({
        items: [item]
      }));

      // 2. Iteratively merge any adjacent clusters whose badge bounds overlap (< badgeSpacing)
      let merged = true;
      let iterations = 0;
      while (merged && iterations < 50) {
        merged = false;
        iterations++;
        const nextClusters = [];
        let i = 0;
        while (i < clusters.length) {
          if (i < clusters.length - 1) {
            const cA = clusters[i];
            const cB = clusters[i + 1];
            if (getClusterFirstBadge(cB) - getClusterLastBadge(cA) < badgeSpacing - 0.5) {
              nextClusters.push({
                items: cA.items.concat(cB.items)
              });
              i += 2;
              merged = true;
              continue;
            }
          }
          nextClusters.push(clusters[i]);
          i++;
        }
        clusters = nextClusters;
      }

      let globalIndex = 0;

      clusters.forEach((cluster) => {
        const N = cluster.items.length;
        const center = getClusterClampedCenter(cluster);
        const span = getClusterSpan(cluster);

        const badgePositions = [];
        for (let k = 0; k < N; k++) {
          badgePositions.push(center - (span / 2) + k * badgeSpacing);
        }

        cluster.items.forEach((item, k) => {
          const marker = item.marker;
          if (!marker) return;
          marker.style.display = "flex";
          marker.style.transform = `translateX(${item.coord}px) translateX(-50%)`;

          // Leader (on right) has highest z-index so badges layer naturally
          const iconWrap = marker.querySelector(".ghost-icon-wrap");
          if (iconWrap) iconWrap.style.zIndex = `${30 + globalIndex}`;
          globalIndex++;

          const deltaX = Math.round((badgePositions[k] - item.coord) * 10) / 10;

          if (item.coords && typeof getNodeTextThreshold === "function") {
            const distPrev = Math.abs(item.coord - item.coords.startCoord);
            const distNext = Math.abs(item.coords.endCoord - item.coord);
            const prevThreshold = getNodeTextThreshold(item.coords.prevNode, false);
            const nextThreshold = getNodeTextThreshold(item.coords.nextNode, true);
            const isHoveringText = (distPrev < prevThreshold || distNext < nextThreshold);
            marker.classList.toggle("compact", isHoveringText);
          }

          marker.style.removeProperty("--ghost-needle-angle");
          marker.style.removeProperty("--ghost-stack-offset");
          marker.style.removeProperty("--ghost-needle-height");

          if (deltaX > 1) {
            marker.style.setProperty("--ghost-splay-x", `${deltaX}px`);
            marker.classList.add("splay-right");
            marker.classList.remove("splay-left");
          } else if (deltaX < -1) {
            marker.style.setProperty("--ghost-splay-x", `${deltaX}px`);
            marker.classList.add("splay-left");
            marker.classList.remove("splay-right");
          } else {
            marker.style.removeProperty("--ghost-splay-x");
            marker.classList.remove("splay-left", "splay-right");
          }
        });
      });
    }
  }

  /**
   * Clears all cached markers and removes them from the DOM.
   */
  function clearMarkers() {
    raceMarkerMap.forEach((marker) => {
      if (marker && marker.parentNode) {
        marker.parentNode.removeChild(marker);
      }
    });
    raceMarkerMap.clear();
  }

  // Export to namespace and window
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceTrackMarkers = {
    getOrCreateRaceMarker,
    removeDanglingRaceMarkers,
    hideAllRaceMarkers,
    getCompetitorTrackRef,
    mapRacerScoreToTrack,
    renderRaceCompetitorMarkers,
    layoutTrackPins,
    clearMarkers,
    getMarkerMap: () => raceMarkerMap
  };

  // Global backward compatibility export for layout, overlay, and tests
  window.getOrCreateRaceMarker = getOrCreateRaceMarker;
})();
