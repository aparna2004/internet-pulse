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

## Local recovery verification - October 22, 2026

- Repaired the existing Python virtual environment using the current bundled Python runtime; preserved installed backend packages.
- Restored frontend dependencies from the existing frozen pnpm lockfile. pnpm reported an ignored esbuild install script; the subsequent actual production build succeeded.
- All 9 backend tests passed using the repaired virtual environment.
- TypeScript compilation and Vite production build passed. Existing bundle advisory remains (approximately 950 kB JavaScript before gzip).
- Started local backend on 127.0.0.1:8000 and frontend on 127.0.0.1:5173. Startup logs are backend-local.log, backend-local-error.log, frontend-local.log and frontend-local-error.log.
- Health endpoint reported an active RIS connection with 932,971 received updates at the observed snapshot.
- Live observability verifier passed via the frontend WebSocket proxy: 60 heartbeat points, 23 collector heatmap rows, 93 nodes and 100 edges. Collector, ASN and exact-prefix scope assertions passed; invalid CIDR rejected with code 1008.
- Browser accessibility state confirmed live dashboard metrics and topology pause/resume (SNAPSHOT PAUSED, then LIVE PATH OBSERVATIONS).
- Browser interaction subsequently timed out on Page.getLayoutMetrics and Page.createIsolatedWorld. Event pause/search, node selection/reset, final phone/tablet layout and measured FPS remain unverified. No claim is made that those checks passed.
- Updated the README runtime path from the prior Windows account to the current account.

## ASN organization enrichment - October 22, 2026

Metadata comes exclusively from RIPEstat AS Overview (`https://stat.ripe.net/data/as-overview/data.json`), using the returned WHOIS holder description. These strings are source descriptions, not normalized corporate identities.

A separate single-worker resolver performs HTTP in a background thread; ingestion never calls or awaits metadata. Snapshot generation does bounded cache lookups and queues only ranking/topology ASNs. Hovered/selected nodes can request `/api/asn/{asn}` through the frontend proxy, including while topology is paused. Graph canvas labels remain ASN identifiers. Missing metadata leaves the ASN visible.

Cache: per backend process, LRU maximum 2,048 entries, 24-hour successful entries and 5-minute negative/error entries; 256 queued requests plus at most one in-flight request, deduplicated by ASN. One worker waits at least one second after each completed request before starting another. HTTP socket timeout is 4 seconds; response body capped at 256 KiB. No persistence; restart clears cache. Cold topology enrichment is progressive and can take minutes. This is local per-process rate limiting, not a distributed multi-worker limiter. The socket timeout is not a strict total wall-clock deadline for a slow-dripping upstream response.

Validation: 12 backend tests passed (9 existing, 3 metadata tests), covering cache TTLs, negative cache, deduplication, bounded queue/cache, rate spacing, timeout fallback, source validation and preservation of snapshot data. TypeScript and production build passed; existing bundle size advisory remains (~951 kB before gzip). Live RIPEstat results verified for AS1299, AS174, AS3356 and AS6939. Metadata endpoint verified through Vite. Live observability integration passed with collector/ASN/prefix filters and invalid CIDR rejection; ingestion exceeded 402,000 received updates during verification. Browser ranking visibly shows real holder names; ranking spacing adjusted for the extra line. Hover/selection use the existing inspector with the shared lookup hook; direct canvas hover/selection was not independently reverified in this pass.

## Interactive and sustained verification - October 22, 2026

This pass used real RIPE RIS Live traffic. There was no generated traffic, deployment, or Git commit. Production UI checks used a temporary local Vite preview on port 5174, proxied to the same existing backend on port 8000. The normal development dashboard remained on port 5173. The continuous stream monitor used the development frontend's WebSocket proxy as one additional continuous client, alongside browser tabs and short-lived filter integration probes. Measurements are local single-machine observations, not capacity claims.

### Reproducible bugs fixed

