# V1 verification — October 6, 2026

Completed locally with the actual RIPE RIS Live UPDATE subscription. No mock data was used by the dashboard or integration checks.

- Python dependencies and frontend dependencies installed.
- Python aggregation tests: 2 passing tests covering prefix operation counts, path prepends, unordered AS_SET handling, rolling expiry, malformed input and memory bounds.
- TypeScript compilation passed; Vite production build passed. Vite reports a bundle-size advisory (approximately 933 kB before gzip), not a compilation error.
- FastAPI started and `/health` reported `ris_connected: true`, with over 100,000 received updates during the initial health check.
- Browser displayed real metrics, 60-second charts, AS ranking, collector activity, parsed event prefixes/paths, and the force-directed topology. No console errors were observed.
- Direct FastAPI WebSocket verification after restart: 16,420 session messages and fresh increasing counts; 23 collectors and 120 topology edges.
- Frontend Vite WebSocket proxy verification after restart: 20,998 session messages, including 2,100 fresh updates between snapshots; 23 collectors and 120 topology edges.
- Backend interruption visibly changed the dashboard to DISCONNECTED. Restarting it restored LIVE without a browser reload.
- Upstream transport disconnects and a keepalive timeout occurred during the initial session; the ingestion loop reconnected and resumed real updates automatically.

The live service can experience collector lag and variable update rates. Snapshot tests are assertions of observed message receipt, not a claim that upstream uptime or event rates are constant. High-concurrency load testing and public deployment are outside V1 scope.

## Observatory upgrade — October 6, 2026

The original FastAPI/RIS/WebSocket pipeline was retained and extended with bounded observation history. No synthetic data was used in the running dashboard or integration verification. Deterministic unit fixtures only exercise detector and aggregation rules.

### Completed checks

- Nine backend tests passed: existing counts and malformed handling, bounds, rolling/previous 5-minute windows, same-session flaps, origin changes with AS_SET ambiguity, relative long paths, complete-bucket bursts with warmup, live scope predicates and detector state expiry.
- Final TypeScript compilation passed. The bundled Node runtime hit host memory pressure on some attempts; `node --jitless --max-old-space-size=512 node_modules/typescript/bin/tsc -b` completed successfully.
- Final production build passed with exit code 0 using `node --max-old-space-size=512 node_modules/vite/bin/vite.js build`. The generated JS was approximately 947 kB / 286 kB gzip. The existing size advisory remains. An earlier Node process produced the build but hit a Windows libuv shutdown assertion; the clean rerun is the final result.
- The backend was restarted with the final Routing Activity Index formula. The frontend development server continued serving the updated app.
- Real observability verifier passed through Vite's WebSocket proxy: 46,117 messages at its initial final-run snapshot, 23 heatmap rows, 60 heartbeat points, 105 observed graph nodes and 100 edges. Counts continued increasing; a later health check reported 217,059 updates and an active RIS connection.
- Collector filter: `rrc12.ripe.net` received 258 matching updates, and every returned event/heatmap row matched that collector.
- ASN filter: AS6939 received 913 matching updates, with ASN membership asserted against peer/path.
- Exact-prefix filter: `2602:ff03:fe1::/48` received 47 matching updates. Invalid CIDR `192.0.2.0/99` was rejected with WebSocket code 1008.
- Live LONG AS PATH, ROUTE FLAP and ORIGIN CHANGE records were observed during the session. UPDATE BURST logic and severity thresholds were tested deterministically; no live burst was manufactured to populate the feed.
- Browser inspection showed live KPIs, topology, ten ASNs, heartbeat, routing dynamics, collector heatmap, event waterfall and anomaly cards. Browser console inspection returned no errors or warnings at the time it was available.
- Desktop (approximately 1280px) and tablet (approximately 710px) layouts were visually inspected. A tablet prefix-filter flex-basis issue was found and corrected. The exact final corrected tablet rendering and phone layout still need another browser pass.
- DOM inspection caught exit rows accumulating under inactive-tab animation throttling. Exit animation retention was removed; the next inspection confirmed 40 event rows, 20 anomaly cards and 10 ranking rows.
- During the first upgraded backend session, process working-set samples rose from approximately 103 MB to 143 MB to 182 MB as the longer rolling history filled. Retention is explicitly capped and unit-tested. This is not a measured steady-state plateau or proof of leak-free long-term operation.

### Remaining verification limits

Browser automation subsequently lost debugger synchronization and timed out on click, reload, viewport and new-tab operations, even after recovery attempts. Therefore topology pause/resume, neighbor-click/reset, event pause/search buttons, final phone-width rendering and measured FPS were **not fully verified interactively**. Their code compiles, and their real-data payloads and filter semantics are verified, but this report does not claim those browser checks passed. A fresh browser session should finish this interaction/responsive pass. Load tests and calibrated anomaly thresholds remain future work.
