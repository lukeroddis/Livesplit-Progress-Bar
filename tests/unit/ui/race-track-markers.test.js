/**
 * tests/unit/ui/race-track-markers.test.js
 * Unit tests for race-track-markers
 */

(function () {
  "use strict";


    describe("RaceTrackMarkers Module & Pin Stacking Lifecycle", () => {
      it("exports complete public API on window.LiveSplit.RaceTrackMarkers", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        assert(rtm !== undefined && rtm !== null, "RaceTrackMarkers is exposed");
        assertEqual(typeof rtm.getOrCreateRaceMarker, "function", "getOrCreateRaceMarker is exported");
        assertEqual(typeof rtm.removeDanglingRaceMarkers, "function", "removeDanglingRaceMarkers is exported");
        assertEqual(typeof rtm.hideAllRaceMarkers, "function", "hideAllRaceMarkers is exported");
        assertEqual(typeof rtm.renderRaceCompetitorMarkers, "function", "renderRaceCompetitorMarkers is exported");
        assertEqual(typeof rtm.layoutTrackPins, "function", "layoutTrackPins is exported");
        assertEqual(typeof rtm.getCompetitorTrackRef, "function", "getCompetitorTrackRef is exported");
        assertEqual(typeof rtm.clearMarkers, "function", "clearMarkers is exported");
      });

      it("creates and caches racer markers with sanitized attributes and avatars", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        const track = document.getElementById("track");

        const racer1 = {
          userId: "test_runner_1",
          username: "Speedy<script>",
          color: "#ff0077",
          avatar: "🏎️",
          isDNF: false
        };

        const marker1 = rtm.getOrCreateRaceMarker(racer1, track);
        assert(marker1 !== null, "Marker 1 is created");
        assertEqual(marker1.id, "ghost-marker-race-test_runner_1", "Marker ID is formatted correctly");
        assert(marker1.classList.contains("race-competitor"), "Has race-competitor class");
        assertEqual(marker1.style.getPropertyValue("--racer-color"), "#ff0077", "Racer color CSS variable is applied");

        const tag = marker1.querySelector(".racer-tag");
        assert(tag !== null, "Racer tag exists");
        assertEqual(tag.textContent, "Speedy<script>", "Username is safely escaped without tag injection");

        // Updating racer attributes mutates DOM element in-place
        racer1.color = "#00ffcc";
        racer1.isDNF = true;
        const markerUpdated = rtm.getOrCreateRaceMarker(racer1, track);
        assertEqual(marker1, markerUpdated, "Returns same cached DOM reference");
        assertEqual(markerUpdated.style.getPropertyValue("--racer-color"), "#00ffcc", "Color is updated in-place");
        assert(markerUpdated.classList.contains("is-dnf"), "is-dnf class is applied when isDNF is true");

        // Remote secure image avatar test
        const racer2 = {
          userId: "test_runner_2",
          username: "AvatarRunner",
          avatar: "https://example.com/avatar.png"
        };
        const marker2 = rtm.getOrCreateRaceMarker(racer2, track);
        const img = marker2.querySelector("img.racer-avatar-img");
        assert(img !== null, "Renders img tag for valid https avatar");
        assertEqual(img.getAttribute("src"), "https://example.com/avatar.png", "Image src matches avatar URL");

        // Cleanup
        rtm.removeDanglingRaceMarkers(new Set());
      });

      it("removes dangling markers and hides all race markers cleanly", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        const track = document.getElementById("track");

        const m1 = rtm.getOrCreateRaceMarker({ userId: "keep_1", username: "Keep1" }, track);
        rtm.getOrCreateRaceMarker({ userId: "drop_2", username: "Drop2" }, track);

        assert(document.getElementById("ghost-marker-race-keep_1") !== null, "m1 in DOM");
        assert(document.getElementById("ghost-marker-race-drop_2") !== null, "m2 in DOM");

        // Retain only keep_1
        rtm.removeDanglingRaceMarkers(new Set(["keep_1"]));
        assert(document.getElementById("ghost-marker-race-keep_1") !== null, "m1 retained");
        assert(document.getElementById("ghost-marker-race-drop_2") === null, "m2 removed from DOM");

        // Hide all markers
        m1.style.display = "flex";
        rtm.hideAllRaceMarkers();
        assertEqual(m1.style.display, "none", "m1 is hidden after hideAllRaceMarkers");

        rtm.clearMarkers();
        assert(document.getElementById("ghost-marker-race-keep_1") === null, "All markers purged after clearMarkers");
      });

      it("calculates competitor track reference times via linear interpolation", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        const compTimes = [30, 60, 90, 120];

        // Segment 0.0 -> 0s
        assertEqual(rtm.getCompetitorTrackRef(0.0, compTimes), 0, "0.0 progress maps to 0");
        // Segment 0.5 -> midway between 0 and 30 = 15s
        assertEqual(rtm.getCompetitorTrackRef(0.5, compTimes), 15, "0.5 progress maps to 15s");
        // Segment 1.0 -> 30s
        assertEqual(rtm.getCompetitorTrackRef(1.0, compTimes), 30, "1.0 progress maps to 30s");
        // Segment 1.5 -> midway between 30 and 60 = 45s
        assertEqual(rtm.getCompetitorTrackRef(1.5, compTimes), 45, "1.5 progress maps to 45s");
      });

      it("maps a racer with fewer splits onto the local track by split name", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        const track = ["A", "B", "C", "D", "E", "F"];
        // Their "D" covers the local "C" and "D"
        const racer = { userId: "short", totalSplits: 5, splits: ["A", "B", "D", "E", "F"].map(name => ({ name })), score: 2.5 };

        assertEqual(rtm.mapRacerScoreToTrack(racer, track), 3, "halfway through their D is the end of local C");
        racer.score = 1.25;
        assertEqual(rtm.mapRacerScoreToTrack(racer, track), 1.25, "matching splits map one to one");
        racer.score = 3.5;
        assertEqual(rtm.mapRacerScoreToTrack(racer, track), 4.5, "after the merge they line up again");
      });

      it("executes layoutTrackPins clustering and splay calculations without errors", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        const track = document.getElementById("track");

        const m1 = rtm.getOrCreateRaceMarker({ userId: "c1", username: "Cluster1" }, track);
        const m2 = rtm.getOrCreateRaceMarker({ userId: "c2", username: "Cluster2" }, track);

        const visiblePins = [
          {
            marker: m1,
            coord: 100,
            coords: { startCoord: 50, endCoord: 150, prevNode: null, nextNode: null }
          },
          {
            marker: m2,
            coord: 105,
            coords: { startCoord: 50, endCoord: 150, prevNode: null, nextNode: null }
          }
        ];

        rtm.layoutTrackPins(visiblePins, {
          isVertical: false,
          visibleMin: 0,
          visibleMax: 400,
          trackElem: track,
          getNodeTextThreshold: () => 10
        });

        // Verify elements were displayed and transformed
        assertEqual(m1.style.display, "flex", "Marker 1 is displayed");
        assertEqual(m2.style.display, "flex", "Marker 2 is displayed");
        assert(m1.style.transform.includes("translateX(100px)"), "m1 positioned at 100px");
        assert(m2.style.transform.includes("translateX(105px)"), "m2 positioned at 105px");

        // Verify splay classes or offsets were computed for overlapping pins
        const splay1 = m1.style.getPropertyValue("--ghost-splay-x");
        const splay2 = m2.style.getPropertyValue("--ghost-splay-x");
        assert(splay1 !== "" || splay2 !== "", "At least one clustered pin receives splay offset");

        rtm.clearMarkers();
      });

      it("spreads vertical-track pins along Y without overlap, leaving each needle at its true position", () => {
        const rtm = window.LiveSplit.RaceTrackMarkers;
        const track = document.getElementById("track");
        const markers = [1, 2, 3, 4, 5].map(n => rtm.getOrCreateRaceMarker({ userId: `v${n}`, username: `V${n}` }, track));
        markers[0].classList.add("splay-right", "compact");
        markers[0].style.setProperty("--ghost-splay-x", "12px");

        // Five pins at the same spot: more than the old three side-by-side tiers could hold
        rtm.layoutTrackPins(markers.map(marker => ({ marker, coord: 200, coords: null })), {
          isVertical: true,
          visibleMin: 0,
          visibleMax: 600,
          trackElem: track
        });

        const pinSize = parseFloat(getComputedStyle(track).getPropertyValue("--ghost-pin-size")) || 26;
        const heads = markers.map(m => 200 + (parseFloat(m.style.getPropertyValue("--ghost-splay-y")) || 0)).sort((a, b) => a - b);
        for (let i = 1; i < heads.length; i++) {
          assert(heads[i] - heads[i - 1] >= pinSize, `heads ${i - 1} and ${i} do not overlap (${heads[i - 1]} / ${heads[i]})`);
        }
        markers.forEach((m) => {
          assert(m.style.transform.includes("translateY(200px)"), "marker (and its needle) stays at the true position");
          assert(!m.style.transform.includes("calc"), "no sideways tier offset");
          assertEqual(m.style.getPropertyValue("--ghost-splay-x"), "", "horizontal splay is cleared");
          assert(!m.classList.contains("splay-left") && !m.classList.contains("splay-right"), "horizontal splay classes are cleared");
          assert(!m.classList.contains("compact"), "compact is horizontal-only");
        });
        assert(markers.some(m => m.classList.contains("splay-up")), "some heads splay up");
        assert(markers.some(m => m.classList.contains("splay-down")), "some heads splay down");

        rtm.clearMarkers();
      });
    });
})();
