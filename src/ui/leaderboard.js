/**
 * src/ui/leaderboard.js - Live Race F1-Style Dynamic Leaderboard Controller
 * 
 * Manages the timing tower HUD component:
 * - Entrant standings sorted by race position (P1, P2, P3...)
 * - Instantaneous, compositor-driven slot position swapping during overtakes
 * - Dynamic leader gap (+X.Xs) and interval to car ahead (+Y.Ys)
 * - Click-to-mute individual competitor pins on the progress track
 * - Layout Mode preview generation and seamless component integration
 */

(function () {
  "use strict";

  const rowElementMap = new Map();
  let isMuteListenerAttached = false;

  const DOMUtils = (window.LiveSplit && window.LiveSplit.DOMUtils) ? window.LiveSplit.DOMUtils : null;

  /**
   * Escapes HTML strings to prevent XSS (delegates to LiveSplit.DOMUtils).
   */
  function escapeHtml(str) {
    if (DOMUtils && typeof DOMUtils.escapeHtml === "function") {
      return DOMUtils.escapeHtml(str);
    }
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/[\x22]/g, "&quot;")
      .replace(/[\x27]/g, "&#039;");
  }

  /**
   * Formats segment duration seconds for ribbon tooltips ("27.4s", "1:05", "1:10:00").
   */
  function formatSegmentDuration(sec) {
    if (typeof sec !== "number" || isNaN(sec)) return sec || "--";
    const clamped = Math.max(0, sec);
    const totalSec = Math.floor(clamped);
    if (totalSec < 60) {
      const subMin = Math.min(59.9, Math.round(clamped * 10) / 10);
      return `${subMin.toFixed(1)}s`;
    }
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const sPad = s < 10 ? `0${s}` : `${s}`;
    if (h > 0) {
      const mPad = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mPad}:${sPad}`;
    }
    return `${m}:${sPad}`;
  }

  /**
   * Formats gap / delta seconds for leaderboard display ("-2.4s", "+1:12").
   */
  const formatGapTime = formatSegmentDuration;

  /**
   * Builds avatar HTML markup for an entrant.
   */

  function buildAvatarMarkup(avatar, isHost) {
    const fallback = isHost ? "👤" : "🏎️";
    if (DOMUtils && typeof DOMUtils.buildAvatarMarkup === "function") {
      return DOMUtils.buildAvatarMarkup(avatar, fallback);
    }
    const raw = typeof avatar === "string" ? avatar : "";
    const isSafeImg = (
      raw.startsWith("https://") ||
      raw.startsWith("http://") ||
      raw.startsWith("data:image/")
    );
    if (isSafeImg) {
      return `<img class="racer-avatar-img" src="${escapeHtml(raw)}" alt="" />`;
    }
    const isLikelyUrl = raw.includes(":") || raw.includes("/");
    const fb = isLikelyUrl ? fallback : (raw || fallback);
    return `<span class="racer-avatar-emoji">${escapeHtml(fb)}</span>`;
  }

  /**
   * Returns fallback preview entrants for Edit Mode when not in a race.
   */
  function getPreviewEntrants() {
    const savedName = ((typeof localStorage !== "undefined" && localStorage.getItem("therun_username")) || "").trim();
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
    if (typeof window === "undefined") return null;
    const rc = window.LiveSplit && window.LiveSplit.RaceClient ? window.LiveSplit.RaceClient : window.LiveSplitRaceClient;
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
        if (typeof window.updateGhostRunner === "function") {
          const curSec = (window.LiveSplit && typeof window.LiveSplit.getLastElapsedSec === "function")
            ? window.LiveSplit.getLastElapsedSec()
            : ((typeof window.getLastElapsedSec === "function") ? window.getLastElapsedSec() : (window.lastElapsedSec || 0));
          window.updateGhostRunner(curSec);
        }
      }
    }

    containerEl.addEventListener("dblclick", handleTileDoubleClick);
    isMuteListenerAttached = true;
  }

  /**
   * Renders the F1 timing tower standings rows.
   * 
   * @param {Array} rankedEntrants - Sorted entrant list from RaceClient
   * @param {boolean} isSimulating - Whether simulation mode is active
   * @param {boolean} isConnected - Whether connected to live race
   * @param {boolean} isEditMode - Whether overlay is in Layout Mode
   */
  function renderLeaderboard(rankedEntrants = [], isSimulating = false, isConnected = false, isEditMode = false) {
    const compEl = document.getElementById("hud-comp-leaderboard");
    const rowsEl = document.getElementById("leaderboard-rows");
    const statusBadge = document.getElementById("leaderboard-status-badge");

    if (!compEl || !rowsEl) return;

    initTileDoubleClickListener(rowsEl);

    const isSim = typeof isSimulating === "function" ? isSimulating() : !!isSimulating;
    const isConn = typeof isConnected === "function" ? isConnected() : !!isConnected;
    const isRaceActive = isSim || isConn;

    let isLayoutVisible = true;
    if (window.hudLayout && typeof window.hudLayout.getState === "function") {
      const state = window.hudLayout.getState();
      if (state && state.leaderboard && state.leaderboard.visible === false) {
        isLayoutVisible = false;
      }
    }

    // Component visibility rules
    if ((!isRaceActive && !isEditMode) || !isLayoutVisible) {
      compEl.classList.add("is-hidden");
      return;
    }

    compEl.classList.remove("is-hidden");

    const rc = getRaceClient();
    const cdSec = rc && typeof rc.getCountdownSec === "function" ? rc.getCountdownSec() : null;
    const isCountingDown = (cdSec !== null && cdSec >= 0);
    const hasAnyRunnerStarted = Array.isArray(rankedEntrants) && rankedEntrants.some(r =>
      (r.currentTimeSec || 0) > 0 ||
      (r.currentSplitIndex || 0) > 0 ||
      (Array.isArray(r.splitTimes) && r.splitTimes.length > 0) ||
      !!r.lastSplitEffect ||
      r.isFinished ||
      r.isDNF
    );
    const raceStatus = rc && typeof rc.getRaceStatus === "function" ? rc.getRaceStatus() : "";
    const isPreRace = (isConn || isSim) && !hasAnyRunnerStarted && (isCountingDown || raceStatus === "open" || raceStatus === "pending" || raceStatus === "starting" || !raceStatus);
    const isPreRaceLobby = isPreRace && !isCountingDown;

    // Update status badge
    if (statusBadge) {
      if (isCountingDown) {
        statusBadge.innerText = cdSec > 0 ? `START ${cdSec}s` : "GO!";
        statusBadge.className = "leaderboard-status status-countdown";
      } else if (isPreRaceLobby) {
        statusBadge.innerText = "LOBBY";
        statusBadge.className = "leaderboard-status status-lobby";
      } else if (isSim) {
        if (rankedEntrants.length > 0 && rankedEntrants.every(r => r.isFinished || r.isDNF)) {
          statusBadge.innerText = "FINISHED";
          statusBadge.className = "leaderboard-status status-finished";
        } else {
          statusBadge.innerText = "SIM";
          statusBadge.className = "leaderboard-status status-sim";
        }
      } else if (isConn) {
        if (rankedEntrants.length > 0 && rankedEntrants.every(r => r.isFinished || r.isDNF)) {
          statusBadge.innerText = "FINISHED";
          statusBadge.className = "leaderboard-status status-finished";
        } else {
          statusBadge.innerText = "LIVE";
          statusBadge.className = "leaderboard-status status-live";
        }
      } else {
        statusBadge.innerText = "PREVIEW";
        statusBadge.className = "leaderboard-status status-preview";
      }
    }

    const rawEntrants = isRaceActive
      ? rankedEntrants
      : (isEditMode ? getPreviewEntrants() : rankedEntrants);

    // Ensure entrants is strictly sorted by rank ascending (Rank 1 at slot 0, Rank 2 at slot 1, etc.)
    const entrants = [...rawEntrants].sort((a, b) => {
      if (a.isDNF && !b.isDNF) return 1;
      if (!a.isDNF && b.isDNF) return -1;
      if (a.isDNF && b.isDNF) return 0;
      return (a.rank || 0) - (b.rank || 0);
    });

    // Check if the current DOM order of elements matches the desired rank order
    const currentDomIds = Array.from(rowsEl.children).map(c => c.getAttribute("data-user-id"));
    const desiredDomIds = entrants.map(r => r.userId || "unknown");
    const domOrderMatches = (currentDomIds.length === desiredDomIds.length) &&
      currentDomIds.every((id, i) => id === desiredDomIds[i]);

    const raceBoardEl = document.getElementById("race-leaderboard");
    const bannerContainer = (raceBoardEl && rowsEl && raceBoardEl.contains(rowsEl))
      ? raceBoardEl
      : ((rowsEl && rowsEl.parentNode) ? rowsEl.parentNode : raceBoardEl);

    // Countdown Banner (3, 2, 1, GO!)
    let cdBanner = bannerContainer ? bannerContainer.querySelector(".leaderboard-countdown-banner") : null;
    if (isCountingDown && bannerContainer) {
      if (!cdBanner) {
        cdBanner = document.createElement("div");
        cdBanner.className = "leaderboard-countdown-banner";
        if (rowsEl && bannerContainer.contains(rowsEl)) {
          bannerContainer.insertBefore(cdBanner, rowsEl);
        } else {
          bannerContainer.appendChild(cdBanner);
        }
      }
      if (cdSec > 0) {
        cdBanner.className = "leaderboard-countdown-banner is-counting";
        cdBanner.innerHTML = `<span class="cd-icon">&#9201;</span><span class="cd-label">RACE STARTING IN</span><strong class="cd-num">${cdSec}s</strong>`;
      } else {
        cdBanner.className = "leaderboard-countdown-banner is-go";
        cdBanner.innerHTML = `<span class="cd-icon">&#128640;</span><strong class="cd-go">GO! GO! GO!</strong>`;
      }
    } else if (cdBanner) {
      cdBanner.remove();
    }

    // Lobby Banner (e.g. 2/3 Runners Ready or recent join/unready event)
    let lobbyBanner = bannerContainer ? bannerContainer.querySelector(".leaderboard-lobby-banner") : null;
    if (isPreRaceLobby && !isCountingDown && rawEntrants.length > 0 && bannerContainer) {
      const readyCount = rawEntrants.filter(r => r.isReady === true || String(r.status || "").toLowerCase() === "ready").length;
      const latestEvt = rc && typeof rc.getLatestEvent === "function" ? rc.getLatestEvent() : null;
      const hasRecentEvt = latestEvt && (Date.now() - latestEvt.timestamp) < 5000;

      if (!lobbyBanner) {
        lobbyBanner = document.createElement("div");
        lobbyBanner.className = "leaderboard-lobby-banner";
        if (rowsEl && bannerContainer.contains(rowsEl)) {
          bannerContainer.insertBefore(lobbyBanner, rowsEl);
        } else {
          bannerContainer.appendChild(lobbyBanner);
        }
      }
      if (hasRecentEvt) {
        let evtIcon = "&#128100;";
        if (latestEvt.type === "ready") evtIcon = "&#9989;";
        else if (latestEvt.type === "unready") evtIcon = "&#9203;";
        else if (latestEvt.type === "leave") evtIcon = "&#128682;";
        else if (latestEvt.type === "join") evtIcon = "&#128100;";
        lobbyBanner.innerHTML = `<span class="lobby-banner-icon">${evtIcon}</span><span class="lobby-banner-text">${escapeHtml(latestEvt.text || "")}</span>`;
      } else {
        lobbyBanner.innerHTML = `<span class="lobby-banner-icon">&#128101;</span><span class="lobby-banner-text"><strong>${readyCount}/${rawEntrants.length}</strong> Runners Ready</span>`;
      }
    } else if (lobbyBanner) {
      lobbyBanner.remove();
    }

    // -------------------------------------------------------------
    // In-place update of rows and append in strict rank order
    // -------------------------------------------------------------
    entrants.forEach((racer) => {
      try {
      const uId = racer.userId || "unknown";
      const isHost = !!racer.isHost;
      const isMuted = !!racer.isMuted;
      const isDnf = !!racer.isDNF;
      const rank = isDnf ? "DNF" : (racer.rank || 1);
      const posClass = isDnf ? "pos-dnf" : `pos-${(typeof rank === 'number' && rank <= 3) ? rank : 'other'}`;
      const posDelta = (!isDnf && typeof racer.positionDelta === "number" && !isNaN(racer.positionDelta))
        ? Math.trunc(racer.positionDelta)
        : 0;
      const racerStatus = String(racer.status || "").toLowerCase();
      const isReady = racer.isReady === true || racerStatus === "ready";
      if (racer.username && (String(racer.username).includes("://") || String(racer.username).includes("therun.gg/"))) {
        racer.username = "";
      }
      const displayName = racer.username || (isHost ? "You" : "Runner");
      let deltaClass = "pos-delta delta-same";
      let deltaText = "-";
      let deltaTooltip = "No position change on last split";
      if (isDnf) {
        deltaClass = "pos-delta delta-dnf";
        deltaText = "-";
        deltaTooltip = "Did not finish";
      } else if (isPreRace) {
        if (isReady) {
          deltaClass = "pos-delta delta-ready";
          deltaText = "✓";
          deltaTooltip = `${displayName} is ready to race`;
        } else {
          deltaClass = "pos-delta delta-joined";
          deltaText = "⏳";
          deltaTooltip = `${displayName} has joined (not ready)`;
        }
      } else if (posDelta > 0) {
        deltaClass = "pos-delta delta-up";
        deltaText = `▲+${posDelta}`;
        deltaTooltip = `Moved up ${posDelta} ${posDelta === 1 ? "place" : "places"}`;
      } else if (posDelta < 0) {
        deltaClass = "pos-delta delta-down";
        deltaText = `▼${posDelta}`;
        deltaTooltip = `Dropped ${Math.abs(posDelta)} ${Math.abs(posDelta) === 1 ? "place" : "places"}`;
      }
      const color = racer.color || (isHost ? "#38bdf8" : "#94a3b8");
      let splitLabel = isDnf ? "DNF" : (racer.isFinished ? "FINISHED" : (racer.currentSplitName || `Split ${racer.currentSplitIndex + 1 || 1}`));
      if (isPreRace) {
        splitLabel = (racer.currentSplitName && racer.currentSplitName !== "Ready" && racer.currentSplitName !== "Joined")
          ? racer.currentSplitName
          : "Split 1";
      }

      const hasPbDelta = typeof racer.deltaSec === "number" && !isNaN(racer.deltaSec);
      const pbDeltaText = hasPbDelta
        ? (racer.deltaSec <= 0 ? `-${formatGapTime(Math.abs(racer.deltaSec))}` : `+${formatGapTime(racer.deltaSec)}`)
        : "";
      const pbDeltaClass = hasPbDelta
        ? (racer.deltaSec <= 0 ? "racer-pb-delta delta-ahead" : "racer-pb-delta delta-behind")
        : "";

      const rawGap = racer.gapDisplay || (rank === 1 ? "LEADER" : "--");
      let gapVal = isDnf ? "DNF" : ((rank === 1) ? "LEADER" : rawGap);
      if (isPreRace) {
        gapVal = isReady ? "READY" : "JOINED";
      }
      const expType = racer.expectedType || (racer.isFinished ? "FIN" : "EXP");
      const expVal = racer.expectedSegmentDisplay || "--";
      const elapsedVal = racer.elapsedSegmentDisplay || "--";

      let expMarkup = "--";
      if (isPreRace) {
        if (typeof racer.pbSec === "number" && racer.pbSec > 0) {
          expMarkup = `<span class="expected-tag interval-tag">PB</span>${escapeHtml(formatSegmentDuration(racer.pbSec))}`;
        } else {
          expMarkup = "--";
        }
      } else
      if (racer.isFinished) {
        expMarkup = `<span class="expected-tag interval-tag">FIN</span>${escapeHtml(expVal)}`;
      } else if (expVal !== "--") {
        const deltaTag = hasPbDelta ? `<span class="${pbDeltaClass}">${escapeHtml(pbDeltaText)}</span><span class="racer-slash">/</span>` : "";
        expMarkup = `${deltaTag}<span class="racer-elapsed">${escapeHtml(elapsedVal)}</span><span class="racer-slash">/</span><span class="expected-tag interval-tag">${expType}</span>${escapeHtml(expVal)}`;
      } else if (hasPbDelta) {
        expMarkup = `<span class="${pbDeltaClass}">${escapeHtml(pbDeltaText)}</span>`;
      }

      const expSource = racer.hasStatisticalPrediction ? "therun.gg prediction" : "PB segment";
      const pbDeltaInfo = hasPbDelta ? ` | PB Delta: ${pbDeltaText}` : "";
      const gapTooltip = isPreRace
        ? (isReady ? `${displayName} is Ready` : `${displayName} has Joined (Not Ready)`)
        : (rank === 1)
        ? `Race Leader${pbDeltaInfo} | Segment: ${elapsedVal} / ${expVal} (${expSource})`
        : (gapVal === "--" ? `Split 1 in progress${pbDeltaInfo} | Segment: ${elapsedVal} / ${expVal} (${expSource})` : `Leader Gap: ${gapVal}${pbDeltaInfo} | Segment: ${elapsedVal} / ${expVal} (${expSource})`);

      // Split completion glow pulse (Gold / Green / Red) and Split Name Phase Transition (4 seconds total)
      const effect = racer.lastSplitEffect;
      const effectAge = effect ? (Date.now() - (effect.timestamp || 0)) : Infinity;
      const isEffectActive = !isDnf && effect && effect.type && effectAge >= 0 && effectAge < 4000;
      const targetClass = isEffectActive ? `split-flash-${effect.type}` : null;

      // Determine active split text and styling based on 3-phase transition over 4 seconds:
      // Phase 1 (0ms - 2000ms): Display completed split name in celebratory gold/green/red
      // Phase 2 (2000ms - 2500ms): Gradual fade out of completed split name
      // Phase 3 (2500ms - 4000ms): Smooth scroll and fade in of incoming new split name in neutral color
      let displayedSplit = splitLabel;
      let splitClass = "racer-split";
      if (isPreRace) {
        displayedSplit = splitLabel;
        splitClass = "racer-split";
      } else if (isEffectActive) {
        if (effectAge < 850) {
          displayedSplit = effect.completedSplitName || splitLabel;
          splitClass = `racer-split is-completed-${effect.type}`;
        } else if (effectAge < 1300) {
          displayedSplit = effect.completedSplitName || splitLabel;
          splitClass = `racer-split is-completed-${effect.type} split-fade-out`;
        } else {
          displayedSplit = effect.newSplitName || splitLabel;
          splitClass = "racer-split split-swipe-in";
        }
      }

      const ribbonTier = (!isDnf && (racer.segmentRibbon || (racer.hasCrown ? "gold" : null))) || null;
      const ribbonSegName = racer.ribbonSegmentName || racer.crownSegmentName || "split";
      const rawRibbonSec = typeof racer.ribbonSegmentTime === "number"
        ? racer.ribbonSegmentTime
        : (typeof racer.crownSegmentTime === "number" ? racer.crownSegmentTime : null);
      const ribbonSegTime = rawRibbonSec !== null
        ? formatSegmentDuration(rawRibbonSec)
        : (racer.ribbonSegmentTime || racer.crownSegmentTime || "--");
      const ribbonLabels = {
        gold: "🥇 1st Fastest Segment",
        silver: "🥈 2nd Fastest Segment",
        bronze: "🥉 3rd Fastest Segment"
      };
      const ribbonTooltip = ribbonTier && ribbonLabels[ribbonTier]
        ? `${ribbonLabels[ribbonTier]} on ${ribbonSegName}: ${ribbonSegTime} (${displayName})`
        : "";
      const ribbonClass = ribbonTier ? `racer-ribbon is-active ribbon-${ribbonTier}` : "racer-ribbon";

      const rowTitle = isDnf
        ? `${displayName} did not finish (DNF)`
        : (isHost
          ? "Your race progress"
          : (isMuted ? "Double-click to show runner pin on track" : "Double-click to hide runner pin on track"));

      let row = rowElementMap.get(uId);
      if (!row || !rowsEl.contains(row)) {
        row = document.createElement("div");
        row.className = `leaderboard-row${isHost ? " is-host" : ""}${isMuted ? " is-muted" : ""}${isDnf ? " is-dnf" : ""}`;
        row.setAttribute("data-user-id", uId);
        row.title = rowTitle;
        row.style.setProperty("--racer-color", color);

        const avatarMarkup = buildAvatarMarkup(racer.avatar, isHost);

        row.innerHTML = `
          <div class="${ribbonClass}" title="${escapeHtml(ribbonTooltip)}"></div>
          <div class="pos-col">
            <div class="pos-badge ${posClass}">${rank}</div>
            <span class="${deltaClass}" title="${escapeHtml(deltaTooltip)}">${escapeHtml(deltaText)}</span>
          </div>
          <div class="racer-accent-bar"></div>
          <div class="racer-avatar-container">
            <div class="racer-avatar-badge">${avatarMarkup}</div>
          </div>
          <div class="racer-name-block">
            <span class="racer-name">${escapeHtml(displayName)}</span>
            <span class="${splitClass}">${escapeHtml(displayedSplit)}</span>
          </div>
          <div class="racer-gap-col" title="${escapeHtml(gapTooltip)}">
            <span class="racer-gap${(!isPreRace && rank === 1) ? ' is-leader' : ''}${isPreRace ? (isReady ? ' gap-ready' : ' gap-joined') : ''}">${gapVal}</span>
            <span class="racer-expected racer-interval">${expMarkup}</span>
          </div>
        `;
        rowElementMap.set(uId, row);
        rowsEl.appendChild(row);
      } else {
        // In-place property update: never wipe out running animations
        row.classList.toggle("is-host", isHost);
        row.classList.toggle("is-muted", isMuted);
        row.classList.toggle("is-dnf", isDnf);
        if (row.title !== rowTitle) {
          row.title = rowTitle;
        }
        row.style.setProperty("--racer-color", color);

        const posBadge = row.querySelector(".pos-badge");
        if (posBadge) {
          if (posBadge.textContent !== String(rank)) {
            posBadge.textContent = rank;
          }
          if (posBadge.className !== `pos-badge ${posClass}`) {
            posBadge.className = `pos-badge ${posClass}`;
          }
        }

        const posDeltaEl = row.querySelector(".pos-delta");
        if (posDeltaEl) {
          if (posDeltaEl.textContent !== deltaText) {
            posDeltaEl.textContent = deltaText;
          }
          if (posDeltaEl.className !== deltaClass) {
            posDeltaEl.className = deltaClass;
          }
          if (posDeltaEl.title !== deltaTooltip) {
            posDeltaEl.title = deltaTooltip;
          }
        }

        let ribbonEl = row.querySelector(".racer-ribbon");
        if (!ribbonEl) {
          ribbonEl = document.createElement("div");
          ribbonEl.className = "racer-ribbon";
          row.insertBefore(ribbonEl, row.firstChild);
        }
        if (ribbonEl.className !== ribbonClass) {
          ribbonEl.className = ribbonClass;
        }
        if (ribbonEl.title !== ribbonTooltip) {
          ribbonEl.title = ribbonTooltip;
        }

        const nameEl = row.querySelector(".racer-name");
        if (nameEl && nameEl.textContent !== displayName) {
          nameEl.textContent = displayName;
        }

        const splitEl = row.querySelector(".racer-split");
        if (splitEl) {
          if (splitEl.textContent !== displayedSplit) {
            splitEl.textContent = displayedSplit;
          }
          if (splitEl.className !== splitClass) {
            splitEl.className = splitClass;
          }
        }

        const gapEl = row.querySelector(".racer-gap");
        if (gapEl) {
          if (gapEl.textContent !== gapVal) gapEl.textContent = gapVal;
          gapEl.classList.toggle("is-leader", !isPreRace && rank === 1);
          gapEl.classList.toggle("gap-ready", isPreRace && isReady);
          gapEl.classList.toggle("gap-joined", isPreRace && !isReady);
        }

        const intEl = row.querySelector(".racer-expected, .racer-interval");
        if (intEl && intEl.innerHTML !== expMarkup) {
          intEl.innerHTML = expMarkup;
        }

        const gapCol = row.querySelector(".racer-gap-col");
        if (gapCol && gapCol.title !== gapTooltip) {
          gapCol.title = gapTooltip;
        }
      }

      const lastAppliedEffectTime = row.dataset.lastEffectTime;

      if (isEffectActive && String(effect.timestamp) !== lastAppliedEffectTime) {
        // Trigger / re-trigger CSS keyframe glow animation
        row.classList.remove("split-flash-gold", "split-flash-green", "split-flash-red");
        void row.offsetWidth;
        const initialDelaySec = Math.max(0, (effectAge / 1000)).toFixed(2);
        row.style.animationDelay = (initialDelaySec > 0.05) ? `-${initialDelaySec}s` : "";
        row.classList.add(targetClass);
        row.dataset.lastEffectTime = String(effect.timestamp);
      } else if (!isEffectActive && (row.classList.contains("split-flash-gold") || row.classList.contains("split-flash-green") || row.classList.contains("split-flash-red"))) {
        row.classList.remove("split-flash-gold", "split-flash-green", "split-flash-red");
        row.style.animationDelay = "";
        delete row.dataset.lastEffectTime;
      }
      } catch (err) {
        console.error("[Leaderboard Row Render Error]", err, racer);
      }
    });

    // Reorder DOM child nodes only when the physical slot order has actually changed.
    // Targeted reconciliation ensures rows that did not move are NEVER detached,
    // which prevents ongoing CSS animations from restarting or flickering!
    // FLIP (First, Last, Invert, Play) provides silky-smooth sliding transitions when ranks swap.
    if (!domOrderMatches) {
      // 1. FIRST: Record visual positions of existing rows prior to DOM rearrangement
      const prevTops = new Map();
      rowElementMap.forEach((row, uId) => {
        if (row && row.isConnected) {
          prevTops.set(uId, row.getBoundingClientRect().top);
        }
      });

      // Clear any previous swap transforms so layout positions can be accurately measured
      rowElementMap.forEach((row) => {
        if (row.classList.contains("is-swapping")) {
          row.classList.remove("is-swapping");
          row.style.removeProperty("transform");
          row.style.removeProperty("transition");
          row.style.removeProperty("z-index");
          row.style.removeProperty("--swap-y");
        }
      });

      // 2. LAST: Targeted DOM reconciliation to slot elements into their new positions
      let currentChild = rowsEl.firstElementChild;
      entrants.forEach((racer) => {
        const row = rowElementMap.get(racer.userId);
        if (!row) return;
        if (currentChild === row) {
          // Already in exact correct slot, leave completely untouched!
          currentChild = currentChild.nextElementSibling;
        } else {
          // Row needs to be moved to this slot
          rowsEl.insertBefore(row, currentChild);
          // If this moved row is in the middle of a split glow animation, preserve its elapsed progress
          const fx = racer.lastSplitEffect;
          const fxAge = fx ? (Date.now() - (fx.timestamp || 0)) : Infinity;
          if (fx && fx.type && fxAge >= 0 && fxAge < 4000) {
            row.style.animationDelay = `-${(fxAge / 1000).toFixed(2)}s`;
          }
        }
      });

      // 3. INVERT: Measure new layout positions, calculate deltas, and counter-transform
      const movingRows = [];
      entrants.forEach((racer) => {
        const row = rowElementMap.get(racer.userId);
        if (!row || !row.isConnected) return;
        const oldTop = prevTops.get(racer.userId);
        if (oldTop === undefined) return;
        const newTop = row.getBoundingClientRect().top;
        const dy = oldTop - newTop;

        // Sub-pixel shifts within 0.5px are ignored to prevent micro-jitter
        if (Math.abs(dy) > 0.5) {
          row.style.setProperty("transition", "none", "important");
          row.style.setProperty("transform", `translateY(${dy}px)`, "important");
          row.style.setProperty("--swap-y", `${dy}px`);
          // Elevate climbing overtaker (moving upwards, dy > 0) above descending rows
          row.style.zIndex = dy > 0 ? "4" : "2";
          movingRows.push({ row, dy });
        }
      });

      // 4. PLAY: Animate smoothly to new positions on next animation frame
      if (movingRows.length > 0) {
        // Force layout flush so browser locks the inverted starting transform
        void rowsEl.offsetHeight;

        const raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
        raf(() => {
          movingRows.forEach(({ row }) => {
            row.classList.add("is-swapping");
            row.style.setProperty("transition", "transform 0.4s cubic-bezier(0.2, 0, 0, 1)", "important");
            row.style.setProperty("transform", "translateY(0px)", "important");
            row.style.setProperty("--swap-y", "0px");

            const cleanup = (e) => {
              if (e && e.propertyName && e.propertyName !== "transform") return;
              row.removeEventListener("transitionend", cleanup);
              row.classList.remove("is-swapping");
              row.style.removeProperty("transform");
              row.style.removeProperty("transition");
              row.style.removeProperty("z-index");
              row.style.removeProperty("--swap-y");
            };
            row.addEventListener("transitionend", cleanup, { once: true });
            setTimeout(cleanup, 450);
          });
        });
      }
    }

    // Clean up rows of racers who left
    const activeIds = new Set(entrants.map(r => r.userId));
    rowElementMap.forEach((row, uId) => {
      if (!activeIds.has(uId)) {
        if (row.parentNode) row.parentNode.removeChild(row);
        rowElementMap.delete(uId);
      }
    });

    let waitingEl = rowsEl.querySelector(".leaderboard-waiting-state");
    if (isConn && entrants.length === 0) {
      if (!waitingEl) {
        waitingEl = document.createElement("div");
        waitingEl.className = "leaderboard-waiting-state";
        waitingEl.innerHTML = `
          <div class="waiting-icon">&#128225;</div>
          <div class="waiting-title">Connected to Live Race</div>
          <div class="waiting-subtext">Waiting for runner split telemetry...</div>
        `;
        rowsEl.appendChild(waitingEl);
      }
    } else if (waitingEl) {
      waitingEl.remove();
    }
  }

  function reset() {
    rowElementMap.forEach((row) => {
      if (row) {
        row.classList.remove("is-swapping");
        row.style.removeProperty("transform");
        row.style.removeProperty("transition");
        row.style.removeProperty("z-index");
        row.style.removeProperty("--swap-y");
        row.style.transition = "";
        row.style.transform = "";
        row.style.zIndex = "";
        row.style.animationDelay = "";
        row.classList.remove("overtake-flash", "split-flash-gold", "split-flash-green", "split-flash-red");
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
