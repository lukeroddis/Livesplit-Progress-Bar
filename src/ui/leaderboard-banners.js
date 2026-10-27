/**
 * src/ui/leaderboard-banners.js - Leaderboard Status Badge & Banners
 *
 * - Status badge: START Ns / GO! / LOBBY / SIM / LIVE / FINISHED / PREVIEW
 * - Countdown banner (3, 2, 1, GO!) and lobby banner (ready count or latest join/ready event)
 * - "Waiting for runner split telemetry" state when connected with no entrants
 */

(function () {
  "use strict";

  const escapeHtml = (str) => window.LiveSplit.DOMUtils.escapeHtml(str);

  const LOBBY_EVENT_ICONS = {
    ready: "&#9989;",
    unready: "&#9203;",
    leave: "&#128682;",
    join: "&#128100;"
  };
  const RECENT_EVENT_MS = 5000;

  function setBadge(badge, text, statusClass) {
    badge.innerText = text;
    badge.className = `leaderboard-status ${statusClass}`;
  }

  /**
   * @param {HTMLElement|null} badge
   * @param {Object} s - { cdSec, isCountingDown, isPreRaceLobby, isSim, isConn, entrants }
   */
  function renderStatusBadge(badge, s) {
    if (!badge) return;
    const allDone = s.entrants.length > 0 && s.entrants.every(r => r.isFinished || r.isDNF);
    if (s.isCountingDown) {
      setBadge(badge, s.cdSec > 0 ? `START ${s.cdSec}s` : "GO!", "status-countdown");
    } else if (s.isPreRaceLobby) {
      setBadge(badge, "LOBBY", "status-lobby");
    } else if (s.isSim) {
      setBadge(badge, allDone ? "FINISHED" : "SIM", allDone ? "status-finished" : "status-sim");
    } else if (s.isConn) {
      setBadge(badge, allDone ? "FINISHED" : "LIVE", allDone ? "status-finished" : "status-live");
    } else {
      setBadge(badge, "PREVIEW", "status-preview");
    }
  }

  // Banners sit above the rows inside the race board (or the rows' parent)
  function getBannerContainer(rowsEl) {
    const raceBoardEl = document.getElementById("race-leaderboard");
    if (raceBoardEl && rowsEl && raceBoardEl.contains(rowsEl)) return raceBoardEl;
    return (rowsEl && rowsEl.parentNode) ? rowsEl.parentNode : raceBoardEl;
  }

  function ensureBanner(container, rowsEl, className) {
    let banner = container.querySelector(`.${className}`);
    if (!banner) {
      banner = document.createElement("div");
      banner.className = className;
      if (rowsEl && container.contains(rowsEl)) {
        container.insertBefore(banner, rowsEl);
      } else {
        container.appendChild(banner);
      }
    }
    return banner;
  }

  function removeBanner(container, className) {
    const banner = container ? container.querySelector(`.${className}`) : null;
    if (banner) banner.remove();
  }

  function syncCountdownBanner(container, rowsEl, isCountingDown, cdSec) {
    if (!isCountingDown || !container) {
      removeBanner(container, "leaderboard-countdown-banner");
      return;
    }
    const cdBanner = ensureBanner(container, rowsEl, "leaderboard-countdown-banner");
    if (cdSec > 0) {
      cdBanner.className = "leaderboard-countdown-banner is-counting";
      cdBanner.innerHTML = `<span class="cd-icon">&#9201;</span><span class="cd-label">RACE STARTING IN</span><strong class="cd-num">${cdSec}s</strong>`;
    } else {
      cdBanner.className = "leaderboard-countdown-banner is-go";
      cdBanner.innerHTML = `<span class="cd-icon">&#128640;</span><strong class="cd-go">GO! GO! GO!</strong>`;
    }
  }

  /**
   * Lobby banner: the latest join/ready event for 5s, otherwise "N/M Runners Ready".
   */
  function syncLobbyBanner(container, rowsEl, show, entrants, latestEvent) {
    if (!show || entrants.length === 0 || !container) {
      removeBanner(container, "leaderboard-lobby-banner");
      return;
    }
    const lobbyBanner = ensureBanner(container, rowsEl, "leaderboard-lobby-banner");
    const hasRecentEvt = latestEvent && (Date.now() - latestEvent.timestamp) < RECENT_EVENT_MS;
    if (hasRecentEvt) {
      const evtIcon = LOBBY_EVENT_ICONS[latestEvent.type] || LOBBY_EVENT_ICONS.join;
      lobbyBanner.innerHTML = `<span class="lobby-banner-icon">${evtIcon}</span><span class="lobby-banner-text">${escapeHtml(latestEvent.text || "")}</span>`;
    } else {
      const readyCount = entrants.filter(r => r.isReady === true || String(r.status || "").toLowerCase() === "ready").length;
      lobbyBanner.innerHTML = `<span class="lobby-banner-icon">&#128101;</span><span class="lobby-banner-text"><strong>${readyCount}/${entrants.length}</strong> Runners Ready</span>`;
    }
  }

  function syncWaitingState(rowsEl, show) {
    let waitingEl = rowsEl.querySelector(".leaderboard-waiting-state");
    if (show) {
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

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LeaderboardBanners = {
    renderStatusBadge,
    getBannerContainer,
    syncCountdownBanner,
    syncLobbyBanner,
    syncWaitingState
  };
})();
