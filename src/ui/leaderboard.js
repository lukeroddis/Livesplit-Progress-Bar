/**
 * src/ui/leaderboard.js - Live Race F1-Style Dynamic Leaderboard Controller
 * 
 * Manages the timing tower HUD component:
 * - Entrant standings sorted by race position (P1, P2, P3...)
 * - 60 FPS FLIP position reorder animations during overtakes
 * - Dynamic leader gap (+X.Xs) and interval to car ahead (+Y.Ys)
 * - Click-to-mute individual competitor pins on the progress track
 * - Layout Mode preview generation and seamless component integration
 */

(function () {
  "use strict";

  // Cache previous entrant row Y coordinates for FLIP animation (userId -> clientRectTop)
  const prevRowTops = new Map();
  const rowElementMap = new Map();
  let prevRankOrder = [];
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
   * Formats gap or interval in seconds into F1 timing string.
   */
  function formatGapSec(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "--";
    if (sec < 60) {
      return `+${sec.toFixed(1)}s`;
    }
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `+${m}:${s.padStart(4, "0")}`;
  }

  /**
   * Returns fallback preview entrants for Edit Mode when not in a race.
   */
  function getPreviewEntrants() {
    return [
      {
        userId: "prev_speeddemon",
        username: "SpeedDemon",
        avatar: "⚡",
        color: "#06b6d4",
        rank: 1,
        isHost: false,
        isMuted: false,
        currentSplitName: "Split 3",
        gapDisplay: "LEADER",
        intervalDisplay: "--"
      },
      {
        userId: "you",
        username: "You",
        avatar: "",
        color: "#38bdf8",
        rank: 2,
        isHost: true,
        isMuted: false,
        currentSplitName: "Split 2",
        gapDisplay: "+1.4s",
        intervalDisplay: "+1.4s"
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
        intervalDisplay: "+0.7s"
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
   * Initializes click event delegation for competitor mute buttons.
   */
  function initMuteListener(containerEl) {
    if (isMuteListenerAttached || !containerEl) return;

    function handleMuteAction(e) {
      const btn = e.target.closest(".racer-mute-btn");
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();

      const userId = btn.getAttribute("data-mute-user");
      if (!userId) return;

      const rc = getRaceClient();
      if (rc && typeof rc.toggleEntrantMuted === "function") {
        const isNowMuted = rc.toggleEntrantMuted(userId);
        btn.innerHTML = isNowMuted ? "🔇" : "👁️";
        btn.title = isNowMuted ? "Unmute pin on track" : "Mute pin on track";
        btn.closest(".leaderboard-row")?.classList.toggle("is-muted", isNowMuted);

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

    containerEl.addEventListener("click", handleMuteAction);
    isMuteListenerAttached = true;
  }

  /**
   * Renders the F1 timing tower with FLIP animations.
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

    initMuteListener(rowsEl);

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
      prevRowTops.clear();
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

    const entrants = (isRaceActive && rankedEntrants.length > 0)
      ? rankedEntrants
      : getPreviewEntrants();

    const newRankOrder = entrants.map(r => r.userId || "unknown");
    const ranksChanged = (newRankOrder.length !== prevRankOrder.length) ||
      newRankOrder.some((uId, i) => uId !== prevRankOrder[i]);

    // -------------------------------------------------------------
    // FLIP Step 1 (FIRST): Record pre-reorder tops only when ranking permutation changes
    // -------------------------------------------------------------
    const oldTops = new Map();
    if (ranksChanged) {
      rowElementMap.forEach((row, uId) => {
        if (row && row.isConnected) {
          oldTops.set(uId, row.getBoundingClientRect().top);
        }
      });
    }

    // -------------------------------------------------------------
    // Step 2: In-place update of rows without destroying child elements
    // -------------------------------------------------------------
    entrants.forEach((racer) => {
      const uId = racer.userId || "unknown";
      const isHost = !!racer.isHost;
      const isMuted = !!racer.isMuted;
      const rank = racer.rank || 1;
      const color = racer.color || (isHost ? "#38bdf8" : "#94a3b8");

      let row = rowElementMap.get(uId);
      if (!row || !rowsEl.contains(row)) {
        row = document.createElement("div");
        row.className = `leaderboard-row${isHost ? " is-host" : ""}${isMuted ? " is-muted" : ""}`;
        row.setAttribute("data-user-id", uId);
        row.style.setProperty("--racer-color", color);

        const avatarMarkup = racer.avatar && (racer.avatar.startsWith("http") || racer.avatar.startsWith("data:"))
          ? `<img class="racer-avatar-img" src="${racer.avatar}" alt="" />`
          : `<span class="racer-avatar-emoji">${racer.avatar || (isHost ? "👤" : "🏎️")}</span>`;

        const displayName = isHost ? "You" : racer.username;
        const splitLabel = racer.isFinished ? "FINISHED" : (racer.currentSplitName || `Split ${racer.currentSplitIndex + 1 || 1}`);
        const gapVal = racer.gapDisplay || (rank === 1 ? "LEADER" : formatGapSec(racer.gapToLeaderSec));
        const intVal = racer.intervalDisplay || (rank === 1 ? "--" : formatGapSec(racer.intervalSec));

        row.innerHTML = `
          <div class="pos-badge pos-${rank <= 3 ? rank : 'other'}">${rank}</div>
          <div class="racer-accent-bar"></div>
          <div class="racer-avatar-badge">${avatarMarkup}</div>
          <div class="racer-name-block">
            <span class="racer-name">${escapeHtml(displayName)}${isHost ? '<span class="host-pill">YOU</span>' : ''}</span>
            <span class="racer-split">${escapeHtml(splitLabel)}</span>
          </div>
          <div class="racer-gap-col">
            <span class="racer-gap">${gapVal}</span>
            <span class="racer-interval">${intVal}</span>
          </div>
          ${!isHost ? `<button type="button" class="racer-mute-btn" data-mute-user="${uId}" title="${isMuted ? 'Unmute pin on track' : 'Mute pin on track'}">${isMuted ? '🔇' : '👁️'}</button>` : '<div class="racer-mute-spacer"></div>'}
        `;
        rowElementMap.set(uId, row);
        rowsEl.appendChild(row);
      } else {
        // In-place property update: never destroy button or child nodes
        row.className = `leaderboard-row${isHost ? " is-host" : ""}${isMuted ? " is-muted" : ""}`;
        row.style.setProperty("--racer-color", color);

        const posBadge = row.querySelector(".pos-badge");
        if (posBadge) {
          posBadge.textContent = rank;
          posBadge.className = `pos-badge pos-${rank <= 3 ? rank : 'other'}`;
        }

        const splitEl = row.querySelector(".racer-split");
        const splitLabel = racer.isFinished ? "FINISHED" : (racer.currentSplitName || `Split ${racer.currentSplitIndex + 1 || 1}`);
        if (splitEl && splitEl.textContent !== splitLabel) {
          splitEl.textContent = splitLabel;
        }

        const gapEl = row.querySelector(".racer-gap");
        const gapVal = racer.gapDisplay || (rank === 1 ? "LEADER" : formatGapSec(racer.gapToLeaderSec));
        if (gapEl && gapEl.textContent !== gapVal) {
          gapEl.textContent = gapVal;
        }

        const intEl = row.querySelector(".racer-interval");
        const intVal = racer.intervalDisplay || (rank === 1 ? "--" : formatGapSec(racer.intervalSec));
        if (intEl && intEl.textContent !== intVal) {
          intEl.textContent = intVal;
        }

        const muteBtn = row.querySelector(".racer-mute-btn");
        if (muteBtn) {
          const expectedIcon = isMuted ? "🔇" : "👁️";
          if (muteBtn.textContent !== expectedIcon) {
            muteBtn.textContent = expectedIcon;
            muteBtn.title = isMuted ? "Unmute pin on track" : "Mute pin on track";
          }
        }

        if (ranksChanged) {
          rowsEl.appendChild(row);
        }
      }
    });

    // -------------------------------------------------------------
    // FLIP Steps 3-6 (LAST, INVERT, PLAY): Smoothly animate overtakes
    // -------------------------------------------------------------
    if (ranksChanged && oldTops.size > 0) {
      entrants.forEach((racer) => {
        const uId = racer.userId || "unknown";
        const row = rowElementMap.get(uId);
        if (!row || !oldTops.has(uId)) return;

        const oldTop = oldTops.get(uId);
        const newTop = row.getBoundingClientRect().top;
        const dy = oldTop - newTop;

        if (Math.abs(dy) > 0.5) {
          row.style.transition = "none";
          row.style.transform = `translateY(${dy}px)`;

          requestAnimationFrame(() => {
            row.style.transition = "transform 0.28s cubic-bezier(0.2, 0, 0, 1)";
            row.style.transform = "";

            if (dy > 0) {
              row.classList.add("overtake-flash");
              setTimeout(() => {
                row.classList.remove("overtake-flash");
              }, 600);
            }
          });
        }
      });
      prevRankOrder = newRankOrder;
    } else if (ranksChanged) {
      prevRankOrder = newRankOrder;
    }

    // Clean up rows of racers who left
    const activeIds = new Set(newRankOrder);
    rowElementMap.forEach((row, uId) => {
      if (!activeIds.has(uId)) {
        if (row.parentNode) row.parentNode.removeChild(row);
        rowElementMap.delete(uId);
      }
    });
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Leaderboard = {
    renderLeaderboard,
    getPreviewEntrants
  };
  window.LiveSplitLeaderboard = window.LiveSplit.Leaderboard;
})();
