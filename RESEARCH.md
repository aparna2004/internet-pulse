# Research and implementation guide

Internet Pulse is a working live BGP observatory with a separate short-horizon forecasting experiment.

- Source repository: https://github.com/aparna2004/internet-pulse
- Dashboard: run locally using the setup instructions in README.md
- Author: Aparna Sathyamurthi Thambu
- Institution: Department of Applied Mathematics and Computational Sciences, PSG College of Technology, Coimbatore, India

## How the implementation supports the paper

| Paper method | Implementation |
| --- | --- |
| RIS Live ingestion, bounded rolling aggregation, WebSocket snapshots | [backend/main.py](backend/main.py) |
| Cached RIPEstat ASN enrichment | [backend/asn_metadata.py](backend/asn_metadata.py) |
| Five-second windows and stored forecast data | [backend/forecast_data.py](backend/forecast_data.py) |
| Forecast scheduling | [backend/forecast_service.py](backend/forecast_service.py) |
| Random Forest and Histogram Gradient Boosting execution | [backend/forecast_worker.py](backend/forecast_worker.py) |
| Independent archival and hourly reporting | [backend/research_archive.py](backend/research_archive.py), [capture guide](RESEARCH_CAPTURE.md) |
| Live topology, collector map and event feed | [frontend/src/Topology.tsx](frontend/src/Topology.tsx), [CollectorMap.tsx](frontend/src/CollectorMap.tsx), [EventTimeline.tsx](frontend/src/EventTimeline.tsx) |
| Forecast display and model comparison | [frontend/src/ForecastComparison.tsx](frontend/src/ForecastComparison.tsx), [ForecastHistory.tsx](frontend/src/ForecastHistory.tsx), [ForecastScores.tsx](frontend/src/ForecastScores.tsx) |

## Faculty-review experiment

The paper uses 9 hours 41 minutes 35 seconds of valid five-second observations across 24–26 October 2026, distributed across 64 continuous segments. It does not claim ten continuous hours. The frozen dataset contains 162,279,786 received UPDATE observations and 6,516 common matched prospective forecasts.

| Method | MAE (UPDATEs / 5 seconds) | RMSE (UPDATEs / 5 seconds) |
| --- | ---: | ---: |
| Repeat previous window | 7,590.51 | 12,339.67 |
| Random Forest | 6,881.13 | 10,403.26 |
| Histogram Gradient Boosting | 7,062.07 | 10,717.03 |

These are observed study results, not guaranteed live accuracy. Persistence performs better in the lower-activity group; improvements are not uniform. Missing periods and unavailable training reports are disclosed in the paper.

## Paper and reproducibility package

The faculty-review PDF, LaTeX source, frozen SQLite archive, analysis scripts and CSV exports are delivered separately as the Internet-Pulse-Research package. Its `multi-session/README.md` explains recomputation. The archive SHA256 is `8603fdb0875faeefd7c33596c2b3caf47c1063c1be74b52f89eff7b72fe5f6e9`.

The locally running dashboard is not the frozen dataset. Local changes may not yet be committed, and repository access may require permission. No public paper or dataset download is claimed here. Before publication, archive a matching source revision and the evidence package under a stable release or research-data identifier.