- Pausing previously called the graph library's `pauseAnimation()`, which stops its entire render/pointer-picking loop. Clicking a visible node while paused was treated as a background click; zoom/fit could not reliably redraw. Pause now uses zero simulation cooldown ticks while retaining the render loop. Snapshot updates, particles and pulse effects remain paused. Paused node selection, zoom, pan and fit were retested successfully.
- The hover inspector could remain visible after leaving the graph and obscure the selected-state label, or linger after clearing selection. A graph pointer-leave handler clears hover state; selected details remain when appropriate, and clearing selection removes the inspector.
- At phone width, ranking grid tracks expanded to intrinsic organization-name widths, placing the second column outside the panel. At 390 px, the right edge reached approximately 526 px despite the page itself being clipped to the viewport. Explicit zero-minimum grid tracks now keep both columns inside the panel, preserving existing ellipsis styling. At 320 px, the time-window selector now receives its own row so the selected option remains readable.

Only `frontend/src/Topology.tsx` and `frontend/src/style.css` were changed for application behavior in this pass. BGP ingestion, filter predicates, counters, anomaly logic and metadata resolver semantics were unchanged.

### Interactive results

| Check | Result and evidence |
| --- | --- |
| Hover tooltip | PASS: paused node inspection displayed AS6939 and the real RIPEstat holder name. |
| Node selection | PASS: clicking AS6939 highlighted its neighborhood and exposed the clear-selection control. |
| Selected organization | PASS: after moving outside the graph, panel showed SELECTED NEIGHBORHOOD, AS6939 and HURRICANE - Hurricane Electric LLC. AS1299 details were also observed earlier in the pass. |
| Selection reset | PASS: clear-selection control restored the default caption and inspector count became zero. |
| Zoom and pan | PASS: wheel zoom enlarged nodes/spacing; background drag moved the view horizontally. Retested while paused after the fix. |
| Fit-to-view | PASS: explicit fit restored the graph after manual zoom/pan and at tablet/phone sizes. |
| Topology pause/resume | PASS: pause showed SNAPSHOT PAUSED with frozen data; canvas inspection remained usable. Resume restored LIVE PATH OBSERVATIONS. |
| Automatic refitting | PASS, visual/code inspection: manual zoom/pan remained in place over multiple live updates beyond the six-second fit-check interval. The existing manual-camera guard remains unchanged. This was not a numeric camera-transform assertion. |
| Event pause/resume | PASS: frozen 40-row contents remained byte-for-byte identical while global receipt counts increased. Resume showed newer event timestamps/contents. |
| Event search | PASS: search for a captured exact prefix returned matching rows; a nonexistent query showed the empty state. Clearing search restored rows. Phone search also worked. |
| Operation filters | PASS: frozen withdrawal filter returned 16 WITHDRAW rows; announcement filter returned ANNOUNCE rows. ALL restored the captured view. |
| Incoming events while paused | PASS: ingestion continued while the captured event list stayed fixed. A longer final-build pause check is recorded below. |

### Responsive results

- Desktop 1440x1000 and 1280x720: visually inspected live metrics, topology, ranking and lower-panel layout. No panel overlap or page-wide horizontal overflow observed.
- Tablet 768x1024: topology above side-by-side activity/ranking, stacked charts and feeds; filters and graph controls remained in bounds. No panel overlap or page-wide horizontal overflow observed.
- Mobile 390x844: header, filters, metrics, topology, ranking, charts, heatmap and feed inspected. Event pause/search/resume controls were exercised. Ranking overflow fixed and visually retested.
- Narrow mobile 320x740: no out-of-viewport panels or ranking columns after the fix. Time-window option fully readable after the narrow-width selector fix.
- Organization descriptions intentionally use existing ellipses in compact ranking rows, with full text in title attributes and topology details. The collector heatmap intentionally scrolls horizontally. Dense topology labels can overlap one another; no collision-free label layout is claimed. Manual zoom can intentionally move graph contents outside the canvas, recoverable with Fit topology.

### Bundle review

Final production JavaScript: **951.19 kB / 287.93 kB gzip**. CSS: **31.18 kB / 7.56 kB gzip**. The existing 500 kB chunk advisory remains.

Rollup module-attribution analysis (rendered module code before final minification, not compressed transfer size):

| Dependency | Approximate rendered bytes |
| --- | ---: |
| react-dom | 653,769 |
| recharts | 497,613 |
| motion-dom | 294,383 |
| lodash | 191,335 |
| framer-motion | 111,996 |
| force-graph | 50,601 |

Other graph/chart helpers include bezier-js (49,801), decimal.js-light (49,721), react-smooth (38,620), tween.js (35,818), tinycolor2 (34,984), and multiple D3 modules. The source imports named components/icons, and Vite already tree-shakes and minifies the production build.

