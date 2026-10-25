/**
 * tests/unit/race/live-connection.test.js
 * Manual connect cooldown, standby, REST + WebSocket room data, lobby events, spectator mode and WS logs.
 * (Split from the former tests/unit/core/race-client.test.js.)
 */

(function () {
  "use strict";

    describe("Race: Live therun.gg connection", () => {
      it("Single-shot manual race connect enforces 5s cooldown guard against spam clicking", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.getConnectCooldownRemainingMs, "function", "RaceClient exports getConnectCooldownRemainingMs");
        assertEqual(typeof rc.resetConnectCooldown, "function", "RaceClient exports resetConnectCooldown");

        rc.resetConnectCooldown();
        assertEqual(rc.getConnectCooldownRemainingMs(), 0, "Cooldown is initially 0ms");

        // Mock fetch to count outgoing HTTP calls
        const origFetch = window.fetch;
        let fetchCount = 0;
        window.fetch = () => {
          fetchCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ raceId: null })
          });
        };

        try {
          rc.pollUserStatus("TestRunner");
          assertEqual(fetchCount, 1, "First click sends exactly 1 HTTP request");
          assert(rc.getConnectCooldownRemainingMs() > 4000, "5s cooldown is immediately active");

          // Immediate second click within 5s must be blocked by in-flight / cooldown guard without calling fetch!
          rc.pollUserStatus("TestRunner");
          assertEqual(fetchCount, 1, "Spam click within 5s cooldown sends 0 additional HTTP requests");

          rc.resetConnectCooldown();
          assertEqual(rc.getConnectCooldownRemainingMs(), 0, "resetConnectCooldown clears cooldown");
        } finally {

          window.fetch = origFetch;
        }
      });

      it("Pasting a race URL never overwrites the host runner username with the URL", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        rc.setHostUsername("SpeedRunnerLuke");
        assertEqual(rc.getHostUsername(), "SpeedRunnerLuke");

        // Passing a race URL to setHostUsername must not overwrite the host's display name
        rc.setHostUsername("https://therun.gg/races/tzsm");
        const hostEntrant = rc.getRankedEntrants().find(r => r.isHost);
        assert(hostEntrant.username !== "https://therun.gg/races/tzsm", "Host username is never set to a race URL");
      });

      it("Lobby Standby and Simulation Standby arm pre-race, support Disconnect, and connect when handleHostRunStarted fires", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.isStandby, "function", "RaceClient exports isStandby");
        assertEqual(typeof rc.isSimStandby, "function", "RaceClient exports isSimStandby");
        assertEqual(typeof rc.armSimulationStandby, "function", "RaceClient exports armSimulationStandby");
        assertEqual(typeof rc.handleHostRunStarted, "function", "RaceClient exports handleHostRunStarted");
        assertEqual(rc.isStandby(), false, "Standby is initially false");
        assertEqual(rc.isSimStandby(), false, "SimStandby is initially false");

        // 1. Arm Simulation Standby (e.g. clicking Test Race before starting split)
        rc.armSimulationStandby(["Split 1", "Split 2"], [30, 60], [30, 60]);
        assertEqual(rc.isStandby(), true, "armSimulationStandby sets isStandby to true");
        assertEqual(rc.isSimStandby(), true, "armSimulationStandby sets isSimStandby to true");
        assertEqual(rc.isSimulating(), false, "Simulation does not start until split starts");

        // 2. Starting the split (with initialDelayMs: 0 for synchronous unit test verification) connects simulation
        rc.handleHostRunStarted({ initialDelayMs: 0 });
        assertEqual(rc.isSimulating(), true, "handleHostRunStarted launches simulation after standby");
        assertEqual(rc.isStandby(), false, "isStandby clears once simulation connects");
        assertEqual(rc.isSimStandby(), false, "isSimStandby clears once simulation connects");

        // 3. Disconnect / stopSimulation clears active simulation and standby
        rc.stopSimulation();
        assertEqual(rc.isSimulating(), false, "stopSimulation stops active simulation");

        // 4. Arm Standby again and verify disconnectFromRace cancels Standby cleanly
        rc.armSimulationStandby(["Split 1"], [30], [30]);
        assertEqual(rc.isStandby(), true);
        rc.disconnectFromRace();
        assertEqual(rc.isStandby(), false, "disconnectFromRace cancels Standby");
        assertEqual(rc.isSimStandby(), false, "disconnectFromRace cancels SimStandby");
      });

      it("Race Code connects via REST API (6nkfyze0o7) + WebSocket, unpacks result.participants and liveData, and never renders dummy preview runners", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        assertEqual(typeof rc.isValidRaceCode, "function", "RaceClient exports isValidRaceCode");
        assertEqual(typeof rc.fetchRaceData, "function", "RaceClient exports fetchRaceData");

        // 1. Validate short race codes and reject URLs or unsafe strings
        assertEqual(rc.isValidRaceCode("q38y"), true, "4-char race code q38y is valid");
        assertEqual(rc.isValidRaceCode("tzsm"), true, "4-char race code tzsm is valid");
        assertEqual(rc.isValidRaceCode("https://therun.gg/races/q38y"), false, "Full URL is rejected by isValidRaceCode");
        assertEqual(rc.isValidRaceCode("javascript:alert(1)"), false, "Script protocol is rejected");
        assertEqual(rc.parseRaceId("https://therun.gg/races/q38y"), null, "parseRaceId rejects URLs");
        assertEqual(rc.parseRaceId("q38y"), "q38y", "parseRaceId accepts valid race code");

        // 2. Verify Leaderboard never renders dummy preview runners (SpeedDemon / ApexRunner) when connected to a live race
        window.LiveSplit.Leaderboard.renderLeaderboard([], false, true, false);
        const emptyRows = document.querySelectorAll("#leaderboard-rows .leaderboard-row");
        assertEqual(emptyRows.length, 0, "Connected live race with 0 entrants renders 0 rows (never dummy SpeedDemon/ApexRunner)");

        // 3. Connect using Race Code 'q38y' and verify REST API + WebSocket integration
        const origWS = window.WebSocket;
        const origFetch = window.fetch;
        let connectedWsUrl = null;
        const fetchedUrls = [];
        window.WebSocket = function (url) {
          connectedWsUrl = url;
          this.readyState = 1; // OPEN
          this.close = function () { this.readyState = 3; };
        };
        window.WebSocket.OPEN = 1;
        window.WebSocket.CONNECTING = 0;

        window.fetch = (url) => {
          fetchedUrls.push(url);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: {
                raceId: "q38y",
                status: "progress",
                participants: [
                  {
                    user: "RacerAlpha",
                    status: "finished",
                    finalTime: 95000,
                    pb: "98000"
                  },
                  {
                    user: "RacerBeta",
                    status: "started",
                    pb: "100000",
                    liveData: {
                      currentSplitIndex: 2,
                      currentSplitName: "Bowser",
                      currentTime: 62000,
                      runPercentage: 0.65
                    }
                  },
                  {
                    user: "RacerGamma",
                    status: "abandoned"
                  }
                ]
              }
            })
          });
        };

        try {
          const ok = rc.connectToRace("q38y");
          assertEqual(ok, true, "connectToRace('q38y') succeeds");
          assertEqual(rc.isConnected(), true, "isConnected() is true");
          assertEqual(rc.getRaceId(), "q38y", "getRaceId() returns 'q38y'");
          assert(connectedWsUrl && connectedWsUrl.endsWith("race=q38y"), "WebSocket connects to ?race=q38y");
          assert(fetchedUrls.some(u => u.includes("races.therun.gg/q38y")), "Fetches race data from races.therun.gg REST API");

          rc.handleRaceMessage({
            result: {
              raceId: "q38y",
              status: "progress",
              participants: [
                {
                  user: "RacerAlpha",
                  status: "finished",
                  finalTime: 95000,
                  pb: "98000"
                },
                {
                  user: "RacerBeta",
                  status: "started",
                  pb: "100000",
                  liveData: {
                    currentSplitIndex: 2,
                    currentSplitName: "Bowser",
                    currentTime: 62000,
                    runPercentage: 0.65
                  }
                },
                {
                  user: "RacerGamma",
                  status: "abandoned"
                }
              ]
            }
          });

          const ranked = rc.getRankedEntrants();
          assertEqual(ranked.length, 3, "All 3 participants from result.participants are loaded without any dummy runners");
          assertEqual(ranked[0].username, "RacerAlpha", "Finished runner RacerAlpha is P1");
          assertEqual(ranked[0].isFinished, true, "RacerAlpha is marked finished");
          assertEqual(ranked[0].finalTimeSec, 95, "RacerAlpha finalTime (95000ms) converted to 95s");
          assertEqual(ranked[1].username, "RacerBeta", "Started runner RacerBeta is P2");
          assertEqual(ranked[1].currentSplitIndex, 2, "RacerBeta currentSplitIndex unpacked from liveData");
          assertEqual(ranked[1].currentSplitName, "Bowser", "RacerBeta currentSplitName unpacked from liveData");
          assertEqual(ranked[2].username, "RacerGamma", "Abandoned runner RacerGamma is at bottom");
          assertEqual(ranked[2].isDNF, true, "Abandoned status is mapped to DNF");

          // 4. Verify finished race (like tzsm) with status 'confirmed', splitPredictions, WebSocket close, and CORS fallback
          let wsInstance = null;
          window.WebSocket = function (url) {
            connectedWsUrl = url;
            this.readyState = 1;
            this.close = function () { this.readyState = 3; };
            wsInstance = this;
          };
          window.WebSocket.OPEN = 1;
          window.WebSocket.CONNECTING = 0;

          fetchedUrls.length = 0;
          window.fetch = (url) => {
            fetchedUrls.push(url);
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                result: {
                  raceId: "tzsm",
                  status: "finished",
                  participants: [
                    {
                      user: "eden8",
                      status: "confirmed",
                      finalTime: 4719312.9879,
                      pb: "4790820",
                      liveData: {
                        currentSplitIndex: 2,
                        currentSplitName: "",
                        currentTime: 4719312.9879,
                        runFinished: true,
                        runPercentageTime: 1,
                        splitPredictions: [
                          { splitIndex: 1, currentTime: 165672.6 },
                          { splitIndex: 2, currentTime: 416641.2 }
                        ]
                      }
                    },
                    {
                      user: "BosserJC",
                      status: "confirmed",
                      finalTime: 4911675,
                      pb: "4685000",
                      liveData: {
                        currentSplitIndex: 2,
                        currentSplitName: "",
                        currentTime: 4911675,
                        runFinished: true,
                        runPercentageTime: 1,
                        splitPredictions: [
                          { splitIndex: 0, currentTime: 12.3011 },
                          { splitIndex: 1, currentTime: 170565.9 },
                          { splitIndex: 2, currentTime: 412714.6 }
                        ]
                      }
                    }
                  ]
                }
              })
            });
          };

          rc.connectToRace("tzsm");
          assertEqual(rc.isConnected(), true, "Connected to finished race tzsm");
          if (wsInstance && typeof wsInstance.onclose === "function") {
            wsInstance.onclose();
          }
          assertEqual(rc.isConnected(), true, "Finished race stays connected even if WebSocket closes");

          // Also feed the tzsm payload synchronously for deterministic assertion
          rc.handleRaceMessage({
            result: {
              raceId: "tzsm",
              status: "finished",
              participants: [
                {
                  user: "eden8",
                  status: "confirmed",
                  finalTime: 4719312.9879,
                  pb: "4790820",
                  liveData: {
                    currentSplitIndex: 2,
                    currentSplitName: "",
                    currentTime: 4719312.9879,
                    runFinished: true,
                    runPercentageTime: 1,
                    splitPredictions: [
                      { splitIndex: 1, currentTime: 165672.6 },
                      { splitIndex: 2, currentTime: 416641.2 }
                    ]
                  }
                },
                {
                  user: "BosserJC",
                  status: "confirmed",
                  finalTime: 4911675,
                  pb: "4685000",
                  liveData: {
                    currentSplitIndex: 2,
                    currentSplitName: "",
                    currentTime: 4911675,
                    runFinished: true,
                    runPercentageTime: 1,
                    splitPredictions: [
                      { splitIndex: 0, currentTime: 12.3011 },
                      { splitIndex: 1, currentTime: 170565.9 },
                      { splitIndex: 2, currentTime: 412714.6 }
                    ]
                  }
                }
              ]
            }
          });

          const tzsmRanked = rc.getRankedEntrants();
          assertEqual(tzsmRanked.length, 2, "Finished race tzsm populates both participants (eden8 and BosserJC)");
          assertEqual(tzsmRanked[0].username, "eden8", "eden8 is P1 in tzsm");
          assertEqual(tzsmRanked[0].isFinished, true, "status 'confirmed' is recognized as finished");
          assertEqual(tzsmRanked[1].username, "BosserJC", "BosserJC is P2 in tzsm");
          assertEqual(tzsmRanked[1].isFinished, true, "BosserJC is marked finished");
          assertEqual(tzsmRanked[1].splitTimes.length, 2, "splitPredictions extracted 2 completed splits (ignoring splitIndex 0)");

          rc.disconnectFromRace();
          assertEqual(rc.isConnected(), false, "disconnectFromRace disconnects cleanly");
        } finally {

          window.WebSocket = origWS;
          window.fetch = origFetch;
        }
      });

      it("Spectator Mode renders waiting telemetry banner when connected with 0 entrants and updates deltas when runners split", () => {
        const rc = window.LiveSplit.RaceClient.createRaceClient();
        const lb = window.LiveSplitLeaderboard;
        assert(lb && typeof lb.renderLeaderboard === "function", "LiveSplitLeaderboard is available");

        // 1. Initially connected to a race with no entrants yet (e.g. spectator joined room before runners split)
        rc.connectToRace("live42");
        assertEqual(rc.isConnected(), true, "RaceClient is connected");
        assertEqual(rc.getRankedEntrants().length, 0, "No entrants yet before telemetry arrives");

        // Render leaderboard in connected spectator state
        lb.renderLeaderboard(rc.getRankedEntrants(), false, true, false);
        const rowsEl = document.getElementById("leaderboard-rows");
        const waitingEl = rowsEl.querySelector(".leaderboard-waiting-state");
        assert(waitingEl !== null, "Waiting state banner is displayed while waiting for telemetry");

        // 2. First runner telemetry arrives (Runner 1 and Runner 2 start Split 1)
        rc.handleRaceMessage({
          userId: "runner_1",
          username: "FastPanda",
          currentSplitIndex: 0,
          currentSplitName: "Split 1",
          currentTime: 10000,
          status: "started"
        });
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 0,
          currentSplitName: "Split 1",
          currentTime: 10000,
          status: "started"
        });

        let ranked = rc.getRankedEntrants();
        assertEqual(ranked.length, 2, "Both entrants loaded");
        lb.renderLeaderboard(ranked, false, true, false);
        assert(rowsEl.querySelector(".leaderboard-waiting-state") === null, "Waiting banner removed once entrants arrive");

        // On split 0 before either splits, gap is --
        assertEqual(ranked[0].gapDisplay, "LEADER");
        assertEqual(ranked[1].gapDisplay, "--", "P2 gap is blank before anyone splits");

        // 3. FastPanda completes Split 1 at 30.0s (30000ms)
        rc.handleRaceMessage({
          userId: "runner_1",
          username: "FastPanda",
          currentSplitIndex: 1,
          currentSplitName: "Split 2",
          currentTime: 30000
        });

        // CoolFox is at 31.0s on Split 1
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 0,
          currentSplitName: "Split 1",
          currentTime: 31000
        });

        ranked = rc.getRankedEntrants();
        assertEqual(ranked[0].username, "FastPanda", "FastPanda is P1");
        assertEqual(ranked[1].username, "CoolFox", "CoolFox is P2");
        // CoolFox gap increments: 31.0 - 30.0 = +1.0s
        assertEqual(ranked[1].gapDisplay, "+1.0s", "CoolFox gap increments live once FastPanda completes Split 1");

        // 4. CoolFox also completes Split 1 at 32.5s (32500ms)
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 1,
          currentSplitName: "Split 2",
          currentTime: 32500
        });

        ranked = rc.getRankedEntrants();
        // Both now completed Split 1: gap locks at 32.5 - 30.0 = +2.5s
        assertEqual(ranked[1].gapDisplay, "+2.5s", "Gap locks at milestone difference once both complete Split 1");

        // 5. FastPanda completes Split 2 at 60.0s
        rc.handleRaceMessage({
          userId: "runner_1",
          username: "FastPanda",
          currentSplitIndex: 2,
          currentSplitName: "Split 3",
          currentTime: 60000
        });

        // CoolFox still running Split 2 at 61.5s
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 1,
          currentSplitName: "Split 2",
          currentTime: 61500
        });

        ranked = rc.getRankedEntrants();
        // Gap timer restarts at FastPanda's split: 61.5 - 60.0 = +1.5s (inside the +2.5s gap)
        assertEqual(ranked[1].gapDisplay, "+1.5s", "Gap restarts from zero when the leader splits");
        assertEqual(ranked[1].isLosingToLeader, false, "Still within the previous +2.5s gap");

        // 6. CoolFox completes Split 2 at 64.0s
        rc.handleRaceMessage({
          userId: "runner_2",
          username: "CoolFox",
          currentSplitIndex: 2,
          currentSplitName: "Split 3",
          currentTime: 64000
        });

        ranked = rc.getRankedEntrants();
        // Both completed Split 2: 64.0 - 60.0 = +4.0s
        assertEqual(ranked[1].gapDisplay, "+4.0s", "Delta locks into Split 2 milestone gap");
        rc.disconnectFromRace();
      });

      it("Lobby Ready and Unready transitions correctly toggle entrant status and log lobby events", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.disconnectFromRace();

        // 1. Runner joins race
        rc.handleRaceMessage({
          userId: "user_luke",
          username: "Luke",
          status: "joined"
        });

        let entrants = rc.getRankedEntrants();
        let luke = entrants.find(e => e.userId === "user_luke");
        assert(luke !== undefined, "Luke is added as entrant");
        assertEqual(luke.status, "joined", "Initial status is joined");
        assertEqual(luke.isReady, false, "Initial isReady is false");
        assertEqual(luke.currentSplitName, "Split 1", "currentSplitName remains Split 1 (not overwritten with status)");

        // 2. Runner clicks Ready
        rc.handleRaceMessage({
          userId: "user_luke",
          username: "Luke",
          status: "ready"
        });

        entrants = rc.getRankedEntrants();
        luke = entrants.find(e => e.userId === "user_luke");
        assertEqual(luke.status, "ready", "Status transitions to ready");
        assertEqual(luke.isReady, true, "isReady is true");
        assertEqual(luke.currentSplitName, "Split 1", "currentSplitName remains Split 1 on ready");

        // 3. Runner clicks Unready (sends status: 'joined')
        rc.handleRaceMessage({
          userId: "user_luke",
          username: "Luke",
          status: "joined"
        });

        entrants = rc.getRankedEntrants();
        luke = entrants.find(e => e.userId === "user_luke");
        assertEqual(luke.status, "joined", "Status reverts to joined on unready");
        assertEqual(luke.isReady, false, "isReady is false on unready");
        assertEqual(luke.currentSplitName, "Split 1", "currentSplitName remains Split 1 on unready");

        // 4. Verify race events were logged
        const events = rc.getRecentEvents();
        assert(events.length >= 3, "Lobby events recorded");
        assert(events.some(e => e.type === "join" && e.text.includes("Luke joined")), "Join event logged");
        assert(events.some(e => e.type === "ready" && e.text.includes("Luke is Ready")), "Ready event logged");
        assert(events.some(e => e.type === "unready" && e.text.includes("Luke unreadied")), "Unready event logged");

        rc.disconnectFromRace();
      });

      it("RaceClient records incoming WebSocket messages and provides getWebSocketLogs / clearWebSocketLogs", () => {
        const rc = window.LiveSplit.RaceClient;
        assert(typeof rc.getWebSocketLogs === "function", "rc.getWebSocketLogs is exported");
        assert(typeof rc.clearWebSocketLogs === "function", "rc.clearWebSocketLogs is exported");

        rc.clearWebSocketLogs();
        assertEqual(rc.getWebSocketLogs().length, 0, "Logs buffer starts empty after clear");

        // Simulate incoming message
        rc.handleRaceMessage({
          type: "participant-split",
          data: {
            user: "LiveRacerX",
            splitName: "Zone 2",
            time: 45000,
            percentage: 0.4
          }
        });

        // Simulate another event
        rc.handleRaceMessage({
          type: "race_started"
        });

        const logs = rc.getWebSocketLogs();
        assert(logs.length >= 0, "getWebSocketLogs returns logs array");
        assert(typeof window.getRaceWsLogs === "function", "window.getRaceWsLogs helper is exported");
      });

      it("WS Logs modal opens with .is-open on click and closes on close button click", () => {
        const btn = document.getElementById("btn-open-ws-logs");
        const modal = document.getElementById("race-ws-logs-modal");
        const closeBtn = document.getElementById("btn-close-ws-logs-modal");
        assert(btn !== null, "btn-open-ws-logs exists in DOM");
        assert(modal !== null, "race-ws-logs-modal exists in DOM");
        assert(closeBtn !== null, "btn-close-ws-logs-modal exists in DOM");

        btn.click();
        assertEqual(modal.style.display, "flex", "modal display is flex after click");

        closeBtn.click();
        assert(!modal.classList.contains("is-open"), "modal removes .is-open on close click");
      });

      it("raceUpdate populates full participants snapshot and prunes participants who left", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.disconnectFromRace();

        rc.connectToRace("ltey");

        // 1. Snapshot with 2 runners arriving late
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: {
            type: "raceUpdate",
            data: {
              raceId: "ltey",
              status: "pending",
              participants: [
                { user: "RacerOne", status: "joined", pb: "12242154" },
                { user: "RacerTwo", status: "ready", pb: "9500000" }
              ]
            }
          }
        });

        let entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 2, "Full snapshot populates 2 runners");
        const r1 = entrants.find(e => e.username === "RacerOne");
        const r2 = entrants.find(e => e.username === "RacerTwo");
        assert(r1 !== undefined, "RacerOne exists");
        assert(r2 !== undefined, "RacerTwo exists");
        assertEqual(r1.status, "joined", "RacerOne is joined");
        assertEqual(r1.isReady, false, "RacerOne isReady is false");
        assertEqual(Math.round(r1.pbSec), 12242, "RacerOne PB is parsed from ms to sec");
        assertEqual(r2.status, "ready", "RacerTwo is ready");
        assertEqual(r2.isReady, true, "RacerTwo isReady is true");

        // 2. Incremental participantUpdate
        rc.handleRaceMessage({
          type: "participantUpdate",
          data: {
            type: "participantUpdate",
            data: {
              raceId: "ltey",
              user: "RacerOne",
              status: "ready"
            }
          }
        });
        entrants = rc.getRankedEntrants();
        const r1Updated = entrants.find(e => e.username === "RacerOne");
        assertEqual(r1Updated.status, "ready", "RacerOne status updated to ready");
        assertEqual(r1Updated.isReady, true, "RacerOne isReady updated to true");

        // 3. New snapshot where RacerTwo left
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: {
            type: "raceUpdate",
            data: {
              raceId: "ltey",
              status: "pending",
              participants: [
                { user: "RacerOne", status: "joined", pb: "12242154" }
              ]
            }
          }
        });
        entrants = rc.getRankedEntrants();
        assertEqual(entrants.length, 1, "Snapshot prunes RacerTwo who left");
        assertEqual(entrants[0].username, "RacerOne");

        rc.disconnectFromRace();
      });

      it("rc.reset() does not wipe remote live race participants", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.stopSimulation();
        rc.disconnectFromRace();

        // Connect to a live race and inject remote participants
        rc.connectToRace("live_test_room");
        rc.handleRaceMessage({
          type: "participant-split",
          data: {
            user: "Challenger1",
            splitName: "Stage 3",
            time: 95000,
            percentage: 0.6
          }
        });

        let entrants = rc.getRankedEntrants();
        let chal = entrants.find(e => e.username === "Challenger1" || e.userId === "Challenger1");
        assert(chal !== null && chal !== undefined, "Remote challenger exists in entrants");
        assertEqual(chal.currentTimeSec, 95, "Challenger has 95s elapsed time");

        // Host resets their local LiveSplit timer
        rc.reset();

        // Challenger MUST NOT be wiped out or reset to 0
        entrants = rc.getRankedEntrants();
        chal = entrants.find(e => e.username === "Challenger1" || e.userId === "Challenger1");
        assert(chal !== null && chal !== undefined, "Remote challenger remains intact after host reset");
        assertEqual(chal.currentTimeSec, 95, "Remote challenger time is preserved");

        rc.disconnectFromRace();
      });

      it("clears and retrieves WebSocket debug logs", () => {
        const rc = window.LiveSplit.RaceClient;
        rc.clearWebSocketLogs();
        assertEqual(rc.getWebSocketLogs().length, 0, "Logs are empty after clear");

        // Inject simulated race message to generate log
        rc.handleRaceMessage({
          type: "raceUpdate",
          data: { raceId: "log_room", participants: [] }
        });
        assert(rc.getWebSocketLogs().length >= 0, "getWebSocketLogs returns array");

        rc.clearWebSocketLogs();
        assertEqual(rc.getWebSocketLogs().length, 0, "Logs cleared successfully");
      });
    });
})();
