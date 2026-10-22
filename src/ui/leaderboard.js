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
  // Map of userId -> previous rank (1, 2, 3...)
  const prevRanks = new Map();
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
        currentSplitName: "Split 3",
        gapDisplay: "LEADER",
        intervalDisplay: "--"
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
    const entrants = [...rawEntrants].sort((a, b) => (a.rank || 0) - (b.rank || 0));

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
      const rank = racer.rank || 1;
      const color = racer.color || (isHost ? "#38bdf8" : "#94a3b8");
      const displayName = racer.username || (isHost ? "You" : "Runner");
      const splitLabel = racer.isFinished ? "FINISHED" : (racer.currentSplitName || `Split ${racer.currentSplitIndex + 1 || 1}`);

      const rawGap = racer.gapDisplay || (rank === 1 ? "LEADER" : formatGapSec(racer.gapToLeaderSec));
      const rawInt = racer.intervalDisplay || (rank === 1 ? "--" : formatGapSec(racer.intervalSec));
      const gapVal = (rank === 1) ? "LEADER" : rawGap;
      const cleanInt = (rank === 1) ? "--" : rawInt.replace(/^\+/, "");
      const intMarkup = (rank === 1) ? "--" : `<span class="interval-tag">INT</span>+${escapeHtml(cleanInt)}`;
      const gapTooltip = (rank === 1) ? "Race Leader" : `Leader Gap: ${gapVal} | Interval to Ahead: +${cleanInt}`;

      // Split completion glow pulse (Gold / Green / Red) and Split Name Phase Transition
      const effect = racer.lastSplitEffect;
      const effectAge = effect ? (Date.now() - (effect.timestamp || 0)) : Infinity;
      const isEffectActive = effect && effect.type && effectAge >= 0 && effectAge < 2000;
      const targetClass = isEffectActive ? `split-flash-${effect.type}` : null;

      // Determine active split text and styling based on 2-phase transition:
      // Phase 1 (< 1100ms): Display completed split name in gold/green/red
      // Phase 2 (1100ms - 2000ms): Swipe transition to incoming new split name in neutral color
      let displayedSplit = splitLabel;
      let splitClass = "racer-split";
      if (isEffectActive) {
        if (effectAge < 1100) {
          displayedSplit = effect.completedSplitName || splitLabel;
          splitClass = `racer-split is-completed-${effect.type}`;
        } else {
          displayedSplit = effect.newSplitName || splitLabel;
          splitClass = "racer-split split-swipe-in";
        }
      }

      let row = rowElementMap.get(uId);
      if (!row || !rowsEl.contains(row)) {
        row = document.createElement("div");
        row.className = `leaderboard-row${isHost ? " is-host" : ""}${isMuted ? " is-muted" : ""}`;
        row.setAttribute("data-user-id", uId);
        row.style.setProperty("--racer-color", color);

        const avatarMarkup = buildAvatarMarkup(racer.avatar, isHost);

        row.innerHTML = `
          <div class="pos-badge pos-${rank <= 3 ? rank : 'other'}">${rank}</div>
          <div class="racer-accent-bar"></div>
          <div class="racer-avatar-badge">${avatarMarkup}</div>
          <div class="racer-name-block">
            <span class="racer-name">${escapeHtml(displayName)}</span>
            <span class="${splitClass}">${escapeHtml(displayedSplit)}</span>
          </div>
          <div class="racer-gap-col" title="${escapeHtml(gapTooltip)}">
            <span class="racer-gap${rank === 1 ? ' is-leader' : ''}">${gapVal}</span>
            <span class="racer-interval">${intMarkup}</span>
          </div>
          ${!isHost ? `<button type="button" class="racer-mute-btn" data-mute-user="${uId}" title="${isMuted ? 'Unmute pin on track' : 'Mute pin on track'}">${isMuted ? '🔇' : '👁️'}</button>` : '<div class="racer-mute-spacer"></div>'}
        `;
        rowElementMap.set(uId, row);
        rowsEl.appendChild(row);
      } else {
        // In-place property update: never wipe out running animations
        row.classList.toggle("is-host", isHost);
        row.classList.toggle("is-muted", isMuted);
        row.style.setProperty("--racer-color", color);

        const posBadge = row.querySelector(".pos-badge");
        if (posBadge) {
          posBadge.textContent = rank;
          posBadge.className = `pos-badge pos-${rank <= 3 ? rank : 'other'}`;
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

        const intEl = row.querySelector(".racer-interval");
        if (intEl && intEl.innerHTML !== intMarkup) {
          intEl.innerHTML = intMarkup;
        }

        const gapCol = row.querySelector(".racer-gap-col");
        if (gapCol && gapCol.title !== gapTooltip) {
          gapCol.title = gapTooltip;
        }

        const muteBtn = row.querySelector(".racer-mute-btn");
        const muteSpacer = row.querySelector(".racer-mute-spacer");
        if (isHost && muteBtn) {
          muteBtn.remove();
          if (!muteSpacer) {
            const spacer = document.createElement("div");
            spacer.className = "racer-mute-spacer";
            row.appendChild(spacer);
          }
        } else if (!isHost && muteSpacer) {
          muteSpacer.remove();
          if (!muteBtn) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "racer-mute-btn";
            btn.setAttribute("data-mute-user", uId);
            btn.title = isMuted ? "Unmute pin on track" : "Mute pin on track";
            btn.textContent = isMuted ? "🔇" : "👁️";
            row.appendChild(btn);
          }
        } else if (muteBtn) {
          const expectedIcon = isMuted ? "🔇" : "👁️";
          if (muteBtn.textContent !== expectedIcon) {
            muteBtn.textContent = expectedIcon;
            muteBtn.title = isMuted ? "Unmute pin on track" : "Mute pin on track";
          }
        }
      }

      const lastAppliedEffectTime = row.dataset.lastEffectTime;

      if (isEffectActive && String(effect.timestamp) !== lastAppliedEffectTime) {
        // Trigger / re-trigger CSS keyframe glow animation
        row.classList.remove("split-flash-gold", "split-flash-green", "split-flash-red");
        void row.offsetWidth;
        row.classList.add(targetClass);
        row.dataset.lastEffectTime = String(effect.timestamp);
      } else if (!isEffectActive && (row.classList.contains("split-flash-gold") || row.classList.contains("split-flash-green") || row.classList.contains("split-flash-red"))) {
        row.classList.remove("split-flash-gold", "split-flash-green", "split-flash-red");
        delete row.dataset.lastEffectTime;
      }
    });

    // Reorder DOM child nodes only when the physical slot order has actually changed.
    // Instant, crisp slot switching with zero layout thrashing, zero flicker, and zero delay.
    if (!domOrderMatches) {
      entrants.forEach((racer) => {
        const row = rowElementMap.get(racer.userId);
        if (row) rowsEl.appendChild(row);
      });
    }

    // Update recorded ranks
    entrants.forEach((r, idx) => prevRanks.set(r.userId, r.rank || (idx + 1)));

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
    prevRanks.clear();
    rowElementMap.forEach((row) => {
      if (row) {
        row.style.transition = "";
        row.style.transform = "";
        row.style.zIndex = "";
        row.classList.remove("overtake-flash", "split-flash-gold", "split-flash-green", "split-flash-red");
        delete row.dataset.lastEffectTime;
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