No speculative bundle change was applied. Low-risk follow-ups to evaluate separately: enable Brotli/gzip and immutable asset caching at the eventual hosting layer; consider stable vendor chunks for repeat-load cache reuse (does not reduce total bytes); consider lazy-loading below-fold chart code only with loading-layout and animation regression checks. Do not remove graph/chart/animation functionality or replace major libraries solely to clear the warning.

### Final automated checks

- All backend discovery tests: **12 passed**.
- TypeScript project build (`tsc -b`): **PASS**.
- Vite production build: **PASS**, with the existing bundle-size advisory.
- Final real-stream integration verifier: **PASS**, including collector scope (rrc06), ASN scope (AS1299), exact-prefix scope (2a05:3e04::/32), and invalid CIDR rejection with code 1008. Observed global count exceeded 8.9 million during that check.
- No backend restart or BGP data-semantics changes were needed for these frontend fixes.

### Remaining measurement limits

- Development-tab browser automation intermittently timed out on CDP operations; the affected attempts were not counted as passes. A fresh production-preview tab completed the interaction and responsive checks. This does not prove that all development-browser timeout causes were application bugs or that browser automation was continuously reliable.
- No calibrated FPS, browser heap profile, mobile-device hardware test, public-network load test, multi-user capacity test or multi-hour memory/leak proof was performed.
- Metadata 24-hour TTL cannot be observed in a 30-minute run. Expiry, negative caching, queue/cache bounds, deduplication and rate spacing are covered by deterministic backend tests. Live endpoint observations establish returned names/latency, not an exact count of upstream HTTP calls; no upstream request counter was added.
- A single-process metadata cache and socket-level upstream timeout remain as previously documented.


### Sustained live-stream measurements

- Monitor started **2026-10-22 09:15:37 IST** and ran **1800.88 seconds (30.01 minutes)**. Samples were written every approximately 30 seconds. The live browser was exercised at intervals, with deliberate reloads for rebuilt assets; the dedicated monitor socket stayed independent of those UI reloads.
- **1,622 snapshots**, **8,710,104 additional BGP UPDATEs** (1,895,221 to 10,605,325). **1 WebSocket session(s), 0 reconnects**, 0 monitor error(s), and 0 snapshots reporting upstream disconnected. These are sampled observations, not a guarantee against sub-snapshot upstream interruptions.
- Observed receipt gaps: median **1.109s**, p95 **1.219s**, max **1.625s**. Gaps include monitor scheduling and periodic HTTP probes, not only server processing time.
- Backend process PID **21360** working set: start **203.13 MB**, end **151.49 MB**, min **143.28 MB**, max **231.48 MB**. Windows process commit: start **187.95 MB**, end **225.39 MB**, max **226.96 MB**.
- Last ten-minute working-set range: **143.28-230.65 MB**, linear fitted slope **-7.288 MB/min**. The initial rise and final band are evidence for this run only; no leak-free or indefinite steady-state claim is made.
- Metadata endpoint: **61 successful timed probes**, median **31.00 ms**, max **188.00 ms**, 0 probe errors. AS1299's holder description stayed available. Visible-node name coverage varied with the current graph; at the last sample, **108/108** topology nodes and **10/10** ranking entries had names. Missing names remained valid ASN-only fallback.
- Frontend: **7 timed read-only DOM samples** on the final production preview; automation round-trip median **291 ms**, max **1543 ms**. These include browser automation overhead and are not rendering FPS, event-to-paint latency, or calibrated benchmarks. Samples retained LIVE status, 40 event rows, 10 ranking rows and 20 observation cards. Production preview console checks returned no captured warnings/errors at the checkpoints.
- Final-build event pause held the captured rows unchanged for approximately two minutes while the receipt count rose from 5,907,661 to 6,436,739; resume switched to current events.
- Raw samples, summary, monitor script, module attribution and UI screenshots are saved under `verification/2026-10-22/`. The monitor script accepts the backend PID and a duration in seconds. The bundle-analysis script uses this machine's absolute project path and is an audit helper, not runtime application code.
- The temporary production-preview server/tab and viewport override were cleaned up after verification; the normal dashboard remains on port 5173.


## Focused frontend usability pass - October 22, 2026

