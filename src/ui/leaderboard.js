/**
 * src/ui/leaderboard.js - Live Race F1-Style Leaderboard Controller
 *
 * Renders the timing tower HUD component from the race client's ranked entrants:
 * - Visibility (race active / Layout Mode preview / component hidden) and pre-race detection
 * - Status badge and banners (leaderboard-banners.js)
 * - One row per entrant, described and updated in place (leaderboard-row.js)
 * - Overtake reordering with FLIP animation (leaderboard-flip.js)
 * - Scrolling long names (leaderboard-marquee.js)
 * - Double-click a rival to mute their track pin; Layout Mode preview entrants
 */

(function () {
  "use strict";

  const Row = window.LiveSplit.LeaderboardRow;
  const Banners = window.LiveSplit.LeaderboardBanners;
  const Flip = window.LiveSplit.LeaderboardFlip;

  const rowElementMap = new Map();
  const marquee = window.LiveSplit.LeaderboardMarquee.createMarqueeQueue();
  let isMuteListenerAttached = false;

  /**
   * Returns fallback preview entrants for Edit Mode when not in a race.
   */
  function getPreviewEntrants() {
    const savedName = ((typeof localStorage !== "undefined" && localStorage.getItem(window.LiveSplit.Storage.KEYS.THERUN_USERNAME)) || "").trim();
    const isUrl = savedName.includes("://") || savedName.includes("/");
    const hostDisplayName = (!isUrl && savedName) ? savedName : "You";
    return [
      {
        userId: "prev_speeddemon",
        username: "SpeedDemon",
        avatar: "⚡",
        color: "#06b6d4",
        rank: 1,
        positionDelta: 0,
        positionDeltaDisplay: "-",
        isHost: false,
        isMuted: false,
        segmentRibbon: "gold",
        ribbonSegmentName: "Split 2",
        ribbonSegmentTime: 27.4,
        hasCrown: true,
        crownSegmentName: "Split 2",
        crownSegmentTime: 27.4,
        currentSplitName: "Split 3",
        gapDisplay: "LEADER",
        intervalDisplay: "--",
        expectedSegmentDisplay: "28.5s",
        elapsedSegmentDisplay: "18.2s",
        expectedType: "EXP"
      },
      {
        userId: "you",
        username: hostDisplayName,
        avatar: "",
        color: "#38bdf8",
        rank: 2,
        positionDelta: 2,
        positionDeltaDisplay: "+2",
        isHost: true,
        isMuted: false,
        segmentRibbon: "silver",
        ribbonSegmentName: "Split 2",
        ribbonSegmentTime: 28.1,
        currentSplitName: "Split 2",
        gapDisplay: "+1.4s",
        intervalDisplay: "+1.4s",
        expectedSegmentDisplay: "29.2s",
        elapsedSegmentDisplay: "14.5s",
        expectedType: "EXP"
      },
      {
        userId: "prev_apex",
        username: "ApexRunner",
        avatar: "🏎️",
        color: "#f59e0b",
        rank: 3,
        positionDelta: -1,
        positionDeltaDisplay: "-1",
        isHost: false,
        isMuted: false,
        segmentRibbon: "bronze",
        ribbonSegmentName: "Split 2",
        ribbonSegmentTime: 28.9,
        currentSplitName: "Split 2",
        gapDisplay: "+2.1s",
        intervalDisplay: "+0.7s",
        expectedSegmentDisplay: "30.0s",
        elapsedSegmentDisplay: "12.8s",
        expectedType: "EXP"
      }
    ];
  }

  function getRaceClient() {
    const rc = window.LiveSplit.RaceClient;
    if (!rc) return null;
    return rc.instance || rc;
  }

  /**
   * Initializes double-click listener on leaderboard rows to hide/show runner pin on track.
   */
  function initTileDoubleClickListener(containerEl) {
    if (isMuteListenerAttached || !containerEl) return;

    function handleTileDoubleClick(e) {
      const row = e.target.closest(".leaderboard-row");
      if (!row) return;

      // Don't mute/hide the host runner
      if (row.classList.contains("is-host")) return;

      const userId = row.getAttribute("data-user-id");
      if (!userId) return;

      const rc = getRaceClient();
      if (rc && typeof rc.toggleEntrantMuted === "function") {
        const isNowMuted = rc.toggleEntrantMuted(userId);
        row.classList.toggle("is-muted", isNowMuted);
        row.title = isNowMuted ? "Double-click to show runner pin on track" : "Double-click to hide runner pin on track";

        // Immediately update track pin display (respecting global race pins toggle)
        const marker = document.getElementById(`ghost-marker-race-${userId}`);
        if (marker) {
          const globalPinsOn = typeof rc.areRacePinsVisible === "function" ? rc.areRacePinsVisible() : true;
          marker.style.display = (isNowMuted || !globalPinsOn) ? "none" : "flex";
        }

        // Refresh track pins immediately
        const overlay = window.LiveSplit.Overlay;
        overlay.updateGhostRunner?.(overlay.getLastElapsedSec?.() ?? 0);
      }
    }

    containerEl.addEventListener("dblclick", handleTileDoubleClick);
    isMuteListenerAttached = true;
  }

  function isLayoutComponentVisible() {
    if (window.hudLayout && typeof window.hudLayout.getState === "function") {
      const state = window.hudLayout.getState();
      if (state && state.leaderboard && state.leaderboard.visible === false) return false;
    }
    return true;
  }

  function hasRaceStarted(entrants) {
    return Array.isArray(entrants) && entrants.some(r =>
      (r.currentTimeSec || 0) > 0 ||
      (r.currentSplitIndex || 0) > 0 ||
      (Array.isArray(r.splitTimes) && r.splitTimes.length > 0) ||
      !!r.lastSplitEffect ||
      r.isFinished ||
      r.isDNF
    );
  }

  // Rank 1 at slot 0, Rank 2 at slot 1, ...; DNF runners sink to the bottom
  function sortByRank(entrants) {
    return [...entrants].sort((a, b) => {
      if (a.isDNF && !b.isDNF) return 1;
      if (!a.isDNF && b.isDNF) return -1;
      if (a.isDNF && b.isDNF) return 0;
      return (a.rank || 0) - (b.rank || 0);
    });
  }

  function domOrderMatches(rowsEl, entrants) {
    const currentDomIds = Array.from(rowsEl.children).map(c => c.getAttribute("data-user-id"));
    const desiredDomIds = entrants.map(r => r.userId || "unknown");
    return currentDomIds.length === desiredDomIds.length && currentDomIds.every((id, i) => id === desiredDomIds[i]);
  }

  function renderRow(rowsEl, racer, isPreRace) {
    // A pasted therun.gg URL is never shown as a runner name
    if (racer.username && (String(racer.username).includes("://") || String(racer.username).includes("therun.gg/"))) {
      racer.username = "";
    }
    const d = Row.describeRow(racer, { isPreRace });

    let row = rowElementMap.get(d.userId);
    if (!row || !rowsEl.contains(row)) {
      row = Row.createRowElement(d);
      rowElementMap.set(d.userId, row);
      rowsEl.appendChild(row);
      row.querySelectorAll(".racer-name, .racer-split").forEach((el) => marquee.queue(el));
    } else {
      Row.updateRowElement(row, d, marquee);
    }
    Row.applySplitFlash(row, d);
  }

  function removeDepartedRows(entrants) {
    const activeIds = new Set(entrants.map(r => r.userId));
    rowElementMap.forEach((row, uId) => {
      if (!activeIds.has(uId)) {
        if (row.parentNode) row.parentNode.removeChild(row);
        rowElementMap.delete(uId);
      }
    });
  }

  /**
   * Renders the F1 timing tower standings rows.
   *
   * @param {Array} rankedEntrants - Sorted entrant list from RaceClient
   * @param {boolean|Function} isSimulating - Whether simulation mode is active
   * @param {boolean|Function} isConnected - Whether connected to live race
   * @param {boolean} isEditMode - Whether overlay is in Layout Mode
   */
  function renderLeaderboard(rankedEntrants = [], isSimulating = false, isConnected = false, isEditMode = false) {
    const compEl = document.getElementById("hud-comp-leaderboard");
    const rowsEl = document.getElementById("leaderboard-rows");
    if (!compEl || !rowsEl) return;

    initTileDoubleClickListener(rowsEl);

    const isSim = typeof isSimulating === "function" ? isSimulating() : !!isSimulating;
    const isConn = typeof isConnected === "function" ? isConnected() : !!isConnected;
    const isRaceActive = isSim || isConn;

    if ((!isRaceActive && !isEditMode) || !isLayoutComponentVisible()) {
      compEl.classList.add("is-hidden");
      return;
    }
    compEl.classList.remove("is-hidden");

    const rc = getRaceClient();
    const cdSec = rc && typeof rc.getCountdownSec === "function" ? rc.getCountdownSec() : null;
    const isCountingDown = (cdSec !== null && cdSec >= 0);
    const raceStatus = rc && typeof rc.getRaceStatus === "function" ? rc.getRaceStatus() : "";
    const isPreRace = isRaceActive && !hasRaceStarted(rankedEntrants) &&
      (isCountingDown || raceStatus === "open" || raceStatus === "pending" || raceStatus === "starting" || !raceStatus);
    const isPreRaceLobby = isPreRace && !isCountingDown;

    Banners.renderStatusBadge(document.getElementById("leaderboard-status-badge"), {
      cdSec, isCountingDown, isPreRaceLobby, isSim, isConn, entrants: rankedEntrants
    });

    const rawEntrants = isRaceActive ? rankedEntrants : (isEditMode ? getPreviewEntrants() : rankedEntrants);
    const entrants = sortByRank(rawEntrants);
    const orderMatches = domOrderMatches(rowsEl, entrants);

    const bannerContainer = Banners.getBannerContainer(rowsEl);
    Banners.syncCountdownBanner(bannerContainer, rowsEl, isCountingDown, cdSec);
    const latestEvent = rc && typeof rc.getLatestEvent === "function" ? rc.getLatestEvent() : null;
    Banners.syncLobbyBanner(bannerContainer, rowsEl, isPreRaceLobby, rawEntrants, latestEvent);

    entrants.forEach((racer) => {
      try {
        renderRow(rowsEl, racer, isPreRace);
      } catch (err) {
        console.error("[Leaderboard Row Render Error]", err, racer);
      }
    });

    // Reorder only when slot order changed, so rows that did not move are never detached
    if (!orderMatches) {
      Flip.reorderRowsWithFlip(rowsEl, entrants, rowElementMap);
    }

    removeDepartedRows(entrants);
    marquee.measure();
    Banners.syncWaitingState(rowsEl, isConn && entrants.length === 0);
  }

  function reset() {
    rowElementMap.forEach((row) => {
      if (!row) return;
      Flip.clearSwapStyles(row);
      row.style.transition = "";
      row.style.transform = "";
      row.style.zIndex = "";
      row.style.animationDelay = "";
      row.classList.remove("overtake-flash", ...Row.SPLIT_FLASH_CLASSES);
      delete row.dataset.lastEffectTime;
      const ribbonEl = row.querySelector(".racer-ribbon");
      if (ribbonEl) {
        ribbonEl.className = "racer-ribbon";
        ribbonEl.title = "";
      }
      const splitEl = row.querySelector(".racer-split");
      if (splitEl) {
        splitEl.className = "racer-split";
      }
      const posDeltaEl = row.querySelector(".pos-delta");
      if (posDeltaEl) {
        posDeltaEl.className = "pos-delta delta-same";
        posDeltaEl.textContent = "-";
        posDeltaEl.title = "";
      }
    });
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Leaderboard = {
    renderLeaderboard,
    getPreviewEntrants,
    reset
  };
  window.LiveSplitLeaderboard = window.LiveSplit.Leaderboard;
})();
