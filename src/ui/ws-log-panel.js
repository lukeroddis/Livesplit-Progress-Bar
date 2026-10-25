/**
 * src/ui/ws-log-panel.js - Race WebSocket Telemetry Log Modal (Dev Mode)
 *
 * Renders the race client's captured WebSocket log into #race-ws-logs-modal:
 * - Colour-coded entries (sys / split / start / dnf / ready)
 * - Live append while the modal is open, re-render on clear
 * - Open / close (button, backdrop, Escape), clear, and copy-as-JSON
 */

(function () {
  "use strict";

  const escapeHtml = (str) => window.LiveSplit.DOMUtils.escapeHtml(str);
  const EMPTY_LOG_TEXT = "No WebSocket signals logged yet";

  function renderWsLogEntry(entry) {
    const div = document.createElement("div");
    div.className = "ws-log-item";
    div.style.cssText = "border-bottom: 1px solid rgba(148,163,184,0.15); padding: 5px 0; margin-bottom: 4px;";

    let typeColor = "#38bdf8";
    if (entry.direction === "sys") typeColor = "#f59e0b";
    else if (String(entry.type).includes("split") || String(entry.type).includes("start")) typeColor = "#4ade80";
    else if (String(entry.type).includes("dnf") || String(entry.type).includes("error") || String(entry.type).includes("abandon")) typeColor = "#ef4444";
    else if (String(entry.type).includes("ready")) typeColor = "#a855f7";

    const userBadge = entry.user ? `<span style="background: rgba(56,189,248,0.15); color: #38bdf8; padding: 1px 5px; border-radius: 4px; font-size: 10px; margin-left: 6px;">${escapeHtml(entry.user)}</span>` : "";
    const rawData = (typeof entry.data === "object" && entry.data !== null) ? JSON.stringify(entry.data) : String(entry.data || entry.raw || "");

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
        <div>
          <span style="color: #64748b; font-size: 10px;">${escapeHtml(entry.time)}</span>
          <span style="color: ${typeColor}; font-weight: 600; margin-left: 6px;">[${escapeHtml(entry.type)}]</span>
          ${userBadge}
        </div>
        <span style="color: #64748b; font-size: 9px;">#${entry.id}</span>
      </div>
      <div style="color: #94a3b8; font-size: 10px; overflow-x: auto; max-height: 80px; white-space: pre-wrap; word-break: break-all;">${escapeHtml(rawData)}</div>
    `;
    return div;
  }

  /**
   * Binds the WS log modal controls and subscribes to the race client's log events.
   * @param {Object|null} raceClient
   */
  function bindWsLogPanel(raceClient) {
    const btnOpenWsLogs = document.getElementById("btn-open-ws-logs");
    const wsLogsModal = document.getElementById("race-ws-logs-modal");
    const btnCloseWsLogs = document.getElementById("btn-close-ws-logs-modal");
    const btnCloseWsLogsFooter = document.getElementById("btn-close-ws-logs-footer");
    const btnClearWsLogs = document.getElementById("btn-clear-ws-logs");
    const btnCopyWsLogs = document.getElementById("btn-copy-ws-logs");
    const wsLogsContainer = document.getElementById("ws-logs-container");
    const wsLogsCount = document.getElementById("ws-logs-count");
    const wsLogsStatus = document.getElementById("ws-logs-status");

    function renderAllWsLogs() {
      if (!wsLogsContainer || !raceClient) return;
      const logs = typeof raceClient.getWebSocketLogs === "function" ? raceClient.getWebSocketLogs() : [];
      if (wsLogsCount) wsLogsCount.textContent = logs.length;
      if (wsLogsStatus) {
        const isConn = typeof raceClient.isConnected === "function" && raceClient.isConnected();
        const rId = typeof raceClient.getRaceId === "function" ? raceClient.getRaceId() : null;
        wsLogsStatus.textContent = isConn ? `(Connected: ${rId})` : "(Disconnected)";
        wsLogsStatus.style.color = isConn ? "#4ade80" : "#94a3b8";
      }

      wsLogsContainer.innerHTML = "";
      if (logs.length === 0) {
        wsLogsContainer.innerHTML = `<div style="color: #64748b; font-style: italic; text-align: center; margin-top: 50px;">${EMPTY_LOG_TEXT}.<br>Connect to a race room to capture live telemetry.</div>`;
        return;
      }

      logs.forEach(entry => {
        wsLogsContainer.appendChild(renderWsLogEntry(entry));
      });
    }

    function appendLiveEntry(data) {
      if (!wsLogsModal || wsLogsModal.style.display === "none" || !wsLogsContainer) return;
      const emptyMsg = wsLogsContainer.querySelector("div");
      if (emptyMsg && emptyMsg.textContent.includes(EMPTY_LOG_TEXT)) {
        wsLogsContainer.innerHTML = "";
      }
      if (data) {
        wsLogsContainer.insertBefore(renderWsLogEntry(data), wsLogsContainer.firstChild);
      }
      if (wsLogsCount) {
        const cur = parseInt(wsLogsCount.textContent || "0", 10);
        wsLogsCount.textContent = (cur + 1);
      }
    }

    if (raceClient && typeof raceClient.subscribe === "function") {
      raceClient.subscribe((event, data) => {
        if (event === "ws_log") {
          appendLiveEntry(data);
        } else if (event === "ws_logs_cleared") {
          if (wsLogsModal && wsLogsModal.style.display !== "none") {
            renderAllWsLogs();
          }
        }
      });
    }

    if (!btnOpenWsLogs || !wsLogsModal) return;

    const openWsLogs = () => {
      renderAllWsLogs();
      wsLogsModal.style.display = "flex";
      setTimeout(() => wsLogsModal.classList.add("is-open"), 10);
    };

    const closeWsLogs = () => {
      wsLogsModal.classList.remove("is-open");
      setTimeout(() => {
        wsLogsModal.style.display = "none";
      }, 200);
    };

    btnOpenWsLogs.addEventListener("click", (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      openWsLogs();
    });

    btnCloseWsLogs?.addEventListener("click", closeWsLogs);
    btnCloseWsLogsFooter?.addEventListener("click", closeWsLogs);
    wsLogsModal.addEventListener("click", (e) => {
      if (e.target === wsLogsModal) closeWsLogs();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && wsLogsModal.classList.contains("is-open")) {
        closeWsLogs();
      }
    });

    btnClearWsLogs?.addEventListener("click", () => {
      if (raceClient && typeof raceClient.clearWebSocketLogs === "function") {
        raceClient.clearWebSocketLogs();
      }
      renderAllWsLogs();
    });

    const flashCopied = () => {
      btnCopyWsLogs.textContent = "✓ Copied!";
      setTimeout(() => { btnCopyWsLogs.textContent = "📋 Copy JSON"; }, 2000);
    };

    const fallbackCopy = (text) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        flashCopied();
      } catch (_) {}
      document.body.removeChild(ta);
    };

    btnCopyWsLogs?.addEventListener("click", () => {
      const logs = typeof raceClient?.getWebSocketLogs === "function" ? raceClient.getWebSocketLogs() : [];
      const jsonStr = JSON.stringify(logs, null, 2);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(jsonStr).then(flashCopied).catch(() => fallbackCopy(jsonStr));
      } else {
        fallbackCopy(jsonStr);
      }
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.WsLogPanel = {
    renderWsLogEntry,
    bindWsLogPanel
  };
})();
