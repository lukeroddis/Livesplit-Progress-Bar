/**
 * src/ui/leaderboard-row.js - Leaderboard Row View Model & DOM
 *
 * describeRow() turns an entrant into everything its timing tower row shows
 * (rank badge, position delta, split label, gap, expected segment markup,
 * tooltips, fastest-segment ribbon, split flash phase). It is pure, so the
 * display rules are unit-testable without a DOM. createRowElement() /
 * updateRowElement() render a description, updating existing rows in place so
 * running CSS animations are never wiped; applySplitFlash() (re)triggers the
 * 4-second split glow.
 */

(function () {
  "use strict";

  const escapeHtml = (str) => window.LiveSplit.DOMUtils.escapeHtml(str);
  const formatGapTime = (sec) => window.LiveSplit.Time.formatGapTime(sec);

  // Numbers format as durations ("27.4s", "1:05"); preformatted strings pass through
  function formatSegmentDuration(sec) {
    if (typeof sec !== "number" || isNaN(sec)) return sec || "--";
    return formatGapTime(sec);
  }

  const SPLIT_FLASH_MS = 4000;
  const SPLIT_FLASH_CLASSES = ["split-flash-gold", "split-flash-green", "split-flash-red"];
  const RIBBON_LABELS = {
    gold: "🥇 1st Fastest Segment",
    silver: "🥈 2nd Fastest Segment",
    bronze: "🥉 3rd Fastest Segment"
  };

  function buildAvatarMarkup(avatar, isHost) {
    return window.LiveSplit.DOMUtils.buildAvatarMarkup(avatar, isHost ? "👤" : "🏎️");
  }

  function describePositionDelta(posDelta, { isDnf, isPreRace, isReady, displayName }) {
    if (isDnf) return { cls: "pos-delta delta-dnf", text: "-", tooltip: "Did not finish" };
    if (isPreRace) {
      return isReady
        ? { cls: "pos-delta delta-ready", text: "✓", tooltip: `${displayName} is ready to race` }
        : { cls: "pos-delta delta-joined", text: "⏳", tooltip: `${displayName} has joined (not ready)` };
    }
    if (posDelta > 0) {
      return { cls: "pos-delta delta-up", text: `▲+${posDelta}`, tooltip: `Moved up ${posDelta} ${posDelta === 1 ? "place" : "places"}` };
    }
    if (posDelta < 0) {
      const n = Math.abs(posDelta);
      return { cls: "pos-delta delta-down", text: `▼${posDelta}`, tooltip: `Dropped ${n} ${n === 1 ? "place" : "places"}` };
    }
    return { cls: "pos-delta delta-same", text: "-", tooltip: "No position change on last split" };
  }

  // 3-phase split name transition over the 4s glow:
  // completed split in gold/green/red, fade out, then the incoming split swipes in
  function describeSplitPhase(splitLabel, effect, effectAge, isEffectActive, isPreRace) {
    if (isPreRace || !isEffectActive) return { text: splitLabel, cls: "racer-split" };
    if (effectAge < 850) {
      return { text: effect.completedSplitName || splitLabel, cls: `racer-split is-completed-${effect.type}` };
    }
    if (effectAge < 1300) {
      return { text: effect.completedSplitName || splitLabel, cls: `racer-split is-completed-${effect.type} split-fade-out` };
    }
    return { text: effect.newSplitName || splitLabel, cls: "racer-split split-swipe-in" };
  }

  function describeRibbon(racer, isDnf, displayName) {
    const tier = (!isDnf && (racer.segmentRibbon || (racer.hasCrown ? "gold" : null))) || null;
    const segName = racer.ribbonSegmentName || racer.crownSegmentName || "split";
    const rawSec = typeof racer.ribbonSegmentTime === "number"
      ? racer.ribbonSegmentTime
      : (typeof racer.crownSegmentTime === "number" ? racer.crownSegmentTime : null);
    const segTime = rawSec !== null
      ? formatSegmentDuration(rawSec)
      : (racer.ribbonSegmentTime || racer.crownSegmentTime || "--");
    return {
      cls: tier ? `racer-ribbon is-active ribbon-${tier}` : "racer-ribbon",
      tooltip: tier && RIBBON_LABELS[tier] ? `${RIBBON_LABELS[tier]} on ${segName}: ${segTime} (${displayName})` : ""
    };
  }

  /**
   * @param {Object} racer - Ranked entrant
   * @param {Object} ctx - { isPreRace, now }
   * @returns {Object} Row description consumed by createRowElement / updateRowElement / applySplitFlash
   */
  function describeRow(racer, ctx) {
    const { isPreRace } = ctx;
    const now = ctx.now || Date.now();
    const isHost = !!racer.isHost;
    const isMuted = !!racer.isMuted;
    const isDnf = !!racer.isDNF;
    const rank = isDnf ? "DNF" : (racer.rank || 1);
    const posClass = isDnf ? "pos-dnf" : `pos-${(typeof rank === "number" && rank <= 3) ? rank : "other"}`;
    const posDelta = (!isDnf && typeof racer.positionDelta === "number" && !isNaN(racer.positionDelta))
      ? Math.trunc(racer.positionDelta)
      : 0;
    const isReady = racer.isReady === true || String(racer.status || "").toLowerCase() === "ready";
    const displayName = racer.username || (isHost ? "You" : "Runner");
    const delta = describePositionDelta(posDelta, { isDnf, isPreRace, isReady, displayName });
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
      }
    } else if (racer.isFinished) {
      expMarkup = `<span class="expected-tag interval-tag">FIN</span>${escapeHtml(expVal)}`;
    } else if (expVal !== "--") {
      const deltaTag = hasPbDelta ? `<span class="${pbDeltaClass}">${escapeHtml(pbDeltaText)}</span><span class="racer-slash">/</span>` : "";
      expMarkup = `${deltaTag}<span class="racer-elapsed">${escapeHtml(elapsedVal)}</span><span class="racer-slash">/</span><span class="expected-tag interval-tag">${expType}</span>${escapeHtml(expVal)}`;
    } else if (hasPbDelta) {
      expMarkup = `<span class="${pbDeltaClass}">${escapeHtml(pbDeltaText)}</span>`;
    }

    const expSource = racer.hasStatisticalPrediction ? "therun.gg prediction" : "PB segment";
    const pbDeltaInfo = hasPbDelta ? ` | PB Delta: ${pbDeltaText}` : "";
    const isLosing = !isPreRace && !isDnf && rank !== 1 && racer.isLosingToLeader === true;
    let gapInfo = `Leader Gap: ${gapVal}`;
    if (racer.gapMode === "live") {
      const behind = racer.splitsBehindLeader || 1;
      gapInfo = `Since leader's last split: ${gapVal} (${behind} ${behind === 1 ? "split" : "splits"} behind)`;
      if (typeof racer.gapReferenceSec === "number") {
        const refText = `${racer.gapReferenceSec < 0 ? "-" : "+"}${formatGapTime(Math.abs(racer.gapReferenceSec))}`;
        gapInfo += ` | Gap at last split: ${refText}${isLosing ? " (losing time)" : ""}`;
      }
    }
    const segmentInfo = `${pbDeltaInfo} | Segment: ${elapsedVal} / ${expVal} (${expSource})`;
    let gapTooltip;
    if (isPreRace) {
      gapTooltip = isReady ? `${displayName} is Ready` : `${displayName} has Joined (Not Ready)`;
    } else if (rank === 1) {
      gapTooltip = `Race Leader${segmentInfo}`;
    } else {
      gapTooltip = gapVal === "--" ? `Split 1 in progress${segmentInfo}` : `${gapInfo}${segmentInfo}`;
    }

    const effect = racer.lastSplitEffect;
    const effectAge = effect ? (now - (effect.timestamp || 0)) : Infinity;
    const isEffectActive = !!(!isDnf && effect && effect.type && effectAge >= 0 && effectAge < SPLIT_FLASH_MS);
    const split = describeSplitPhase(splitLabel, effect, effectAge, isEffectActive, isPreRace);
    const ribbon = describeRibbon(racer, isDnf, displayName);

    const rowTitle = isDnf
      ? `${displayName} did not finish (DNF)`
      : (isHost
        ? "Your race progress"
        : (isMuted ? "Double-click to show runner pin on track" : "Double-click to hide runner pin on track"));

    return {
      userId: racer.userId || "unknown",
      isHost, isMuted, isDnf, isReady, isPreRace, isLosing,
      rank, posClass, color, displayName, rowTitle,
      deltaClass: delta.cls, deltaText: delta.text, deltaTooltip: delta.tooltip,
      splitText: split.text, splitClass: split.cls,
      gapVal, gapTooltip, expMarkup,
      ribbonClass: ribbon.cls, ribbonTooltip: ribbon.tooltip,
      avatar: typeof racer.avatar === "string" ? racer.avatar : "",
      rawAvatar: racer.avatar,
      effect, effectAge, isEffectActive,
      flashClass: isEffectActive ? `split-flash-${effect.type}` : null
    };
  }

  function gapClassSuffix(d) {
    return `${(!d.isPreRace && d.rank === 1) ? " is-leader" : ""}${d.isPreRace ? (d.isReady ? " gap-ready" : " gap-joined") : ""}${d.isLosing ? " is-losing" : ""}`;
  }

  function createRowElement(d) {
    const row = document.createElement("div");
    row.className = `leaderboard-row${d.isHost ? " is-host" : ""}${d.isMuted ? " is-muted" : ""}${d.isDnf ? " is-dnf" : ""}`;
    row.setAttribute("data-user-id", d.userId);
    row.title = d.rowTitle;
    row.style.setProperty("--racer-color", d.color);
    row.innerHTML = `
          <div class="${d.ribbonClass}" title="${escapeHtml(d.ribbonTooltip)}"></div>
          <div class="pos-col">
            <div class="pos-badge ${d.posClass}">${d.rank}</div>
            <span class="${d.deltaClass}" title="${escapeHtml(d.deltaTooltip)}">${escapeHtml(d.deltaText)}</span>
          </div>
          <div class="racer-accent-bar"></div>
          <div class="racer-avatar-container">
            <div class="racer-avatar-badge">${buildAvatarMarkup(d.rawAvatar, d.isHost)}</div>
          </div>
          <div class="racer-name-block">
            <span class="racer-name"><span class="marquee-text">${escapeHtml(d.displayName)}</span></span>
            <span class="${d.splitClass}"><span class="marquee-text">${escapeHtml(d.splitText)}</span></span>
          </div>
          <div class="racer-gap-col" title="${escapeHtml(d.gapTooltip)}">
            <span class="racer-gap${gapClassSuffix(d)}">${d.gapVal}</span>
            <span class="racer-expected racer-interval">${d.expMarkup}</span>
          </div>
        `;
    row.dataset.avatar = d.avatar;
    return row;
  }

  function setIfChanged(el, prop, value) {
    if (el && el[prop] !== value) el[prop] = value;
  }

  /**
   * Updates an existing row in place, touching only values that changed so
   * running CSS animations are never wiped.
   */
  function updateRowElement(row, d, marquee) {
    row.classList.toggle("is-host", d.isHost);
    row.classList.toggle("is-muted", d.isMuted);
    row.classList.toggle("is-dnf", d.isDnf);
    setIfChanged(row, "title", d.rowTitle);
    row.style.setProperty("--racer-color", d.color);

    const posBadge = row.querySelector(".pos-badge");
    if (posBadge) {
      if (posBadge.textContent !== String(d.rank)) posBadge.textContent = d.rank;
      setIfChanged(posBadge, "className", `pos-badge ${d.posClass}`);
    }

    const posDeltaEl = row.querySelector(".pos-delta");
    setIfChanged(posDeltaEl, "textContent", d.deltaText);
    setIfChanged(posDeltaEl, "className", d.deltaClass);
    setIfChanged(posDeltaEl, "title", d.deltaTooltip);

    let ribbonEl = row.querySelector(".racer-ribbon");
    if (!ribbonEl) {
      ribbonEl = document.createElement("div");
      ribbonEl.className = "racer-ribbon";
      row.insertBefore(ribbonEl, row.firstChild);
    }
    setIfChanged(ribbonEl, "className", d.ribbonClass);
    setIfChanged(ribbonEl, "title", d.ribbonTooltip);

    // Avatars usually arrive after the row exists (therun.gg profile lookup)
    if (row.dataset.avatar !== d.avatar) {
      const badgeEl = row.querySelector(".racer-avatar-badge");
      if (badgeEl) badgeEl.innerHTML = buildAvatarMarkup(d.rawAvatar, d.isHost);
      row.dataset.avatar = d.avatar;
    }

    const nameEl = row.querySelector(".racer-name");
    if (nameEl) marquee.setText(nameEl, d.displayName);

    const splitEl = row.querySelector(".racer-split");
    if (splitEl) {
      marquee.setText(splitEl, d.splitText);
      setIfChanged(splitEl, "className", d.splitClass);
    }

    const gapEl = row.querySelector(".racer-gap");
    if (gapEl) {
      setIfChanged(gapEl, "textContent", d.gapVal);
      gapEl.classList.toggle("is-leader", !d.isPreRace && d.rank === 1);
      gapEl.classList.toggle("gap-ready", d.isPreRace && d.isReady);
      gapEl.classList.toggle("gap-joined", d.isPreRace && !d.isReady);
      gapEl.classList.toggle("is-losing", d.isLosing);
    }

    setIfChanged(row.querySelector(".racer-expected, .racer-interval"), "innerHTML", d.expMarkup);
    setIfChanged(row.querySelector(".racer-gap-col"), "title", d.gapTooltip);
  }

  /** (Re)starts the split glow when a new split effect arrives, offset by its age; clears it when expired. */
  function applySplitFlash(row, d) {
    const hasFlash = SPLIT_FLASH_CLASSES.some((c) => row.classList.contains(c));
    if (d.isEffectActive && String(d.effect.timestamp) !== row.dataset.lastEffectTime) {
      row.classList.remove(...SPLIT_FLASH_CLASSES);
      void row.offsetWidth;
      const initialDelaySec = Math.max(0, (d.effectAge / 1000)).toFixed(2);
      row.style.animationDelay = (initialDelaySec > 0.05) ? `-${initialDelaySec}s` : "";
      row.classList.add(d.flashClass);
      row.dataset.lastEffectTime = String(d.effect.timestamp);
    } else if (!d.isEffectActive && hasFlash) {
      row.classList.remove(...SPLIT_FLASH_CLASSES);
      row.style.animationDelay = "";
      delete row.dataset.lastEffectTime;
    }
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LeaderboardRow = {
    SPLIT_FLASH_CLASSES,
    formatSegmentDuration,
    describeRow,
    createRowElement,
    updateRowElement,
    applySplitFlash
  };
})();