### Inspection and scope

Inspected App, Topology, Heartbeat, usePulse, types, entrypoint, styles and the backend snapshot/event-counter contract before editing. Already present: selected-neighborhood highlighting/dimming, organization enrichment, pan/zoom/fit, bounded graph refresh and flow animation, heartbeat and heatmap hover details, event operation colors, entrance/layout animation, pause/search/type filters, responsive grids and a watchdog based on snapshot arrival rather than BGP event volume. Those behaviors were extended rather than duplicated. No backend or metric-calculation changes, chart types, dependency additions, deployment or Git commit were made.

### Improvements

- Topology: extends the existing selected-neighborhood treatment to hovered nodes, distinguishes selected/hovered/neighbor fills, strengthens observed connected edges, and retains dim unrelated nodes and their hit targets. Existing inspector now includes a bounded observed-neighbor ASN list (first six plus remaining count, full list in its title) alongside organization, ASN and activity. A memoized adjacency index updates only when the existing graph snapshot changes; no force-layout work is added to hover/selection handlers. Memoized wrapper avoids parent-form renders with unchanged props. Existing camera guard, three-second graph refresh, physics, snapshot pause and route-flow budget remain intact.
- Charts: the existing heartbeat now supports pointer-down inspection and arrow/Home/End keys; its tooltip contains local timestamp and updates/sec and is kept inside narrow screens. Axis values use fixed-size HTML text with compact formatting so SVG scaling does not shrink labels. Path geometry is memoized. Announcement/withdrawal chart was extracted into a memoized component, retaining the same stacked bars and heartbeat series; its tooltip now names the operations, timestamp, local time and prefix-operation units. Axis labels are brighter, compact and no longer use a negative left margin.
- Feed: retains existing announcement/withdrawal text, search across every prefix in an event, type-filter semantics and frozen captured rows. Adds a distinct mixed-operation treatment. A bounded paused-event counter uses cumulative `total_received` for the scope, before local search/type filters; it does not try to infer unseen events from the last 50 sampled rows. Resume clears the counter. If a counter decrease is observed while paused, a reset warning is latched until resume rather than presenting a misleading difference. Existing entrance motion is shortened/subtle, with reduced-motion layout/entrance disabled.
- Reduced motion: entrypoint MotionConfig respects the user preference; event and heartbeat motion are explicitly suppressed, animated KPI numbers update directly, and existing graph reduced-motion handling remains. No operating-system preference was changed for testing.
- Connection: preserves snapshot-arrival monitoring and adds CONNECTED, RECONNECTING, DISCONNECTED and STALE presentation, plus client-local last snapshot receipt time. After more than eight seconds without a snapshot on an open socket, the last data is labelled stale; after twenty seconds the socket is retried. Genuine backend `connected: false` produces disconnected; zero BGP activity does not. Stale/late callbacks and unmount cleanup are guarded.
- Tour: optional header button opens a compact nine-step nonmodal guide to existing scope, KPIs, topology, ranking, heartbeat, operation bars, collector field, events and observations. No overlay blocks the dashboard, no data or scope is changed, and no auto-advance occurs. Back, Next/Done, Skip tour, close, Escape and Minimize/Expand are available. Targets receive an outline without layout changes; reduced motion disables smooth scrolling.
- Responsive styling: desktop hierarchy/theme retained; small-screen header wraps status, tour and snapshot time into a compact second row. Inspector/list and tooltip widths are bounded. Existing mobile ranking fixes remain.

### Verification results

