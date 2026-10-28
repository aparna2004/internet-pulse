# Hourly research capture and daily comparison

The recorder runs independently of FastAPI and never writes to its source database. It does not retrain models, change prediction deadlines, modify BGP processing or require a backend restart.

## Start

From the project root, keep the existing backend running and run this in another terminal:

```powershell
.\.venv\Scripts\python.exe -m backend.research_archive run
```

Use Ctrl+C to stop a foreground recorder. A second recorder using the same output directory is rejected. To capture once use `once`; to regenerate reports solely from archived evidence use `report`. Run `--help` for source, output, interval and dashboard URL overrides. An existing background recorder must be stopped before using these commands against the same directory.

## Files

Default output: `data/research-archive/` (ignored by Git).

- `research.sqlite3`: independent durable archive of captured windows, issued predictions, settled outcomes, evaluation reports and sampled dashboard views. No automatic evidence pruning.
- `hourly/YYYY-MM-DD/HH-00_IST.json`: exact IST-hour records, quality counts, model errors, referenced evaluation reports and a content hash. The current hour is partial; late settlements update its evidence. UTC timestamps are retained alongside IST labels.
- `daily/YYYY-MM-DD/report.html`: readable daily/hourly comparison.
- `daily/YYYY-MM-DD/hourly-comparison.csv`: hourly model metrics for analysis and paper figures.
- `daily/YYYY-MM-DD/summary.json`: day totals, hourly quality and exclusions.
- `provenance.json`: initial source location, source hashes, Python version and scope.
- `status.json`: PID, last successful capture or last error. A stale last-success time means the recorder is not currently verified as running.

The collector polls every 30 seconds and samples one real five-minute dashboard view every five minutes. It imports all still-retained source history on the first run and deduplicates repeated reads. Source retention cannot erase previously archived evidence. Restarting the recorder resumes from the archive. Existing predictions are immutable except for their pending actual/outcome settlement. Conflicting source records are rejected rather than silently rewritten. Daily export work is limited to changed dates and the current date during continuous collection.

## Fair model comparison

Daily MAE and RMSE are recomputed from all eligible individual issued predictions, never by averaging hourly errors or repeated overlapping holdout evaluations. All three methods use exactly the same matched targets. Generation must occur within the original two-second issue deadline, target duration must be five seconds, the actual must match a valid archived capture, and every model must have a finite prediction. Pending and excluded records remain in the raw archive and quality counts. Missing capture is not converted to zero. Model versions can vary within a day; hourly JSON records preserve those versions and available report parameters. Reports predating the recorder may no longer exist in the source; missing referenced reports are explicitly null.

Daily comparisons are prospective live-prediction measurements, different from the research paper's offline expanding-fold evaluation. Dashboard snapshots are sampled bounded views, not an exhaustive hourly topology, event archive or validated incident record. Source key-budget limits and cooldowns still apply.

## Collection duration and operation

Keep the backend, recorder, Internet connection and computer running; sleep, shutdown or a stopped backend creates gaps. There is no Windows auto-start or cloud deployment in this change. No assistant session needs to remain open. A full-day conclusion requires a full observed day; partial days and missing earlier hours are disclosed. Archive data survives local backend restarts but should be backed up separately. Render ephemeral disk does not become durable simply by using this recorder: cloud collection would need a separately configured persistent volume.

## Verification

41 backend tests passed, including nine new recorder tests covering IST boundaries, common-target errors, invalid/late predictions, real zeros, pending outcomes, idempotency, source pruning, immutable issued forecasts, atomic exports, read-only source access and duplicate process locks. The first live capture was completed on 25 October 2026; continuous collection was then started. No frontend or model-parameter changes were made.
