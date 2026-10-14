/**
 * src/core/livesplit-client.js - LiveSplit Server WebSocket Client & Command Queue
 * 
 * Manages WebSocket communication with LiveSplit Server (ws://localhost:16834/livesplit),
 * sequential FIFO command execution, probe timeout handling, and connection resilience.
 */

(function () {
  "use strict";

  const DEFAULT_WS_URL = "ws://localhost:16834/livesplit";

  /**
   * Creates a sequential LiveSplit client instance.
   */
  function createLiveSplitClient(options = {}) {
    let ws = null;
    let commandQueue = Promise.resolve();
    let inflightResolver = null;
    let url = options.url || DEFAULT_WS_URL;

    function getSocket() {
      return ws;
    }

    function isConnected() {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    }

    /**
     * Executes a sequential command against LiveSplit Server.
     * Prevents queue desynchronization by closing the socket on non-probe timeout.
     */
    function sendCommand(cmd, timeoutMs = 400, isProbe = false) {
      const execute = () => new Promise((resolve) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          resolve(null);
          return;
        }

        let timer = setTimeout(() => {
          inflightResolver = null;
          if (!isProbe) {
            console.warn(`LiveSplit command "${cmd}" timed out after ${timeoutMs}ms. Resetting WebSocket to prevent stream desynchronization.`);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          }
          resolve(null);
        }, timeoutMs);

        inflightResolver = (res) => {
          clearTimeout(timer);
          resolve(res);
        };

        try {
          ws.send(cmd.trim());
        } catch (e) {
          clearTimeout(timer);
          inflightResolver = null;
          resolve(null);
        }
      });

      commandQueue = commandQueue.then(execute, execute);
      return commandQueue;
    }

    function setSocket(newWs) {
      ws = newWs;
      if (ws) {
        ws.onmessage = (event) => {
          if (inflightResolver) {
            const resolve = inflightResolver;
            inflightResolver = null;
            resolve(event.data);
          }
        };
      }
    }

    return {
      getSocket,
      setSocket,
      isConnected,
      sendCommand
    };
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.Client = {
    DEFAULT_WS_URL,
    createLiveSplitClient
  };
})();
