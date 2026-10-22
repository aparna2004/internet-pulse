# Internet Pulse

A live BGP observatory built on the verified V1: **RIPE RIS Live → FastAPI → bounded in-memory rolling aggregation → WebSocket → React**. The original ingestion/reconnection pipeline is preserved. No generated traffic, Redis, or Kafka. A separate forecasting layer records bounded five-second aggregates in local SQLite and compares two regression models without changing BGP ingestion.

## Setup

Requires Python 3.11+ and Node.js 20.19+ (or Node 22.12+), with npm on PATH. Run these commands from the repository root.

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Keep that terminal open. In a second terminal, from the repository root:

```powershell
cd frontend
npm run dev
```

Open http://127.0.0.1:5173. Allow outbound HTTPS/WebSocket access to `ris-live.ripe.net`. The backend connects automatically; there is no API key. Stop either service with Ctrl+C.

### This Codex workspace

Dependencies are already installed here. Python and Node were supplied by the app rather than system PATH. To restart the tested services on this machine, run from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
cd frontend
& 'C:\Users\hp\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/vite/bin/vite.js --host 127.0.0.1
```

Both services are left running after verification. If a port is already occupied by this project, use the existing service or stop its original terminal before starting another instance. See `VERIFICATION.md` for observed test results.

### macOS / Linux

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal run `cd frontend && npm run dev`, then open the same dashboard URL.

### pnpm alternative

The repository includes `frontend/pnpm-lock.yaml`. Use `pnpm install --frozen-lockfile` and `pnpm run dev` instead of npm. With pnpm 11, run `pnpm approve-builds` and approve `esbuild` if install reports an ignored build script. npm users may generate their own package-lock.json.

## Verify

From the root on Windows:

```powershell
.\.venv\Scripts\python.exe -m unittest backend.test_main
Invoke-RestMethod http://127.0.0.1:8000/health
.\.venv\Scripts\python.exe backend/verify_live.py ws://127.0.0.1:8000/ws
.\.venv\Scripts\python.exe backend/verify_live.py ws://127.0.0.1:5173/ws
.\.venv\Scripts\python.exe backend/verify_observability.py
cd frontend
npm run build
```

On macOS/Linux replace the Python executable with `.venv/bin/python`; use `curl http://127.0.0.1:8000/health` for health. The integration verifier requires increasing real update counts, recent parsed events, a 60-point heartbeat, and AS edges. Testing through port 5173 verifies the same proxy and socket path used by the browser. `/health` distinguishes the running service from the upstream connection.

## What the numbers mean

- Updates/min is the UPDATE message count received in the last 60 one-second buckets (not an extrapolation). Updates/sec is the last completed bucket. Startup builds up a full minute; empty buckets are zero.
- Announcement and withdrawal counts are **prefix operations**, and percentages share that denominator. One UPDATE may contain both, several prefixes, or no prefix operations.
- Average path length includes prepends and counts an AS_SET as one segment, averaged over UPDATE messages with a nonempty path. ASN activity counts each ordered ASN once per UPDATE. AS_SET members are excluded from rankings and adjacency because their order is unknown.
- Edges are undirected observed consecutive ASNs. Self edges from prepending are skipped. This is observed routing adjacency, not a complete physical topology or a routing table. Node size represents updates containing the ASN. Edge weight represents consecutive-path traversals. Hover connection counts refer to the displayed graph, not all Internet connections.
- Aggregation uses backend receipt time to keep the rolling window stable despite collector delays. Events preserve collector timestamps and receipt timestamps; the event table displays collector time.
- LIVE means both the browser socket and RIS subscription are connected. Low activity does not necessarily indicate disconnection. The client detects a stalled backend socket after five seconds.

## Memory and resilience

State is confined to 600 one-second buckets (current and previous 5-minute windows), with at most 1,024 unique ASN keys, 1,024 edge keys, and 64 collector keys per bucket. Once a bucket's key budget is reached, unseen keys are omitted from that bucket's rankings/graph; total update and prefix counts remain exact for accepted messages. A visible budget notice discloses this truncation. Events retain 80 entries internally, send the newest 50, and render at most 40 rows. They show up to eight prefixes per event. Paths are limited to 256 segments and AS_SETs to 256 members. RIS socket messages are capped at 1 MiB and its queue at 32 messages. Topology sends only 100 edges and at most 200 nodes. Rankings show ten ASNs; heatmaps contain at most 32 × 60 cells. Anomalies retain 60 records, send 30 and render 20. Route tracking retains at most 20,000 collector/peer/prefix keys and expires observations after 5 minutes.

