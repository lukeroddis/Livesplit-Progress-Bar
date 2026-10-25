/**
 * src/core/race-connection.js - therun.gg Race Room Connection
 *
 * - REST snapshot of the race and participants (races.therun.gg)
 * - Live room WebSocket (ws.therun.gg) with message logging
 * - Disconnect / failed-connect cleanup back to a host-only standings table
 * - Hands every payload to LiveSplit.RaceProtocol with this client's context
 *
 * Installed per race client onto its `ctx` (shared `raceState` plus the client's
 * functions); calls other race-client functions through `ctx.<fn>` at call time.
 */

(function () {
  "use strict";

  const { parseRaceId } = window.LiveSplit.RaceIdentity;
  const { isLiveRoom } = window.LiveSplit.RaceState;

  const THERUN_RACE_API = "https://races.therun.gg";

  const THERUN_WS_BASE = "wss://ws.therun.gg?race=";

  const RACER_PALETTE = [
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

  function installRaceConnection(ctx) {
    const { raceState } = ctx;

    async function fetchRaceData(targetRaceId) {
      const cleanId = parseRaceId(targetRaceId || raceState.raceId);
      if (!cleanId || typeof fetch !== "function") return null;

      try {
        const raceUrl = `${THERUN_RACE_API}/${encodeURIComponent(cleanId)}`;
        const res = await fetch(raceUrl);
        if (raceState.raceId !== cleanId) return null;

        let racePayload = null;
        if (res && res.ok) {
          const json = await res.json();
          racePayload = (json && json.result !== undefined) ? json.result : json;
          if (racePayload) {
            ctx.recordWsLog("in", "http_race_snapshot", racePayload);
            handleRaceMessage(racePayload);
          }
        }

        // Only fetch /participants separately if the main race payload didn't already include participants
        if (!racePayload || !Array.isArray(racePayload.participants)) {
          const partUrl = `${THERUN_RACE_API}/${encodeURIComponent(cleanId)}/participants`;
          const pRes = await fetch(partUrl);
          if (raceState.raceId !== cleanId) return racePayload;
          if (pRes && pRes.ok) {
            const pJson = await pRes.json();
            const partPayload = (pJson && pJson.result !== undefined) ? pJson.result : pJson;
            if (partPayload) {
              ctx.recordWsLog("in", "http_participants_snapshot", partPayload);
              handleRaceMessage(partPayload);
            }
          }
        }

        return racePayload;
      } catch (err) {
        console.warn("[RaceClient] Direct fetch failed (races.therun.gg omits CORS headers for browser fetch; active runs stream via WebSocket):", err);
        return null;
      }
    }

    function connectToRace(targetRaceId) {
      const cleanId = parseRaceId(targetRaceId);
      if (!cleanId) return false;

      if (raceState.raceId === cleanId && raceState.ws && (raceState.ws.readyState === WebSocket.OPEN || raceState.ws.readyState === WebSocket.CONNECTING)) {
        return true;
      }

      disconnectFromRace();
      raceState.raceId = cleanId;
      const d = ctx.getDiscovery();
      if (d) {
        d.recordConnectAttempt();
      }

      // Immediately fetch race snapshot and participants from the HTTP REST API (6nkfyze0o7)
      fetchRaceData(cleanId);

      try {
        const wsUrl = `${THERUN_WS_BASE}${encodeURIComponent(cleanId)}`;
        raceState.ws = new WebSocket(wsUrl);

        raceState.ws.onopen = () => {
          ctx.recordWsLog("sys", "ws_connected", { raceId: cleanId, url: wsUrl });
          console.log(`[RaceClient] Connected to live race: ${cleanId}`);
          ctx.notifyListeners("race_connected", { raceId: cleanId });
        };

        raceState.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            const msgType = (msg && (msg.type || (msg.data && msg.data.type) || "message")) || "message";
            ctx.recordWsLog("in", msgType, msg, event.data);
            handleRaceMessage(msg);
          } catch (e) {
            ctx.recordWsLog("sys", "parse_error", { error: String(e), raw: event.data }, event.data);
            console.warn("[RaceClient] Message parse error:", e);
          }
        };

        raceState.ws.onclose = (event) => {
          ctx.recordWsLog("sys", "ws_closed", { raceId: cleanId, code: event && event.code, reason: event && event.reason });
          console.log("[RaceClient] Race WebSocket closed");
          if (raceState.raceId === cleanId) {
            raceState.ws = null;
          }
        };

        raceState.ws.onerror = (err) => {
          ctx.recordWsLog("sys", "ws_error", { raceId: cleanId });
          console.warn("[RaceClient] WebSocket error:", err);
        };

        ctx.notifyListeners("race_connected", { raceId: cleanId });
        return true;
      } catch (err) {
        console.error("[RaceClient] Failed to connect to race WebSocket:", err);
        clearRoomState();
        return false;
      }
    }

    // Forget the current room: id, socket, status, countdown and event feed
    function clearRoomState() {
      raceState.raceId = null;
      raceState.ws = null;
      raceState.raceStatus = "open";
      raceState.countdownTargetMs = null;
      raceState.countdownSeconds = null;
      raceState.recentRaceEvents.length = 0;
    }

    function disconnectFromRace() {
      if (raceState.raceId) {
        ctx.recordWsLog("sys", "disconnected", { raceId: raceState.raceId });
      }
      ctx.clearRunStartLookupTimers();
      ctx.setStandby(false);
      if (raceState.ws) {
        try {
          raceState.ws.close();
        } catch (_) {}
        raceState.ws = null;
      }
      clearRoomState();
      raceState.hostState.username = raceState.hostUsername || "You";
      raceState.hostState.isHost = true;
      raceState.hostState.color = "#38bdf8";

      raceState.entrants.clear();
      raceState.entrants.set(raceState.hostState.userId, Object.assign({}, raceState.hostState));
      raceState.lastKnownRanks.clear();
      raceState.checkpointRankHistory.clear();
      ctx.notifyListeners("race_disconnected", null);
    }

    function getProtocolContext() {
      return {
        entrants: raceState.entrants,
        hostState: raceState.hostState,
        hostUsername: raceState.hostUsername,
        RACER_PALETTE,
        activeSplitsList: raceState.activeSplitsList,
        isLiveRoom: isLiveRoom(raceState),
        getRaceStatus: () => raceState.raceStatus,
        setRaceStatus: (s) => { raceState.raceStatus = s; },
        getCountdownTargetMs: () => raceState.countdownTargetMs,
        setCountdownTargetMs: (ms) => { raceState.countdownTargetMs = ms; },
        getCountdownSeconds: () => raceState.countdownSeconds,
        setCountdownSeconds: (s) => { raceState.countdownSeconds = s; },
        lastKnownRanks: raceState.lastKnownRanks,
        checkpointRankHistory: raceState.checkpointRankHistory,
        pushRaceEvent: ctx.pushRaceEvent,
        notifyListeners: ctx.notifyListeners
      };
    }

    function handleRaceMessage(msg) {
      return window.LiveSplit.RaceProtocol.parseRaceMessage(msg, getProtocolContext());
    }

    return Object.assign(ctx, {
      fetchRaceData,
      connectToRace,
      clearRoomState,
      disconnectFromRace,
      getProtocolContext,
      handleRaceMessage
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceConnection = {
    installRaceConnection
  };
})();