| Check | Result |
| --- | --- |
| TypeScript `tsc -b` | PASS, final source |
| Production build | PASS; JS 958.21 kB / 291.12 kB gzip; CSS 35.66 kB / 8.59 kB gzip. Existing chunk-size advisory remains. No new dependencies. |
| `node frontend/tests/connection-state.cjs` | PASS: 4 status-classification assertions and 4 isolated transport-hook scenarios. Covers zero-activity snapshots remaining connected, stale retention and retry/recovery, ignoring late old-socket callbacks, upstream disconnect/recovery, terminal invalid-scope close and cleanup. No fixtures enter the running dashboard. |
| Node hover/selection | PASS on real AS6939: organization, activity and seven observed neighbors; highlights/dimming visible. Reset removed the inspector. |
| Pan/zoom/fit/pause/resume | PASS visually on final production preview. Large manual wheel zoom can move graph content out of view; Fit recovers it, as before. Modest wheel zoom and background drag were retested. Existing manual-camera guard and route-flow logic were retained; no calibrated frame-rate assertion. |
| Paused events | PASS: captured 40-row content remained identical while counter increased, including during the full tour. Final-build observation: 76,309 new scoped events while captured rows remained unchanged. Resume restored streaming and removed the counter. |
| Event filters/search | PASS on real frozen events: withdrawal filter returned WITHDRAW rows; ALL restored the captured view. Exact-prefix search preserved secondary-prefix matches (a matching event may display another prefix first). Mixed events retain both operation semantics and distinct styling. |
| Chart tooltips | PASS: heartbeat keyboard End exposed local time and updates/sec; bar-chart keyboard navigation exposed local time and announcement/withdrawal prefix-operation counts. At 320 px, heartbeat tooltip right edge ~283 px stayed within its chart (~28-288 px). |
| Quiet upstream view | PASS in a recovered fresh browser: real exact-prefix scope 192.0.2.0/24 remained CONNECTED with zero event rows/zero scoped metrics while snapshot receipt time advanced for tens of seconds. Reset restored the live all-observations view. |
| Tour | PASS: all nine targets, Back, Next, Done, Skip, Minimize/Expand and Escape. Mobile card remained inside viewport; Escape removed card and target outline. Tour did not change paused event contents or filters. |
| Responsive | PASS visual/DOM bounds at desktop 1440x1000 and 1280x720, tablet 768x1024, phone 390x844 and narrow phone 320x740. No out-of-viewport panels/filter/header/event controls detected. Intentional ellipsis remains for long organization descriptions; heatmap retains intentional horizontal scrolling. Dense canvas labels may overlap, as previously documented. |
| Console | No captured error/warning logs at successful production-preview checkpoints, including final build. |
| Backend | No source modifications in this pass; read-only health check reported active RIS ingestion. Existing backend tests were not rerun because this pass changes only frontend code. |

### Changed files in this pass

- `frontend/src/App.tsx`
- `frontend/src/Heartbeat.tsx`
- `frontend/src/Topology.tsx`
- `frontend/src/usePulse.ts`
- `frontend/src/types.ts`
- `frontend/src/main.tsx`
- `frontend/src/style.css`
- `frontend/src/connectionState.ts` (new)
- `frontend/src/DashboardTour.tsx` (new)
- `frontend/src/Dynamics.tsx` (new)
- `frontend/tests/connection-state.cjs` (new, Node assert/vm and existing TypeScript; no test dependency)
- `VERIFICATION.md`
- Evidence: `verification/2026-10-22/usability/changes.diff`, `usability-mobile-tour.png`, `usability-mobile-chart.png`, `usability-desktop-tour.png`, `usability-topology.png`.

The focused diff compares this pass against the files inspected at its start, excluding pre-existing uncommitted work. No commit was created.

### Limits and cleanup

Browser automation intermittently timed out, including one stalled quiet-scope attempt. Those attempts were not counted as passes; a fresh browser session subsequently completed the quiet-view and responsive checks. This does not identify the timeout cause as an application bug or establish uninterrupted browser-automation reliability. Stale/disconnected/reconnect failure branches were regression-tested in isolation rather than inducing an outage in the live backend. Physical touch hardware and an actual OS reduced-motion toggle were not tested; their handlers/preferences were implemented and reviewed. No new calibrated FPS/heap profile or 30-minute soak was performed on this revised frontend; the earlier sustained report remains historical evidence for the previous build. Metric calculations, ingestion and metadata resolution are unchanged. Temporary preview/browser viewport settings were cleaned up; the normal development dashboard remains on 127.0.0.1:5173.


## Two-model forecasting integration — 2026-10-22

Added Random Forest and Histogram Gradient Boosting regression for the same target: the next aligned minute's global observed BGP UPDATE count. Both use the same past-only features, chronological holdout, one-minute embargo, fixed settings and repeat-previous-minute baseline. The report includes MAE/RMSE, evaluation fit time, batch prediction latency per row, serialized model size, sample/time ranges, dependency versions and dataset hash. Evaluation is separate from the full-past refit used for prospective predictions. No production scores or claimed accuracy were fabricated.