The backend reconnects with 1–30 second exponential backoff, validates malformed messages, and yields during bursts. Dashboard snapshots are sent once per second and cached per window/second; slow socket sends time out after five seconds. The graph refreshes every three seconds and retains surviving node/link objects to preserve positions. It uses bounded canvas drawing and selective labels. Recent nodes pulse and edges brighten, then fade according to last observed activity. The frontend reconnects every two seconds. Invalid filters stop retrying; full filter capacity retries every ten seconds. Restarting the backend clears all state. Event rows have entry animation but immediate removal, so background-tab animation throttling cannot accumulate exit rows.

Run **one Uvicorn worker**: each worker owns independent memory and an upstream subscription. This V1 is intended for local use and a few clients. Vite proxies `/ws` and `/health` to port 8000. For deployed builds, configure a same-origin reverse proxy for those paths with WebSocket upgrade support; `vite preview` alone is not a deployment architecture.

## Controls and filter semantics

Collector, ASN, and exact CIDR filters apply together to **UPDATE messages**: collector must match, ASN must equal the peer ASN or an ordered AS-path member, and prefix must occur in an announcement or withdrawal. All operations and AS-path relationships in each matching UPDATE are then aggregated consistently across topology, KPIs, charts, ranking, heatmap, anomalies and events. They do not change or disconnect the upstream RIS subscription. AS_SET members are not ordered-ASN matches. Prefixes are canonicalized; subprefix matching is not implemented.

To avoid retaining a raw firehose, filtered views collect matching observations from the moment their scope is first opened. A history-coverage label makes this explicit. Up to four additional filter scopes are retained, expire 60 seconds after last use, and share the same live ingestion connection. A time-window change retains the same scope history; a new scope starts with empty history. A quiet prefix view correctly shows zero events rather than manufactured activity. Previous-window comparisons appear only after two complete windows have been observed. The updates/min KPI always represents 60 seconds and compares with the preceding 60 seconds; announcement/withdrawal/path KPIs use the chosen 60s or 5m window.

The heartbeat and operation chart always show the last 60 completed one-second buckets, even in 5m mode. The heatmap uses one-second buckets in 60s mode and five-second buckets in 5m mode. The average heartbeat baseline is the available prior 59 seconds, excluding the latest completed bucket. It needs 15 observed seconds before burst detection is enabled. Warmup zero padding does not count toward the baseline.

Topology **Pause** freezes the topology and simulation; **Live** resumes. Clicking a node highlights its immediate displayed neighbors, clicking empty canvas clears selection, and Fit reframes the graph. Important nodes (top five), selected nodes and hovered nodes have labels. Event **Pause** captures the bounded latest list while all other data continues. ANNOUNCE/WITHDRAW filters include mixed messages with that operation; prefix search applies to the retained prefix preview, not complete historical routes.

## Routing Activity Index

This is a **project-defined activity metric, not an official RIPE metric, not a security verdict**. Let A be announced prefixes in the most recent 60 receipt-time seconds; W withdrawn prefixes; F tracked announce/withdraw transitions in that minute; U the latest complete updates/sec bucket; and B the mean update rate of the preceding available 59 complete buckets.

```
RAI = round(min(100,
  20 × min(1, A / 1,000,000) +
  25 × min(1, W / 250,000) +
  25 × min(1, F / 50,000) +
  30 × min(1, U / max(100, 3 × B))
), 1)
```

Labels: NORMAL <25; ELEVATED 25–<50; HIGH 50–<75; SEVERE ≥75. The fixed normalization constants are transparent initial project choices, not statistically calibrated Internet health thresholds. Filters reduce the observed scope, so index values across differently filtered scopes should not be treated as equivalent health measures. Warmup values are partial and explicitly labeled. F is limited to retained route observations, so it can undercount transitions during high prefix churn.

## Explainable anomaly rules

- **UPDATE BURST**: latest complete update rate exceeds `max(100, 3 × B)` after at least 15 baseline seconds. MEDIUM below 5× baseline, HIGH at 5×, CRITICAL at 10×. Global/scope cooldown: 15 seconds. Historical chart markers use the current rolling threshold to highlight elevated points; they are not an immutable alert archive.
- **ROUTE FLAP**: at least four announce/withdraw transitions in 60 seconds for the same collector, peer ASN and exact prefix. MEDIUM at four, HIGH at eight. Per-route cooldown: 60 seconds. Identical repeated announcements are not flaps.
- **LONG AS PATH**: at least 30 path observations in the prior minute, then an observed path of at least 12 segments and at least twice the prior-minute average. MEDIUM severity; cooldown: 30 seconds per peer ASN. Prepends count as path segments.
- **ORIGIN CHANGE**: the final ordered origin ASN changes for a prefix on the same collector/peer, while the previous observation is within 5 minutes. LOW severity; per-route cooldown: 60 seconds. A terminal AS_SET has no unambiguous origin and cannot trigger this rule.

