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

  /**
   * Escapes HTML strings to prevent XSS.
   */
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Builds avatar HTML markup for an entrant.
   */
  function buildAvatarMarkup(avatar, isHost) {
    if (avatar && (avatar.startsWith("http") || avatar.startsWith("data:"))) {
      return `<img class="racer-avatar-img" src="${escapeHtml(avatar)}" alt="" />`;
    }
    return `<span class="racer-avatar-emoji">${escapeHtml(avatar || (isHost ? "👤" : "🏎️"))}</span>`;
  }

  /**
   * Returns fallback preview entrants for Edit Mode when not in a race.
   */
  function getPreviewEntrants() {
    const savedName = (typeof localStorage !== "undefined" && localStorage.getItem("therun_username")) || "";
    const hostDisplayName = savedName.trim() || "You";
    return [
      {
        userId: "prev_speeddemon",
        username: "SpeedDemon",
        avatar: "⚡",
        color: "#06b6d4",
        rank: 1,
        isHost: false,
        isMuted: false,
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
        isHost: true,
        isMuted: false,
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
        isHost: false,
        isMuted: false,
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

        // Immediately update track pin display
        const marker = document.getElementById(`ghost-marker-race-${userId}`);
        if (marker) {
          marker.style.display = isNowMuted ? "none" : "flex";
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

    // Update status badge
    if (statusBadge) {
      if (isSim) {
        statusBadge.innerText = "SIM";
        statusBadge.className = "leaderboard-status status-sim";
      } else if (isConn) {
        statusBadge.innerText = "LIVE";
        statusBadge.className = "leaderboard-status status-live";
      } else {
        statusBadge.innerText = "PREVIEW";
        statusBadge.className = "leaderboard-status status-preview";
      }
    }

    const rawEntrants = (isRaceActive && rankedEntrants.length > 0)
      ? rankedEntrants
      : getPreviewEntrants();

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

    // -------------------------------------------------------------
    // In-place update of rows and append in strict rank order
    // -------------------------------------------------------------
    entrants.forEach((racer) => {
      const uId = racer.userId || "unknown";
      const isHost = !!racer.isHost;
      const isMuted = !!racer.isMuted;
      const isDnf = !!racer.isDNF;
      const rank = isDnf ? "DNF" : (racer.rank || 1);
      const posClass = isDnf ? "pos-dnf" : `pos-${(typeof rank === 'number' && rank <= 3) ? rank : 'other'}`;
      const color = racer.color || (isHost ? "#38bdf8" : "#94a3b8");
      const displayName = racer.username || (isHost ? "You" : "Runner");
      const splitLabel = isDnf ? "DNF" : (racer.isFinished ? "FINISHED" : (racer.currentSplitName || `Split ${racer.currentSplitIndex + 1 || 1}`));

      const rawGap = racer.gapDisplay || (rank === 1 ? "LEADER" : "--");
      const gapVal = isDnf ? "DNF" : ((rank === 1) ? "LEADER" : rawGap);
      const expType = racer.expectedType || (racer.isFinished ? "FIN" : "EXP");
      const expVal = racer.expectedSegmentDisplay || "--";
      const elapsedVal = racer.elapsedSegmentDisplay || "--";

      let expMarkup = "--";
      if (racer.isFinished) {
        expMarkup = `<span class="expected-tag interval-tag">FIN</span>${escapeHtml(expVal)}`;
      } else if (expVal !== "--") {
        expMarkup = `<span class="racer-elapsed">${escapeHtml(elapsedVal)}</span><span class="racer-slash">/</span><span class="expected-tag interval-tag">${expType}</span>${escapeHtml(expVal)}`;
      }

      const gapTooltip = (rank === 1)
        ? `Race Leader | Segment: ${elapsedVal} / ${expVal}`
        : (gapVal === "--" ? `Split 1 in progress | Segment: ${elapsedVal} / ${expVal}` : `Leader Gap: ${gapVal} | Segment: ${elapsedVal} / ${expVal}`);

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
      if (isEffectActive) {
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

      const hasCrown = !!racer.hasCrown;
      const crownTooltip = hasCrown
        ? `👑 Fastest Segment on ${racer.crownSegmentName || 'split'}: ${typeof racer.crownSegmentTime === 'number' ? racer.crownSegmentTime.toFixed(1) + 's' : (racer.crownSegmentTime || '--')} (${displayName})`
        : "";

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
          <div class="pos-badge ${posClass}">${rank}</div>
          <div class="racer-accent-bar"></div>
          <div class="racer-avatar-container">
            <div class="racer-avatar-badge">${avatarMarkup}</div>
            <span class="racer-crown${hasCrown ? ' is-active' : ''}" title="${escapeHtml(crownTooltip)}">👑</span>
          </div>
          <div class="racer-name-block">
            <span class="racer-name">${escapeHtml(displayName)}</span>
            <span class="${splitClass}">${escapeHtml(displayedSplit)}</span>
          </div>
          <div class="racer-gap-col" title="${escapeHtml(gapTooltip)}">
            <span class="racer-gap${rank === 1 ? ' is-leader' : ''}">${gapVal}</span>
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
          posBadge.textContent = rank;
          posBadge.className = `pos-badge ${posClass}`;
        }

        let crownEl = row.querySelector(".racer-crown");
        if (!crownEl) {
          const avatarBadge = row.querySelector(".racer-avatar-badge");
          if (avatarBadge) {
            let container = row.querySelector(".racer-avatar-container");
            if (!container) {
              container = document.createElement("div");
              container.className = "racer-avatar-container";
              avatarBadge.parentNode.insertBefore(container, avatarBadge);
              container.appendChild(avatarBadge);
            }
            crownEl = document.createElement("span");
            crownEl.className = "racer-crown";
            crownEl.textContent = "👑";
            container.appendChild(crownEl);
          }
        }
        if (crownEl) {
          const wasActive = crownEl.classList.contains("is-active");
          if (hasCrown !== wasActive) {
            crownEl.classList.toggle("is-active", hasCrown);
          }
          if (hasCrown && crownTooltip && crownEl.title !== crownTooltip) {
            crownEl.title = crownTooltip;
          }
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
        if (gapEl && gapEl.textContent !== gapVal) {
          gapEl.textContent = gapVal;
          gapEl.classList.toggle("is-leader", rank === 1);
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
    });

    // Reorder DOM child nodes only when the physical slot order has actually changed.
    // Targeted reconciliation ensures rows that did not move are NEVER detached,
    // which prevents ongoing CSS animations from restarting or flickering!
    if (!domOrderMatches) {
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
    }

    // Clean up rows of racers who left
    const activeIds = new Set(entrants.map(r => r.userId));
    rowElementMap.forEach((row, uId) => {
      if (!activeIds.has(uId)) {
        if (row.parentNode) row.parentNode.removeChild(row);
        rowElementMap.delete(uId);
      }
    });
  }

  function reset() {
    rowElementMap.forEach((row) => {
      if (row) {
        row.style.transition = "";
        row.style.transform = "";
        row.style.zIndex = "";
        row.style.animationDelay = "";
        row.classList.remove("overtake-flash", "split-flash-gold", "split-flash-green", "split-flash-red");
        delete row.dataset.lastEffectTime;
        const crownEl = row.querySelector(".racer-crown");
        if (crownEl) {
          crownEl.classList.remove("is-active");
          crownEl.title = "";
        }
        const splitEl = row.querySelector(".racer-split");
        if (splitEl) {
          splitEl.className = "racer-split";
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
