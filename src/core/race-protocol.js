/**
 * src/core/race-protocol.js - WebSocket Telemetry & Protocol Message Parser
 * 
 * Manages protocol message parsing and telemetry normalization for therun.gg races:
 * - Single and doubly-nested message envelope unwrapping (result, data, action, event)
 * - Race-level status detection (open, starting, in_progress, finished)
 * - Countdown state tracking and start timestamp parsing
 * - Authoritative room snapshots vs incremental participant telemetry updates
 * - Telemetry unit conversions (milliseconds to seconds, delta normalization)
 * - High-precision dead-reckoning progress and split flash determination
 */

(function () {
  "use strict";

  const DEFAULT_RACER_PALETTE = [
    "#38bdf8", // Sky Cyan
    "#f59e0b", // Amber / Gold
    "#ec4899", // Neon Pink
    "#10b981", // Emerald Green
    "#a855f7", // Violet
    "#f97316", // Coral Orange
    "#06b6d4", // Cyan
    "#eab308", // Yellow
    "#8b5cf6", // Purple
    "#14b8a6"  // Teal
  ];

  function getStatus(ctx) {
    return ctx ? (typeof ctx.getRaceStatus === "function" ? ctx.getRaceStatus() : ctx.raceStatus) : "open";
  }

  function setStatus(ctx, val) {
    if (!ctx) return;
    if (typeof ctx.setRaceStatus === "function") ctx.setRaceStatus(val);
    else ctx.raceStatus = val;
  }

  function setCountdownTarget(ctx, val) {
    if (!ctx) return;
    if (typeof ctx.setCountdownTargetMs === "function") ctx.setCountdownTargetMs(val);
    else ctx.countdownTargetMs = val;
  }

  function setCountdownSec(ctx, val) {
    if (!ctx) return;
    if (typeof ctx.setCountdownSeconds === "function") ctx.setCountdownSeconds(val);
    else ctx.countdownSeconds = val;
  }

  function emitRaceEvent(ctx, evt) {
    if (ctx && typeof ctx.pushRaceEvent === "function") {
      ctx.pushRaceEvent(evt);
    }
  }

  function emitNotification(ctx, eventType, payload) {
    if (ctx && typeof ctx.notifyListeners === "function") {
      ctx.notifyListeners(eventType, payload);
    }
  }

  function normalizeSplits(times) {
    if (window.LiveSplit && window.LiveSplit.RaceRanking && typeof window.LiveSplit.RaceRanking.normalizeSplitTimes === "function") {
      return window.LiveSplit.RaceRanking.normalizeSplitTimes(times);
    }
    if (!times) return [];
    if (Array.isArray(times)) {
      return times
        .map(t => (typeof t === "number" ? t : parseFloat(t)))
        .filter(t => typeof t === "number" && !isNaN(t));
    }
    return [];
  }

  // therun.gg transmits milliseconds; values under 500 are treated as already-converted seconds
  function msToSec(val) {
    return val > 500 ? (val / 1000) : val;
  }

  /**
   * Merges per-split cumulative times into an index-aligned splitTimes copy.
   * splitPredictions entries are keyed one ahead (splitIndex k holds split k-1's time);
   * live run `splits` entries carry their own index.
   */
  function mergeSplitPredictions(splitTimes, preds) {
    const merged = Array.isArray(splitTimes) ? splitTimes.slice() : [];
    preds.forEach((sp) => {
      if (sp && typeof sp.splitIndex === "number" && sp.splitIndex >= 1 && sp.currentTime !== undefined && sp.currentTime !== null) {
        const t = Number(sp.currentTime);
        if (!isNaN(t) && t > 0) {
          merged[sp.splitIndex - 1] = msToSec(t);
        }
      }
    });
    return merged;
  }

  function mergeRunSplits(splitTimes, splits) {
    const merged = Array.isArray(splitTimes) ? splitTimes.slice() : [];
    splits.forEach((s, idx) => {
      if (s && typeof s.splitTime === "number" && !isNaN(s.splitTime) && s.splitTime > 0) {
        merged[idx] = msToSec(s.splitTime);
      }
    });
    return merged;
  }

  /**
   * Normalizes incoming telemetry and updates or creates an entrant in the context entrants Map.
   * @param {Object} data - Raw participant telemetry data packet
   * @param {Object} ctx - Protocol context
   * @param {Object} [opts] - { silent: true } applies a catch-up snapshot without split flash effects
   */
  function updateEntrantFromTelemetry(data, ctx, opts = {}) {
    if (!data || typeof data !== "object" || !ctx) return;

    const entrants = ctx.entrants || new Map();
    const hostState = ctx.hostState || {};
    const hostUsername = ctx.hostUsername || "";
    const palette = ctx.RACER_PALETTE || DEFAULT_RACER_PALETTE;
    const activeSplitsList = ctx.activeSplitsList || [];
    const lastKnownRanks = ctx.lastKnownRanks || new Map();
    const checkpointRankHistory = ctx.checkpointRankHistory || new Map();

    const live = (data.liveData && typeof data.liveData === "object")
      ? data.liveData
      : ((data.run && typeof data.run === "object") ? data.run : null);

    const uId = data.userId || data.login || data.user || (live && (live.userId || live.login || live.user)) || `racer_${entrants.size + 1}`;
    if (uId === hostState.userId) {
      return; // Standalone host state handled locally
    }

    const rawSplitName = (live && live.currentSplitName) || data.currentSplitName || "";
    const rawName = data.user || data.username || data.login || (live && (live.user || live.username || live.login)) || uId;
    let statusStr = "";
    if (data.status !== undefined && data.status !== null) {
      statusStr = String(data.status?.value || data.status?.name || data.status?.text || data.status || "").toLowerCase().trim();
    }
    if (!statusStr) {
      if (data.ready === true || data.isReady === true || (live && (live.ready === true || live.isReady === true))) {
        statusStr = "ready";
      } else if (data.ready === false || data.isReady === false || (live && (live.ready === false || live.isReady === false))) {
        statusStr = "joined";
      } else if (data.action) {
        const act = String(data.action).toLowerCase().trim();
        if (act === "ready") statusStr = "ready";
        else if (act === "unready" || act === "not_ready" || act === "notready") statusStr = "joined";
        else if (act === "joined" || act === "join") statusStr = "joined";
        else if (act === "leave" || act === "left" || act === "unjoin") statusStr = "unjoined";
      } else if (data.type) {
        const t = String(data.type).toLowerCase().trim();
        if (t === "ready") statusStr = "ready";
        else if (t === "unready" || t === "not_ready" || t === "notready") statusStr = "joined";
        else if (t === "joined" || t === "join") statusStr = "joined";
        else if (t === "leave" || t === "left" || t === "unjoin") statusStr = "unjoined";
      }
    }
    if (statusStr === "unready" || statusStr === "not_ready" || statusStr === "notready") {
      statusStr = "joined";
    }

    // Look up entrant by uId or matching username to avoid duplicate entries across event types.
    // Never the local host placeholder: it shares the host's username but is hidden in live
    // rooms, where the host's therun.gg participant is their real row.
    let existing = entrants.get(uId);
    if (!existing && rawName) {
      for (const [id, e] of entrants.entries()) {
        if (id === hostState.userId || e.userId === hostState.userId) continue;
        if (e.username && String(e.username).toLowerCase() === String(rawName).toLowerCase()) {
          existing = e;
          break;
        }
      }
    }
    if (statusStr === "unjoined" || statusStr === "left" || statusStr === "removed") {
      const targetId = existing ? existing.userId : uId;
      entrants.delete(targetId);
      emitRaceEvent(ctx, {
        type: "leave",
        user: rawName,
        text: `${rawName} left the race`,
        timestamp: Date.now()
      });
      lastKnownRanks.delete(uId);
      return;
    }

    const isMatchedHost = !!(hostUsername && (
      String(rawName).trim().toLowerCase() === hostUsername.toLowerCase() ||
      String(uId).trim().toLowerCase() === hostUsername.toLowerCase()
    ));

    const rawPic = data.picture || data.avatar || (live && (live.picture || live.avatar)) || "";

    const isNewEntrant = !existing;
    if (!existing) {
      existing = {
        userId: uId,
        username: rawName,
        avatar: rawPic,
        color: isMatchedHost ? "#38bdf8" : palette[entrants.size % palette.length],
        isHost: isMatchedHost,
        currentSplitIndex: 0,
        currentSplitName: rawSplitName || "Split 1",
        currentTimeSec: 0,
        splitTimes: [],
        isFinished: false,
        finalTimeSec: null,
        score: 0,
        isMuted: false,
        status: statusStr || "joined",
        isReady: (statusStr === "ready")
      };
      entrants.set(uId, existing);
      emitRaceEvent(ctx, {
        type: "join",
        user: rawName,
        text: `${rawName} joined the race`,
        timestamp: Date.now()
      });
    } else if (statusStr && existing.status && existing.status !== statusStr) {
      if (statusStr === "ready") {
        emitRaceEvent(ctx, {
          type: "ready",
          user: rawName,
          text: `${rawName} is Ready`,
          timestamp: Date.now()
        });
      } else if (statusStr === "joined") {
        emitRaceEvent(ctx, {
          type: "unready",
          user: rawName,
          text: `${rawName} unreadied (Joined)`,
          timestamp: Date.now()
        });
      }
    }

    existing.username = rawName;
    existing.isHost = isMatchedHost;
    if (isMatchedHost) {
      existing.color = "#38bdf8";
    }
    if (rawPic) {
      existing.avatar = rawPic;
    }

    const rawCurrentTime = (live && typeof live.currentTime === "number")
      ? live.currentTime
      : (typeof data.currentTime === "number" ? data.currentTime : (typeof data.time === "number" ? data.time : null));
    if (typeof rawCurrentTime === "number") {
      // therun.gg transmits milliseconds
      existing.currentTimeSec = rawCurrentTime > 500 ? (rawCurrentTime / 1000) : rawCurrentTime;
    } else if (typeof data.currentTimeSec === "number") {
      existing.currentTimeSec = data.currentTimeSec;
    }
    existing.reportedTimeSec = existing.currentTimeSec;
    existing.lastUpdateTimestamp = Date.now();
    if (live && typeof live.timeToNextSplit === "number" && live.timeToNextSplit > 0) {
      existing.timeToNextSplit = live.timeToNextSplit > 500 ? (live.timeToNextSplit / 1000) : live.timeToNextSplit;
    }
    if (live && typeof live.streaming === "boolean") {
      existing.isStreaming = live.streaming;
    }

    if (live && typeof live.splitStartedAt === "number" && live.splitStartedAt > 0) {
      existing.splitStartedAt = live.splitStartedAt;
    }
    if (data.status) {
      existing.status = statusStr;
      existing.isReady = (statusStr === "ready");
    }

    // Numeric deltas are always milliseconds (a 320ms delta must not read as 320s);
    // string deltas are LiveSplit-style seconds ("+3.5")
    const rawDelta = (live && live.delta !== undefined) ? live.delta : data.delta;
    if (typeof rawDelta === "number" && !isNaN(rawDelta)) {
      existing.delta = rawDelta;
      existing.deltaSec = rawDelta / 1000;
    } else if (typeof rawDelta === "string" && !isNaN(parseFloat(rawDelta))) {
      const p = parseFloat(rawDelta);
      existing.delta = p;
      existing.deltaSec = p;
    }

    // Completed checkpoint times: explicit splitTimes, else splitPredictions (sent with every
    // participantUpdate, so a runner first seen mid-race gets their full history)
    const rawSplitTimes = (live && Array.isArray(live.splitTimes)) ? live.splitTimes : data.splitTimes;
    const rawSplitPreds = (live && Array.isArray(live.splitPredictions)) ? live.splitPredictions : data.splitPredictions;
    if (Array.isArray(rawSplitTimes)) {
      existing.splitTimes = normalizeSplits(rawSplitTimes);
    } else if (Array.isArray(rawSplitPreds) && rawSplitPreds.length > 0) {
      existing.splitTimes = mergeSplitPredictions(existing.splitTimes, rawSplitPreds);
    }

    const rawSplitIdx = (live && typeof live.currentSplitIndex === "number")
      ? live.currentSplitIndex
      : data.currentSplitIndex;
    const rawIsGold = (live && (live.isGold === true || live.gold === true || live.split?.isGold === true)) ||
      data.isGold === true || data.gold === true || data.split?.isGold === true;

    if (typeof rawSplitIdx === "number" && rawSplitIdx >= 0) {
      if (!Array.isArray(existing.splitTimes)) {
        existing.splitTimes = [];
      }
      // Catch-up snapshots, and runners first seen long after their last split, jump straight
      // to their current split without a split flash
      const splitStartedMs = (live && typeof live.splitStartedAt === "number") ? live.splitStartedAt : 0;
      const isStaleSighting = isNewEntrant && splitStartedMs > 0 && Math.abs(Date.now() - splitStartedMs) >= 4000;
      const isFreshSplit = !opts.silent && !isStaleSighting;
      if (rawSplitIdx > existing.currentSplitIndex && !isFreshSplit) {
        if (existing.currentTimeSec > 0 && typeof existing.splitTimes[rawSplitIdx - 1] !== "number") {
          existing.splitTimes[rawSplitIdx - 1] = existing.currentTimeSec;
        }
      } else if (rawSplitIdx > existing.currentSplitIndex) {
        // Completed a split! Determine split type from telemetry
        let flashType = "green";
        if (rawIsGold) {
          flashType = "gold";
        } else if (typeof rawDelta === "number") {
          flashType = rawDelta <= 0 ? "green" : "red";
        } else if (typeof rawDelta === "string") {
          flashType = rawDelta.trim().startsWith("+") ? "red" : "green";
        } else if (data.gainedTime === false || (live && live.gainedTime === false)) {
          flashType = "red";
        }
        const prevSplitName = (live && live.previousSplitName)
          || (!isNewEntrant && existing.currentSplitName)
          || (activeSplitsList && activeSplitsList[rawSplitIdx - 1])
          || `Split ${rawSplitIdx}`;
        const nextSplitName = rawSplitName
          || (activeSplitsList && activeSplitsList[rawSplitIdx])
          || `Split ${rawSplitIdx + 1}`;
        existing.lastSplitEffect = {
          type: flashType,
          timestamp: Date.now(),
          completedSplitName: prevSplitName,
          newSplitName: nextSplitName
        };
        if (existing.currentTimeSec > 0) {
          existing.splitTimes[rawSplitIdx - 1] = existing.currentTimeSec;
        }
      } else if (rawSplitIdx < existing.currentSplitIndex) {
        if (Array.isArray(existing.splitTimes)) {
          existing.splitTimes = existing.splitTimes.slice(0, Math.max(0, rawSplitIdx));
        }
        checkpointRankHistory.forEach((histMap, c) => {
          if (c >= rawSplitIdx) {
            histMap.delete(uId);
          }
        });
      }
      existing.currentSplitIndex = rawSplitIdx;
    }

    if (rawSplitName) {
      existing.currentSplitName = rawSplitName;
    } else if (!existing.currentSplitName) {
      existing.currentSplitName = "Split 1";
    }
    const rawSplits = (live && (Array.isArray(live.splits) ? live.splits : (live.runData && Array.isArray(live.runData.splits) ? live.runData.splits : null)))
      || (Array.isArray(data.splits) ? data.splits : null);
    if (Array.isArray(rawSplits)) {
      existing.splits = rawSplits;
      if (!Array.isArray(rawSplitTimes) && (!Array.isArray(rawSplitPreds) || rawSplitPreds.length === 0)) {
        existing.splitTimes = mergeRunSplits(existing.splitTimes, rawSplits);
      }
    }

    const rawMonteCarlo = (live && live.monteCarloPrediction) || data.monteCarloPrediction;
    if (rawMonteCarlo) {
      existing.monteCarloPrediction = rawMonteCarlo;
    }

    const rawPred = (live && typeof live.currentPrediction === "number")
      ? live.currentPrediction
      : ((live && typeof live.estimatedFinishTime === "number")
        ? live.estimatedFinishTime
        : (typeof data.currentPrediction === "number"
          ? data.currentPrediction
          : (typeof data.estimatedFinishTime === "number" ? data.estimatedFinishTime : null)));
    if (typeof rawPred === "number" && rawPred > 0) {
      existing.currentPrediction = rawPred > 500 ? (rawPred / 1000) : rawPred;
    }
    if (data.pb !== undefined && data.pb !== null && !isNaN(Number(data.pb)) && Number(data.pb) > 0) {
      const pbVal = Number(data.pb);
      existing.pbSec = pbVal > 500 ? (pbVal / 1000) : pbVal;
    }

    const rawFinalTime = (data.finalTime !== undefined && data.finalTime !== null && !isNaN(Number(data.finalTime)) && Number(data.finalTime) > 0)
      ? Number(data.finalTime)
      : ((live && typeof live.finalTime === "number" && live.finalTime > 0) ? live.finalTime : null);

    const isDnf = data.isDNF === true ||
                  data.dnf === true ||
                  data.forfeited === true ||
                  data.isForfeit === true ||
                  data.disqualified === true ||
                  statusStr === "forfeited" ||
                  statusStr === "abandoned" ||
                  statusStr === "dnf" ||
                  statusStr === "quit" ||
                  (data.hasEnded === true && !data.isFinished && !existing.isFinished && statusStr !== "finished" && statusStr !== "confirmed" && rawFinalTime === null);
    const isFin = !isDnf && (
      statusStr === "finished" ||
      statusStr === "confirmed" ||
      data.isFinished === true ||
      (live && live.runFinished === true) ||
      data.hasEnded === true ||
      rawFinalTime !== null
    );

    if (isDnf) {
      existing.isDNF = true;
      existing.isFinished = false;
      if (!existing.dnfTimeSec) existing.dnfTimeSec = existing.currentTimeSec || 0;
      existing.currentSplitName = "DNF";
    } else if (isFin) {
      existing.isFinished = true;
      existing.isDNF = false;
      if (rawFinalTime !== null) {
        existing.finalTimeSec = rawFinalTime > 500 ? (rawFinalTime / 1000) : rawFinalTime;
        existing.currentTimeSec = existing.finalTimeSec;
      } else if (!existing.finalTimeSec) {
        existing.finalTimeSec = existing.currentTimeSec;
      }
      existing.currentSplitName = "Finished";
    }

    const rawRunPct = (live && typeof live.runPercentage === "number")
      ? live.runPercentage
      : ((live && typeof live.runPercentageTime === "number")
        ? live.runPercentageTime
        : ((live && typeof live.runPercentageSplits === "number")
          ? live.runPercentageSplits
          : (typeof data.runPercentage === "number" ? data.runPercentage : null)));
    let normRunPct = rawRunPct !== null
      ? (rawRunPct > 1 ? (rawRunPct / 100) : rawRunPct)
      : 0;

    if (!normRunPct && live && typeof live.estimatedFinishTime === "number" && live.estimatedFinishTime > 0 && typeof live.currentTime === "number" && live.currentTime > 0) {
      normRunPct = Math.min(0.999, live.currentTime / live.estimatedFinishTime);
    }
    if (existing.isFinished) {
      normRunPct = 1.0;
    }

    const totalSplits = (live && typeof live.totalSplits === "number" && live.totalSplits > 0)
      ? live.totalSplits
      : ((Array.isArray(existing.splits) && existing.splits.length > 0) ? existing.splits.length : (Array.isArray(data.splits) ? data.splits.length : 0));
    existing.totalSplits = totalSplits;
    existing.runPercentage = normRunPct;

    // Calculate within-split ratio for current split
    let inSegRatio = null;
    if (normRunPct > 0 && totalSplits > 0) {
      const withinFromOverall = (normRunPct * totalSplits) - existing.currentSplitIndex;
      if (withinFromOverall >= 0 && withinFromOverall <= 1.0) {
        inSegRatio = withinFromOverall;
      }
    }

    // High-precision dead-reckoning progress calculation using predicted single duration or PB
    if (typeof rawCurrentTime === "number" && !existing.isFinished && !existing.isDNF) {
      const curSec = existing.currentTimeSec || 0;
      const curIdx = existing.currentSplitIndex || 0;
      let prevTimeSec = 0;
      const prevSplit = (curIdx > 0 && Array.isArray(existing.splits) && existing.splits[curIdx - 1]) ? existing.splits[curIdx - 1] : null;
      if (prevSplit && typeof prevSplit.splitTime === "number") {
        prevTimeSec = prevSplit.splitTime > 500 ? (prevSplit.splitTime / 1000) : prevSplit.splitTime;
      } else if (prevSplit && typeof prevSplit.pbSplitTime === "number") {
        prevTimeSec = prevSplit.pbSplitTime > 500 ? (prevSplit.pbSplitTime / 1000) : prevSplit.pbSplitTime;
      }

      const elapsedInSeg = Math.max(0, curSec - prevTimeSec);
      const curSplit = (Array.isArray(existing.splits) && existing.splits[curIdx]) ? existing.splits[curIdx] : null;
      let expectedDur = 30.0;
      if (curSplit && typeof curSplit.predictedSingleTime === "number" && curSplit.predictedSingleTime > 0) {
        expectedDur = curSplit.predictedSingleTime > 500 ? (curSplit.predictedSingleTime / 1000) : curSplit.predictedSingleTime;
      } else if (curSplit && curSplit.single && parseFloat(curSplit.single.averageTime) > 0) {
        const avg = parseFloat(curSplit.single.averageTime);
        expectedDur = avg > 500 ? (avg / 1000) : avg;
      } else if (curSplit && typeof curSplit.pbSplitTime === "number") {
        const pbCur = curSplit.pbSplitTime > 500 ? (curSplit.pbSplitTime / 1000) : curSplit.pbSplitTime;
        expectedDur = Math.max(0.5, pbCur - prevTimeSec);
      }
      const deadReckonRatio = Math.max(0, Math.min(0.99, elapsedInSeg / Math.max(0.5, expectedDur)));
      if (inSegRatio === null || Math.abs(deadReckonRatio - inSegRatio) > 0.05) {
        inSegRatio = deadReckonRatio;
      }
    }

    if (inSegRatio === null) {
      inSegRatio = 0.5;
    }

    existing.score = existing.isFinished
      ? (activeSplitsList ? activeSplitsList.length : existing.currentSplitIndex + 1)
      : existing.currentSplitIndex + inSegRatio;

    if (existing.isDNF && existing.dnfScore === undefined) {
      existing.dnfScore = existing.score;
    }

    entrants.set(uId, existing);

    // Let the client catch the newcomer up (full split history and avatar from therun.gg)
    if (isNewEntrant && typeof ctx.onEntrantDiscovered === "function") {
      ctx.onEntrantDiscovered(existing);
    }
  }

  /**
   * Parses an incoming WebSocket message payload, updates race state and entrants.
   * @param {Object} msg - Raw message object
   * @param {Object} ctx - Protocol context
   */
  function parseRaceMessage(msg, ctx) {
    if (!msg || !ctx) return;

    // Ignore pure chat messages on the race websocket
    if (msg.type === "chat" || (msg.type === "message" && typeof msg.message === "string" && !msg.data && !msg.user && !msg.username && !msg.userId && !msg.participants && !msg.countdown && !msg.startTime)) {
      return;
    }

    const payload = (msg.result !== undefined && msg.result !== null)
      ? msg.result
      : ((msg.data !== undefined && msg.data !== null) ? msg.data : msg);

    if (!payload) return;

    // Extract inner data and raw message type across single or doubly-nested envelopes
    let rawMsgType = String(msg.type || msg.action || msg.event || "").toLowerCase().trim();
    let innerData = payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if (payload.type && typeof payload.type === "string") {
        rawMsgType = String(payload.type).toLowerCase().trim();
      }
      if (payload.data !== undefined && payload.data !== null && typeof payload.data === "object" && !Array.isArray(payload.data)) {
        innerData = payload.data;
        if (innerData.type && typeof innerData.type === "string") {
          rawMsgType = String(innerData.type).toLowerCase().trim();
        }
        if (innerData.data !== undefined && innerData.data !== null && typeof innerData.data === "object" && !Array.isArray(innerData.data)) {
          innerData = innerData.data;
        }
      }
    }

    // 1. Process Race-Level Status, Countdown, and Start Times
    const rawStatus = (innerData && (innerData.raceStatus || innerData.status || innerData.state)) ||
      (payload && (payload.raceStatus || payload.status || payload.state)) ||
      (payload && payload.race && (payload.race.raceStatus || payload.race.status || payload.race.state)) ||
      msg.status || msg.raceStatus || msg.state;

    let detectedCountdown = null;
    if (typeof innerData.countdown === "number" && !isNaN(innerData.countdown)) {
      detectedCountdown = innerData.countdown;
    } else if (typeof innerData.countdownSeconds === "number" && !isNaN(innerData.countdownSeconds)) {
      if (rawStatus === "starting" || rawStatus === "countdown") {
        detectedCountdown = innerData.countdownSeconds;
      }
    } else if (typeof payload.countdown === "number" && !isNaN(payload.countdown)) {
      detectedCountdown = payload.countdown;
    } else if (typeof payload.countdownSeconds === "number" && !isNaN(payload.countdownSeconds)) {
      if (rawStatus === "starting" || rawStatus === "countdown") {
        detectedCountdown = payload.countdownSeconds;
      }
    } else if (typeof msg.countdown === "number" && !isNaN(msg.countdown)) {
      detectedCountdown = msg.countdown;
    } else if ((rawMsgType === "countdown" || rawMsgType === "starting") && typeof msg.value === "number") {
      detectedCountdown = msg.value;
    } else if ((rawMsgType === "countdown" || rawMsgType === "starting") && typeof msg.seconds === "number") {
      detectedCountdown = msg.seconds;
    }

    const rawStartTime = (innerData && (innerData.startTime || innerData.startDate || innerData.start_time)) ||
      (payload && (payload.startTime || payload.startDate || payload.start_time)) ||
      (payload && payload.race && (payload.race.startTime || payload.race.startDate || payload.race.start_time)) ||
      msg.startTime || msg.startDate || msg.start_time;

    let currentRaceStatus = getStatus(ctx);

    if (detectedCountdown !== null) {
      if (detectedCountdown > 0) {
        setCountdownTarget(ctx, Date.now() + (detectedCountdown * 1000));
        setCountdownSec(ctx, Math.ceil(detectedCountdown));
        setStatus(ctx, "starting");
        emitRaceEvent(ctx, {
          type: "countdown",
          text: `Race starting in ${Math.ceil(detectedCountdown)}s`,
          timestamp: Date.now()
        });
      } else {
        setCountdownTarget(ctx, null);
        setCountdownSec(ctx, 0);
        setStatus(ctx, "in_progress");
        emitRaceEvent(ctx, {
          type: "started",
          text: "Race started! Good luck!",
          timestamp: Date.now()
        });
      }
    } else if (rawStartTime) {
      let sMs = 0;
      if (typeof rawStartTime === "number") {
        sMs = rawStartTime > 1e11 ? rawStartTime : (rawStartTime * 1000);
      } else if (typeof rawStartTime === "string") {
        const parsed = Date.parse(rawStartTime);
        if (!isNaN(parsed)) sMs = parsed;
      }
      if (sMs > Date.now()) {
        setCountdownTarget(ctx, sMs);
        setStatus(ctx, "starting");
        const remSec = Math.ceil((sMs - Date.now()) / 1000);
        emitRaceEvent(ctx, {
          type: "countdown",
          text: `Race starting in ${remSec}s`,
          timestamp: Date.now()
        });
      } else if (sMs > 0 && Date.now() >= sMs && currentRaceStatus === "starting") {
        setCountdownTarget(ctx, null);
        setCountdownSec(ctx, 0);
        setStatus(ctx, "in_progress");
        emitRaceEvent(ctx, {
          type: "started",
          text: "Race started! Good luck!",
          timestamp: Date.now()
        });
      }
    }

    if (rawStatus && typeof rawStatus === "string") {
      const s = rawStatus.toLowerCase().trim();
      if (s === "starting" || s === "countdown") {
        setStatus(ctx, "starting");
      } else if (s === "started" || s === "in_progress" || s === "progress") {
        setStatus(ctx, "in_progress");
        setCountdownTarget(ctx, null);
        setCountdownSec(ctx, null);
      } else if (s === "finished" || s === "confirmed") {
        setStatus(ctx, "finished");
        setCountdownTarget(ctx, null);
        setCountdownSec(ctx, null);
      } else if (s === "pending" || s === "open" || s === "lobby" || s === "ready" || s === "waiting") {
        if (getStatus(ctx) !== "starting") {
          setStatus(ctx, "open");
        }
      }
    }

    const raceMsgType = rawMsgType;
    const raceMsgData = (innerData && typeof innerData === "object")
      ? innerData
      : ((payload && typeof payload === "object") ? payload : null);

    if (raceMsgType === "race-starting" || raceMsgType === "race_starting") {
      setStatus(ctx, "starting");
    } else if (raceMsgType === "race-start-canceled" || raceMsgType === "race_start_canceled") {
      setStatus(ctx, "open");
      setCountdownTarget(ctx, null);
      setCountdownSec(ctx, null);
      emitRaceEvent(ctx, {
        type: "canceled",
        text: "Race countdown canceled",
        timestamp: Date.now()
      });
    } else if (raceMsgType === "race-started" || raceMsgType === "race_started") {
      setStatus(ctx, "in_progress");
      setCountdownTarget(ctx, null);
      setCountdownSec(ctx, 0);
      emitRaceEvent(ctx, {
        type: "started",
        text: "Race started! Good luck!",
        timestamp: Date.now()
      });
    }

    // participant-* room events describe one runner; their inner data must not be parsed
    // a second time by the generic runner-update fallback below
    const isParticipantEvent = raceMsgType.startsWith("participant-");
    if (raceMsgType === "race-finish" || raceMsgType === "race-abort") {
      setStatus(ctx, "finished");
      setCountdownTarget(ctx, null);
      setCountdownSec(ctx, null);
    } else if (raceMsgType === "participant-ready") {
      const u = raceMsgData?.user || payload.user;
      if (u) updateEntrantFromTelemetry({ user: u, status: "ready" }, ctx);
    } else if (raceMsgType === "participant-unready") {
      const u = raceMsgData?.user || payload.user;
      if (u) updateEntrantFromTelemetry({ user: u, status: "joined" }, ctx);
    } else if (raceMsgType === "participant-join") {
      const u = raceMsgData?.user || payload.user;
      if (u) updateEntrantFromTelemetry({ user: u, status: "joined" }, ctx);
    } else if (raceMsgType === "participant-unjoin") {
      const u = raceMsgData?.user || payload.user;
      if (u) updateEntrantFromTelemetry({ user: u, status: "unjoined" }, ctx);
    } else if (raceMsgType === "participant-abandon") {
      const u = raceMsgData?.user || payload.user;
      if (u) updateEntrantFromTelemetry({ user: u, status: "abandoned" }, ctx);
    } else if (raceMsgType === "participant-split" && raceMsgData) {
      // splitName is the split just COMPLETED, not the one the runner is now on. The
      // participantUpdate carrying the new currentSplitName can arrive before or after this
      // event, so this event must never overwrite the runner's current split name.
      updateEntrantFromTelemetry({
        user: raceMsgData.user,
        currentTime: raceMsgData.time,
        runPercentage: raceMsgData.percentage
      }, ctx);
    }

    if (rawMsgType === "race_started" || rawMsgType === "start" || rawMsgType === "go") {
      setStatus(ctx, "in_progress");
      setCountdownTarget(ctx, null);
      setCountdownSec(ctx, 0);
      emitRaceEvent(ctx, {
        type: "started",
        text: "Race started! Good luck!",
        timestamp: Date.now()
      });
    }

    // Handle full authoritative entrants/participants snapshot or incremental runner update
    const participantsList = (innerData && Array.isArray(innerData.participants)) ? innerData.participants
      : ((payload && Array.isArray(payload.participants)) ? payload.participants
      : ((innerData && Array.isArray(innerData.entrants)) ? innerData.entrants
      : ((payload && Array.isArray(payload.entrants)) ? payload.entrants
      : (Array.isArray(innerData) ? innerData : (Array.isArray(payload) ? payload : null)))));

    const entrants = ctx.entrants || new Map();
    const hostState = ctx.hostState || {};
    const lastKnownRanks = ctx.lastKnownRanks || new Map();

    if (Array.isArray(participantsList)) {
      // In live room: authoritative snapshot from therun.gg prunes anyone who left the race
      const activeUsers = new Set(participantsList.map(p => String(p.user || p.username || p.userId || "").toLowerCase().trim()).filter(Boolean));
      if (ctx.isLiveRoom) {
        for (const [id, e] of entrants.entries()) {
          if (e.isHost || id === hostState.userId) continue;
          const u = String(e.username || e.userId || "").toLowerCase().trim();
          if (u && !activeUsers.has(u) && !activeUsers.has(id.toLowerCase())) {
            entrants.delete(id);
            lastKnownRanks.delete(id);
          }
        }
      }
      // A snapshot is catch-up state, not a live split: no split flashes
      participantsList.forEach(p => updateEntrantFromTelemetry(p, ctx, { silent: true }));
    } else if (isParticipantEvent) {
      // Already applied above
    } else if (innerData.participant && typeof innerData.participant === "object") {
      updateEntrantFromTelemetry(innerData.participant, ctx);
    } else if (payload.participant && typeof payload.participant === "object") {
      updateEntrantFromTelemetry(payload.participant, ctx);
    } else if (innerData.user || innerData.username || innerData.userId) {
      updateEntrantFromTelemetry(innerData, ctx);
    } else if (payload.user || payload.username || payload.userId) {
      updateEntrantFromTelemetry(payload, ctx);
    } else if (msg.user || msg.username || msg.userId) {
      updateEntrantFromTelemetry(msg, ctx);
    }

    emitNotification(ctx, "entrants_update", null);
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceProtocol = {
    DEFAULT_RACER_PALETTE,
    updateEntrantFromTelemetry,
    parseRaceMessage
  };

})();
