/**
 * src/build-entry.js - Vite build entry point
 *
 * The application source stays as classic, dependency-free scripts so the
 * existing test runner and direct file:// usage keep working. This entry
 * imports those scripts in their original <script> order so Vite can bundle
 * them (and their DOM/CSS side effects) into one chunk. vite-plugin-singlefile
 * then inlines the chunk and style.css into dist/index.html.
 *
 * Keep this import order in sync with the <script> tags in index.html.
 */

import "../style.css";
import "./core/storage.js";
import "./core/time-utils.js";
import "./core/split-engine.js";
import "./core/ghost-math.js";
import "./core/livesplit-client.js";
import "./core/race-simulation.js";
import "./core/race-ranking.js";
import "./core/race-protocol.js";
import "./core/race-discovery.js";
import "./core/race-logger.js";
import "./core/race-client.js";
import "./utils/dom-utils.js";
import "./ui/layout-engine.js";
import "./ui/track-renderer.js";
import "./ui/interactions.js";
import "./ui/leaderboard.js";
import "./ui/race-track-markers.js";
import "./ui/toast-manager.js";
import "./ui/timer-display.js";
import "../layout.js";
import "../overlay.js";