Origin changes and flaps are intentionally scoped to collector/peer, avoiding false transitions just because two collectors observe different routes. Legitimate failover, policy changes and prepending can trigger these heuristics. None is labeled a hijack or cyberattack. Detector state, cooldowns and feed history are bounded; this is a live triage view, not an exhaustive anomaly archive. Anomalies display backend observation time; events display collector time, which can lag.

## Next

Add prefix drill-down, reliable AS organization enrichment and configurable anomaly thresholds, then benchmark higher client counts. Before public deployment, add authentication, TLS and deployment limits. No organization names are inferred or invented. Historical storage, exhaustive route state and validated incident attribution remain outside this in-memory version.

Protocol reference: [RIPE RIS Live manual](https://ris-live.ripe.net/manual/).

## Routing forecasting comparison — rapid live mode

Random Forest and Histogram Gradient Boosting predict the same **next aligned five-second UPDATE count**, compared with repeating the previous five-second count. The three-hour minimum has been removed. Five completed windows provide the inputs; eight labelled examples allow the first small comparison, normally **65–70 seconds** after a fresh healthy connection. Initial results are explicitly **PRELIMINARY**, not validated accuracy. Predictions need prior observations; errors need the later actual target count. Neither can be measured before those observations exist.

The models use identical lagged counts, mean/std/min/max/change, latest withdrawal share, average path length, flap count, collector count and prefix-operation counts. Evaluation remains chronological 70/30 with a five-second embargo; no shuffled split or future data in the features. Reports expose MAE/RMSE in UPDATE counts per five seconds, measured fit/inference time, model size, exact fixed parameters, feature names, dependency versions, dataset hash and sample counts. At the initial eight-example threshold the holdout has only three observations, so comparisons can change rapidly. The PRELIMINARY flag remains until 180 examples; crossing that threshold is not a guarantee of reliability either.

Both models are refit on all available past labels for prospective forecasting. Evaluations refresh after 30 seconds of new labelled data initially and 60 seconds after 180 examples. This is periodic batch retraining, not online `learn_one` learning. The worker remains separate from ingestion and uses one process/thread. A forecast must be generated within the first two seconds of its five-second window; late forecasts are skipped. Its actual generation time and interval are shown. Later completed actuals are matched to the stored predictions; invalid target capture is excluded.

Only genuine receipt-time aggregates are captured. Startup partials, disconnects and unrecoverable sampling gaps are excluded; connected quiet windows can be zero. The rapid dataset is stored separately in ignored `data/forecast-5s.sqlite3`, retaining one day of captured windows, the latest 20 reports and at most 4,326 rows (about six hours) per modelling read. The earlier `data/forecast.sqlite3` minute capture is preserved and is not relabelled or mixed into five-second forecasts. Database table/row names now refer to windows. Scope remains global; dashboard filters do not change model data.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend -p "test_*.py" -v
.\.venv\Scripts\python.exe -m backend.forecast_cli export --output captured-windows.csv
.\.venv\Scripts\python.exe -m backend.forecast_cli evaluate --output evaluation.json
```

The CLI, `/api/forecast` and `/api/forecast/report` use the same rapid dataset and definitions. Model metrics are experimental observed-stream forecasts, not attack detection, Internet-wide visibility or outage attribution. A single tiny chronological holdout establishes no predictive advantage; collect more data for an academic conclusion. Local model computation and no simulated observations are used. The sampler normally polls every 0.5 s and recovers up to ten seconds of scheduler delay from real retained buckets only while the backend connection epoch is unchanged. Every backend-observed disconnect advances that epoch, including one between polls; an upstream stall still marked connected is indistinguishable from quiet activity. Initial imports, connection gaps or worker recovery can extend the normal warm-up.

For a future online-learning comparison, River's online linear regression and Hoeffding Adaptive Tree regressor support incremental updates. These are documented alternatives, **not installed or substituted** by the rapid-window change. A fair evaluation would predict first, wait for the real outcome, update both models' error metrics, and only then train on that outcome.


## Deploy from GitHub

See [DEPLOYMENT.md](DEPLOYMENT.md) for the one-service Render deployment, GitHub checks, and Free-tier versus persistent-storage behavior.
