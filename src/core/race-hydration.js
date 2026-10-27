/**
 * src/core/race-hydration.js - therun.gg Runner Catch-Up & Avatars
 *
 * The race room WebSocket only streams participantUpdate / room messages as runners
 * split, and the races.therun.gg REST snapshot cannot be read from a browser (no CORS
 * headers). So when a runner is first seen (or the host's username is known on connect)
 * this module fills in what was missed from therun.gg's CORS-enabled APIs:
 * - https://therun.gg/api/live/{user}: the runner's live run (completed split times,
 *   current split, PB delta, split start time, picture) when it belongs to this race
 * - https://therun.gg/api/users/{user}/global: profile picture fallback
 *
 * Installed per race client onto its `ctx`; one lookup per runner per race, and pictures
 * are cached for the page lifetime.
 */

(function () {
  "use strict";

  const THERUN_LIVE_API = "https://therun.gg/api/live";
  const THERUN_USERS_API = "https://therun.gg/api/users";

  // username (lowercase) -> picture URL ("" when the user has none)
  const pictureCache = new Map();

  async function fetchJson(url) {
    if (typeof fetch !== "function") return null;
    try {
      const res = await fetch(url);
      if (!res || !res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function isSafePicture(url) {
    return typeof url === "string" && url.startsWith("https://");
  }

  /**
   * Converts a therun.gg live run (/api/live/{user}) into the participant telemetry
   * shape RaceProtocol.updateEntrantFromTelemetry understands.
   */
  function liveRunToTelemetry(run) {
    return {
      user: run.user,
      status: "started",
      picture: run.picture,
      liveData: {
        currentSplitIndex: run.currentSplitIndex,
        currentSplitName: run.currentSplitName,
        currentTime: run.currentTime,
        delta: run.delta,
        // insertedAt is when the current split began (therun's splitStartedAt)
        splitStartedAt: Number(run.insertedAt) || undefined,
        splits: Array.isArray(run.splits) ? run.splits : undefined,
        runPercentage: run.runPercentage,
        streaming: run.currentlyStreaming
      }
    };
  }

  function installRaceHydration(ctx) {
    const { raceState } = ctx;
    // `${raceId}:${username}` lookups already made this race
    const requested = new Set();

    function findEntrant(username) {
      const key = String(username || "").toLowerCase();
      for (const e of raceState.entrants.values()) {
        if (String(e.username || "").toLowerCase() === key) return e;
      }
      return null;
    }

    function applyPicture(username, url) {
      const e = findEntrant(username);
      if (e && isSafePicture(url) && e.avatar !== url) {
        e.avatar = url;
        return true;
      }
      return false;
    }

    async function lookupPicture(username) {
      const key = username.toLowerCase();
      if (pictureCache.has(key)) return pictureCache.get(key);
      const profile = await fetchJson(`${THERUN_USERS_API}/${encodeURIComponent(username)}/global`);
      const url = (profile && isSafePicture(profile.picture)) ? profile.picture : "";
      pictureCache.set(key, url);
      return url;
    }

    /**
     * Catches one runner up from therun.gg. Creates the entrant when their live run
     * belongs to this race (e.g. the host, before they split again).
     */
    async function hydrateRunner(username) {
      const raceId = raceState.raceId;
      const name = String(username || "").trim();
      if (!raceId || !name || !isLiveRoomActive()) return false;
      const reqKey = `${raceId}:${name.toLowerCase()}`;
      if (requested.has(reqKey)) return false;
      requested.add(reqKey);

      let changed = false;
      const run = await fetchJson(`${THERUN_LIVE_API}/${encodeURIComponent(name)}`);
      if (raceState.raceId !== raceId) return false;

      if (run && typeof run === "object" && isSafePicture(run.picture)) {
        pictureCache.set(name.toLowerCase(), run.picture);
      }

      if (run && typeof run === "object" && run.raceId === raceId && run.hasReset !== true) {
        const e = findEntrant(name);
        const isSettled = e && (e.isFinished || e.isDNF);
        const isBehindRoom = e && typeof run.currentSplitIndex === "number" && run.currentSplitIndex < (e.currentSplitIndex || 0);
        if (!isSettled && !isBehindRoom) {
          window.LiveSplit.RaceProtocol.updateEntrantFromTelemetry(
            liveRunToTelemetry(run),
            ctx.getProtocolContext(),
            { silent: true }
          );
          changed = true;
        }
      }

      const pic = pictureCache.has(name.toLowerCase())
        ? pictureCache.get(name.toLowerCase())
        : await lookupPicture(name);
      if (raceState.raceId !== raceId) return false;
      if (applyPicture(name, pic)) changed = true;

      if (changed) {
        ctx.notifyListeners("entrants_update", { hydrated: name });
      }
      return changed;
    }

    function isLiveRoomActive() {
      return window.LiveSplit.RaceState.isLiveRoom(raceState);
    }

    // Protocol hook: a runner appeared in the room for the first time
    function onEntrantDiscovered(entrant) {
      if (!entrant || !entrant.username) return;
      const cached = pictureCache.get(String(entrant.username).toLowerCase());
      if (!entrant.avatar && isSafePicture(cached)) {
        entrant.avatar = cached;
      }
      hydrateRunner(entrant.username);
    }

    function resetHydration() {
      requested.clear();
    }

    return Object.assign(ctx, {
      hydrateRunner,
      onEntrantDiscovered,
      resetHydration
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.RaceHydration = {
    THERUN_LIVE_API,
    THERUN_USERS_API,
    installRaceHydration,
    liveRunToTelemetry,
    clearPictureCache: () => pictureCache.clear()
  };
})();
