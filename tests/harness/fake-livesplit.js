/**
 * tests/harness/fake-livesplit.js - Scriptable fake LiveSplit Server for the in-browser suite
 *
 * Replaces window.WebSocket before the app scripts load, so the test runner never
 * talks to a real LiveSplit running on the machine. Sockets stay CONNECTING until a
 * test calls FakeLiveSplit.acceptConnection(); replies are computed from
 * FakeLiveSplit.state, and every command received is recorded in FakeLiveSplit.sent.
 */

(function () {
  "use strict";

  function formatLiveSplitTime(sec) {
    if (sec === null || sec === undefined) return "-";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = (sec % 60).toFixed(2).padStart(5, "0");
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
  }

  const FakeLiveSplit = {
    sockets: [],
    sent: [],
    state: null,

    reset() {
      this.sent.length = 0;
      this.state = {
        splitIndex: -1,
        gameTime: 0,
        realTime: 0,
        lastSplitTime: null,
        delta: "-",
        comparisonSplitTime: (idx) => 30 * (idx + 1),
        comparisonName: "Personal Best",
        gameName: "Fake Game",
        categoryName: "Any%"
      };
    },

    // Latest socket opened to the LiveSplit Server URL (race-client tests may open other sockets)
    current() {
      const ls = this.sockets.filter((s) => /:16834\/livesplit/.test(s.url));
      return ls[ls.length - 1] || null;
    },

    acceptConnection() {
      const sock = this.current();
      if (sock && sock.readyState === FakeSocket.CONNECTING) sock._open();
      return sock;
    },

    dropConnection() {
      const sock = this.current();
      if (sock && sock.readyState === FakeSocket.OPEN) sock.close();
    },

    reply(cmd) {
      const st = this.state;
      switch (cmd) {
        case "getcurrentgametime": return formatLiveSplitTime(st.gameTime);
        case "getcurrentrealtime": return formatLiveSplitTime(st.realTime || st.gameTime);
        case "getsplitindex": return String(st.splitIndex);
        case "getlastsplittime": return formatLiveSplitTime(st.lastSplitTime);
        case "getdelta": return st.delta;
        case "getcomparisonsplittime": return formatLiveSplitTime(st.comparisonSplitTime(st.splitIndex));
        case "getcomparisonname": return st.comparisonName;
        case "getgamename": return st.gameName;
        case "getcategoryname": return st.categoryName;
        default: return undefined; // switchto / setcomparison etc.: LiveSplit sends no reply
      }
    }
  };

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = FakeSocket.CONNECTING;
      FakeLiveSplit.sockets.push(this);
    }

    _open() {
      this.readyState = FakeSocket.OPEN;
      if (this.onopen) this.onopen();
    }

    send(cmd) {
      const c = String(cmd).trim();
      FakeLiveSplit.sent.push(c);
      const res = FakeLiveSplit.reply(c);
      if (res !== undefined) {
        setTimeout(() => {
          if (this.readyState === FakeSocket.OPEN && this.onmessage) this.onmessage({ data: res + "\r\n" });
        }, 1);
      }
    }

    close() {
      if (this.readyState === FakeSocket.CLOSED) return;
      this.readyState = FakeSocket.CLOSED;
      if (this.onclose) this.onclose();
    }
  }
  FakeSocket.CONNECTING = 0;
  FakeSocket.OPEN = 1;
  FakeSocket.CLOSING = 2;
  FakeSocket.CLOSED = 3;

  FakeLiveSplit.reset();
  FakeLiveSplit.formatLiveSplitTime = formatLiveSplitTime;
  window.FakeLiveSplit = FakeLiveSplit;
  window.WebSocket = FakeSocket;
})();
