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

  /**
   * Initializes click event delegation for competitor mute buttons.
   */
  function initMuteListener(containerEl) {
    if (isMuteListenerAttached || !containerEl) return;
    containerEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".racer-mute-btn");
      if (!btn) return;
      e.stopPropagation();

      const userId = btn.getAttribute("data-mute-user");
      if (!userId) return;

      const rc = window.LiveSplit && window.LiveSplit.RaceClient ? window.LiveSplit.RaceClient : window.LiveSplitRaceClient;
      if (rc && typeof rc.toggleEntrantMuted === "function") {
        const isNowMuted = rc.toggleEntrantMuted(userId);
        btn.innerHTML = isNowMuted ? "🔇" : "👁️";
        btn.title = isNowMuted ? "Unmute pin on track" : "Mute pin on track";
        btn.closest(".leaderboard-row")?.classList.toggle("is-muted", isNowMuted);

        // Refresh track pins immediately
        if (typeof window.updateGhostRunner === "function") {
          window.updateGhostRunner(window.lastElapsedSec || 0);
        }
      }
    });
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

    const isRaceActive = isSimulating || isConnected;

    // Component visibility rules
    if (!isRaceActive && !isEditMode) {
      compEl.style.display = "none";
      prevRowTops.clear();
      return;
    }

    compEl.style.display = "";

    // Update status badge
    if (statusBadge) {
      if (isSimulating) {
        statusBadge.innerText = "SIM";
        statusBadge.className = "leaderboard-status status-sim";
      } else if (isConnected) {
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

    // -------------------------------------------------------------
    // FLIP Animation: Step 1 (FIRST) - Record pre-update row tops
    // -------------------------------------------------------------
    const existingRows = rowsEl.querySelectorAll(".leaderboard-row");
    const oldTops = new Map();
    existingRows.forEach((row) => {
      const uId = row.getAttribute("data-user-id");
      if (uId) {
        oldTops.set(uId, row.getBoundingClientRect().top);
      }
    });

    // -------------------------------------------------------------
    // Step 2: Render/update row HTML elements in standings order
    // -------------------------------------------------------------
    const fragment = document.createDocumentFragment();

    entrants.forEach((racer) => {
      const uId = racer.userId || "unknown";
      const isHost = !!racer.isHost;
      const isMuted = !!racer.isMuted;
      const rank = racer.rank || 1;
      const color = racer.color || (isHost ? "#38bdf8" : "#94a3b8");

      let row = rowsEl.querySelector(`.leaderboard-row[data-user-id="${uId}"]`);
      if (!row) {
        row = document.createElement("div");
        row.className = "leaderboard-row";
        row.setAttribute("data-user-id", uId);
      }

      row.className = `leaderboard-row${isHost ? " is-host" : ""}${isMuted ? " is-muted" : ""}`;
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

      fragment.appendChild(row);
    });

    // Replace content in DOM
    rowsEl.innerHTML = "";
    rowsEl.appendChild(fragment);

    // -------------------------------------------------------------
    // FLIP Animation: Steps 3-6 (LAST, INVERT, PLAY)
    // -------------------------------------------------------------
    const updatedRows = rowsEl.querySelectorAll(".leaderboard-row");
    updatedRows.forEach((row) => {
      const uId = row.getAttribute("data-user-id");
      if (!uId || !oldTops.has(uId)) return;

      const oldTop = oldTops.get(uId);
      const newTop = row.getBoundingClientRect().top;
      const dy = oldTop - newTop;

      if (Math.abs(dy) > 0.5) {
        // INVERT: Immediately counteract visual jump
        row.style.transform = `translateY(${dy}px)`;
        row.style.transition = "none";

        // PLAY: Animate smoothly to natural position on next frame
        requestAnimationFrame(() => {
          row.style.transition = "transform 0.28s cubic-bezier(0.2, 0, 0, 1)";
          row.style.transform = "";

          // Flash overtake highlight if moving up in position
          if (dy > 0) {
            row.classList.add("overtake-flash");
            setTimeout(() => {
              row.classList.remove("overtake-flash");
            }, 600);
          }
        });
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