Minute aggregates are persisted in local SQLite with 14-day retention; training reads at most 4,326 recent minutes and retains 20 reports. Only complete connected minutes are eligible. Startup partials, observed outages, missing minutes and sampler gaps are excluded. Quiet connected intervals remain valid zeros. Model work uses one separate process; storage and feature preparation run outside the event loop. Ingestion, its routing semantics, existing metadata enrichment and the existing WebSocket protocol are unchanged. The added panel polls a cached independent endpoint every five seconds.

| Check | Result |
|---|---|
| Full backend suite | PASS: 25 tests, final run 5.227 s. Includes all 12 existing tests plus 13 forecasting tests. |
| Temporal correctness | PASS: five strictly past minutes, future target isolation, missing/invalid context rejection, chronological split and one-minute embargo; all models share holdout rows. |
| Capture validity | PASS: genuine connected zero minutes; partial startup, outage and missed sample exclusion; scalar counts and collector union captured once. |
| Persistence and bounds | PASS: actual zero preserved, incomplete target excluded, duplicate minute cannot overwrite history, old capture/forecasts removed after retention. Capture survived a real backend restart. |
| Worker and orchestration | PASS: both actual sklearn estimators fit and predict in a spawned process; report saved/reloaded through service; minute capture continues while a separate training job waits. Isolated fixtures use temporary databases and never enter the running dashboard. |
| Initial worker startup | First full run hit the 60 s test timeout during first worker startup. Cause not established. Isolated rerun passed in 1.863 s, full reruns passed, final 25-test suite passed. Not reported as a fixed application defect. |
| TypeScript | PASS: `tsc -b`. |
| Production build | PASS: JS 963.97 kB / 293.21 kB gzip; CSS 37.18 kB / 8.98 kB gzip. Existing >500 kB chunk advisory remains. No new frontend dependencies. |
| Existing frontend connection checks | PASS: all 8 assertions/scenarios in `frontend/tests/connection-state.cjs`. |
| Cold-start API | PASS: `/api/forecast` reports collecting with real counts and no report; `/api/forecast/report` returns HTTP 409; CLI evaluate exits with the collection message before 180 eligible examples; CSV export contains captured real minute aggregates. |
| Live WebSocket, final backend | PASS: 75.50 s, 73 snapshots, 304,368 additional genuine UPDATEs, no observed disconnects/errors. Median gap 1.047 s; maximum 1.109 s. |
| Forecast API under live ingestion | Median 22.16 ms; maximum 34.59 ms over 14 probes during the same read-only check. |
| Backend memory | One post-restart sample: working set 103.00 MiB, private memory 86.44 MiB. This is a point measurement during collection, not a peak/soak or production-training memory measurement. |
| Responsive cold-start panel | PASS: desktop 1280 px, tablet 768x1024, mobile 390x844 and 320x740. No horizontal page/panel overflow; long explanations wrap. Existing heatmap retains horizontal scrolling. The ready-state table has its own horizontal scroll container. |
| Event feed regression | PASS on real observations: pause, counter grew to 40,117 new events while paused, search with no matches, clear search and resume back to STREAMING. |
| Browser console | No captured errors or warnings at successful production-preview checkpoints. |

At the final live-check checkpoint there were 7 valid captured minutes, 2 excluded partial minutes and 2/180 eligible examples. These counts continue advancing while the backend runs. No production model report existed yet. First evaluation requires approximately 3 h 6 min of valid continuous capture from a fresh start; stored history survives restarts, but gaps delay eligibility. Automatic training, hourly refresh, early-window forecast persistence, later actual matching, baseline comparison and derived insight text are implemented. There is no claim that either model already beats the baseline on genuine held-out production capture.

### Files changed in this integration

