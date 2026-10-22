# Deploy Internet Pulse from GitHub to Render

The root Dockerfile builds the React frontend using the checked-in pnpm lockfile, then packages its static output with FastAPI and the model worker in Python 3.12. A single public service serves the page, `/api`, `/health` and `/ws` on the same HTTPS host. The frontend automatically chooses WSS on HTTPS; no localhost URL or separate CORS setup is needed in production.

## GitHub and Render

1. Push this repository to your GitHub account.
2. In Render, create a Blueprint from that repository. Render reads `render.yaml`.
3. Confirm the Free web service for a demo. No paid disk/service is configured by this blueprint.
4. GitHub Actions runs backend tests, TypeScript/build, frontend connection checks and a container build. Render's `checksPass` trigger deploys subsequent commits after checks pass.
5. Open the service URL. Confirm `/health`, an advancing last-snapshot time, live BGP updates, organization metadata and the model comparison. A fresh healthy connection normally produces the first preliminary model comparison in about 65–70 seconds. Connection gaps and first imports can extend that interval.

Use exactly **one service instance and one Uvicorn worker**. Every process otherwise starts its own upstream subscription and writes the same local history. The Docker start command already enforces one worker and accepts Render's `PORT` environment variable. Outbound HTTPS/WSS access to RIPE RIS Live and RIPEstat is required.

## History persistence and Free-tier limitations

Render Free services have ephemeral storage and may sleep/restart. Therefore the demo loses its model history/evaluations on restarts and collects a fresh preliminary comparison when it wakes. It is not a continuously available monitoring deployment. No fake observations are substituted during warm-up.

For durable history and continuous operation, select a paid service and attach a persistent disk at **`/app/data`**. That requires a separate billing choice; it is deliberately absent from the Free blueprint. `PULSE_DATA_DIR` defaults to the project's local `data/` folder outside Docker and is set to `/app/data` in the container. Both the backend and forecast CLI honor it. The rapid-mode database file is `forecast-5s.sqlite3`.

No API keys are required for the public routing sources. GitHub/Render authentication belongs in their own sign-in flows, not source files. Local databases, environment files, virtual environments, node_modules, logs and verification backup copies are excluded from the deployment build.

## Local production check

```sh
docker build -t internet-pulse .
docker run --rm -p 10000:10000 -v pulse-data:/app/data internet-pulse
```

Open `http://localhost:10000`. The normal Vite development workflow on port 5173 is unchanged.

References: [Render Blueprint specification](https://render.com/docs/blueprint-spec), [Free-service limits](https://render.com/docs/free), [persistent disks](https://render.com/docs/disks).
