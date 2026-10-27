/**
 * src/core/livesplit-connection.js - LiveSplit Server Connection Lifecycle
 *
 * Owns the WebSocket to LiveSplit Server on top of LiveSplit.Client's
 * sequential command queue:
 * - Connect with a duplicate-socket guard and automatic reconnect
 * - CONNECTED / DISCONNECTED status pill
 * - sendCommand (queued, awaits a reply) and sendRaw (fire-and-forget commands
 *   that LiveSplit does not answer, e.g. switchto / setcomparison)
 */

(function () {
  "use strict";

  /**
   * @param {Object} options
   * @param {string} [options.url]
   * @param {Function} [options.onOpen] - Awaited after the socket opens
   * @param {Function} [options.onClose] - Called when the socket closes, before reconnecting
   * @param {number} [options.reconnectDelayMs]
   */
  function createLiveSplitConnection(options = {}) {
    const {
      url = window.LiveSplit.Client.DEFAULT_WS_URL,
      onOpen = async () => {},
      onClose = () => {},
      reconnectDelayMs = 1500
    } = options;

    const client = window.LiveSplit.Client.createLiveSplitClient();
    let ws = null;

    function setStatus(connected) {
      const status = document.getElementById("connection-status");
      if (!status) return;
      status.innerText = connected ? "CONNECTED" : "DISCONNECTED";
      status.style.color = connected ? "#4ade80" : "#ef4444";
      status.closest(".connection-status-pill")?.classList.toggle("connected", connected);
    }

    function isOpen() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    }

    function connect() {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      ws = new WebSocket(url);
      client.setSocket(ws);

      ws.onopen = async () => {
        setStatus(true);
        await onOpen();
      };

      ws.onclose = () => {
        onClose();
        client.clearInflight();
        setStatus(false);
        setTimeout(connect, reconnectDelayMs);
      };

      ws.onerror = () => ws.close();
    }

    function sendRaw(cmd) {
      if (isOpen()) ws.send(cmd);
    }

    return {
      connect,
      isOpen,
      sendRaw,
      sendCommand: client.sendCommand
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LiveSplitConnection = {
    createLiveSplitConnection
  };
})();