- `backend/main.py` — lifecycle tasks and cached forecasting/report endpoints.
- `backend/requirements.txt` — scikit-learn 1.7.2.
- `backend/forecast_data.py` (new) — minute sampling, temporal features, bounded SQLite history/reports/forecasts.
- `backend/forecast_worker.py` (new) — identical evaluation pipeline, baseline, metrics, local estimators and prospective inference.
- `backend/forecast_service.py` (new) — independent capture, worker scheduling, recovery and cached status.
- `backend/forecast_cli.py` (new) — aggregate export and reproducible offline comparison.
- `backend/test_forecast.py` (new) — isolated correctness/integration tests.
- `frontend/src/App.tsx` — inserts the panel below the existing collector heatmap.
- `frontend/src/ForecastComparison.tsx` (new) — progress, model comparison, explanatory insights, forecasts and matched actual errors.
- `frontend/src/forecast.css` (new) — existing dark visual language and responsive table/panel rules.
- `.gitignore` — excludes captured `data/`.
- `README.md` — model method, setup, reproduction, data scope and limitations.
- `VERIFICATION.md` — this report.

Evidence: `verification/2026-10-22/forecast-panel.png`, `forecast-live-results.json`, `verify_forecast_live.py`, `forecast-changes.diff`, and pre-edit copies under `forecast-before/`. Captured aggregates are under ignored `data/`; no fixtures were inserted there.

### Remaining limitations

The real-data trained comparison and several-hour prospective accuracy evaluation could not yet be completed because genuine history is still accumulating. The ready-state score table and forecast display were checked against the API/type implementation, but were not browser-tested with a production-trained report. Unit/integration fixture results establish pipeline mechanics only, not predictive quality. No new 30-minute soak, calibrated FPS/heap profile, or model-worker peak-memory benchmark was performed. The two short live checks do not replace such measurements. Sampling observes availability every 0.5 s and can miss a shorter outage; an upstream stall the backend still marks connected is indistinguishable from quiet activity. Single chronological holdout results can change with collector coverage and routing regime; several days of observations are preferable for academic conclusions. First model import timing varied in this environment. Browser automation of the existing tab intermittently timed out; a fresh local production-preview tab completed the listed UI checks. No deployment or Git commit was made.


## Rapid live forecasting — supersedes the three-hour warm-up

Following the user's request for immediate use of arriving traffic, the active target is now **next aligned five-second UPDATE count**. The original minute database is preserved separately and is never rescaled, split into fabricated samples, or mixed with five-second capture. Eight genuine labelled examples plus five input windows allow the first comparison after approximately 65–70 seconds from a healthy fresh connection. It refreshes after 30 seconds of new labels initially, then after 60 seconds once 180 examples exist. Early results remain marked PRELIMINARY until 180 examples, and that threshold still does not certify accuracy. First fit uses four training and three chronological holdout samples with a five-second embargo; this is deliberately disclosed as a very small comparison.

Both models remain Random Forest and Histogram Gradient Boosting. Both now use a fixed minimum leaf size of two so that they can learn from small initial samples; other recorded fixed parameters are preserved. Both train on identical inputs/targets/splits. This remains periodic batch retraining, not online model updates. The UI explicitly labels all forecast/error units as five seconds, displays the real holdout counts, and does not present these small results as validated accuracy.

- Backend suite: **26 tests PASS**, final run 5.617 s, including a new smallest-sample test verifying 8 examples, 4 train/3 holdout, 5-second horizon/embargo and preliminary flag.
- TypeScript and production build: **PASS**. JS 964.20 kB / 293.30 kB gzip, CSS 37.18 kB / 8.98 kB gzip. Existing chunk advisory remains; no frontend dependencies added.
- Existing frontend connection regression checks: **8 PASS**.
- Genuine running pipeline: **PASS**. First real report used 14 examples, 8 training and 5 held-out windows. Recorded status `ready`, horizon 5 seconds, preliminary `True`. Both model scores and baseline were populated from captured live observations. Prospective predictions were stored and subsequently matched to actual captured counts; 2 completed current-version forecasts existed at the saved checkpoint. These counts continue changing.
- Browser: **PASS**. Observed real score table, preliminary warning, holdout timestamps/counts, generated predictions and matched prospective errors. No captured console errors/warnings. Later refresh changed the lowest-MAE model, demonstrating why early rankings are preliminary.
- Responsive ready state: desktop 1280x1000 checked visually. At 390x844, document width 386 px, forecast panel ~362 px, table scroll viewport 361 px and content 668 px: the table scrolls inside the panel without page overflow.
- Storage: rapid capture uses `data/forecast-5s.sqlite3`, one-day retention and at most 4,326 rows per modelling read (~six hours); 20 reports retained. Original `data/forecast.sqlite3` is preserved. Ingestion, metadata resolution and ordinary dashboard metric semantics are unchanged.
- Forecast deadline: generated within the first two seconds of its five-second interval; late forecasts are skipped. This gives approximately 3–5 seconds remaining lead time, not a full five seconds after UI arrival. Existing five-second UI polling can display a forecast close to or after its target boundary; generation and target timestamps identify that timing.

Changed source/docs: `backend/forecast_data.py`, `backend/forecast_worker.py`, `backend/forecast_service.py`, `backend/forecast_cli.py`, `backend/test_forecast.py`, `frontend/src/ForecastComparison.tsx`, `README.md`, `VERIFICATION.md`. Evidence: `rapid-live-results.json`, `rapid-panel.png`, `rapid-changes.diff`; previous files retained in `rapid-before/`. No new package, deployment or commit. River online linear regression and Hoeffding Adaptive Tree were discussed as alternatives only; neither was installed nor silently substituted.

Limitations: these are genuine but very small-sample results. No new long-duration soak or statistically meaningful generalization claim. Online alternatives would also need real outcomes before meaningful error measurement and learning; no model can demonstrate accuracy from unseen future labels. Prior sections describing the minute target and 180-example startup are historical and superseded by this section.


## GitHub and Render deployment preparation — 2026-10-22

User explicitly authorized committing, pushing to GitHub and deploying to Render. Added a multi-stage Dockerfile (Node 22 frontend build, Python 3.12 runtime), Free Render Blueprint, GitHub verification workflow, deployment guide, same-origin static frontend serving mounted after API/WS routes, and configurable `PULSE_DATA_DIR` shared by server/CLI. Updated pnpm workspace to explicitly allow esbuild's install script; no dependency versions or metric/model semantics changed. Private histories, environment files, dependency folders, logs, historical verification backup copies and raw soak logs are excluded from Git/build context as appropriate.

Validation: all 26 backend tests PASS (6.178 s); TypeScript, production build and all 8 frontend connection checks PASS. Production frontend remains 964.20 kB / 293.30 kB gzip (existing chunk advisory). Frozen lockfile validation PASS using bundled pnpm 11.25.0; container/CI pin pnpm 10.11.0, verified available on the official registry. Linux optional native packages exist in the lockfile. Local isolated production-serving smoke check: HTML 200, built JavaScript 200, forecast API 200, `.git/config` 404; real WebSocket observations advanced by 5,468 UPDATEs with 23 collectors. The smoke process uses separate ignored history storage; the normal dashboard is preserved.

Docker is not installed on this machine, so a local container image build was not performed. GitHub CI includes that build for verification after push. Cloud deployment and the GitHub push require account authentication; no successful hosted deployment is claimed by these local checks. Free Render instances are ephemeral and can sleep/restart; paid disk configuration is deliberately absent. Existing local captured data is not uploaded or presented as cloud capture.


### Cloud deployment correction: delayed sampler recovery

Commit 655ca26 was pushed to private GitHub repository `aparna2004/internet-pulse`. GitHub Actions passed the complete verification pipeline, including the pinned pnpm 10.11.0 frozen install, frontend production build and Linux Docker image build. Render created Free Docker service `srv-dbcs78tg1s2s73ec5tr0` at `https://internet-pulse-xfhm.onrender.com`, linked to the master branch through Blueprint `exs-dbcs6sjncjis73dfp6pg`.

The first cloud test passed real WSS delivery but failed to produce a model report within its two-minute evaluation wait. The free shared CPU delayed sampling and the original strict per-second polling rule excluded too many windows despite a healthy upstream connection. Corrected this reproducible issue by recovering at most ten seconds from retained actual per-second aggregates, guarded by an upstream connection epoch that advances on every ingest-loop disconnect. First/reconnected partial seconds and long/missing gaps remain excluded. There is no raw-event model work and no fabricated routing data. This adds a disconnect counter only; BGP parsing, metric definitions and existing dashboard filters are unchanged.

All **29 backend tests PASS** (6.467 s), including new tests for exact real-bucket count recovery, a disconnect entirely between polls, conservative startup partials and bounded long-gap exclusion. The existing 26 tests remain passing. The change affects backend history sampling only; the already passing frontend build and connection checks are unchanged. Final public evaluation verification is performed after the corrected commit deploys; this paragraph does not claim that the initial model-availability failure passed.
