"""Read-only verification of genuine live capture. Does not write production data."""
import asyncio
import json
import statistics
import time
import urllib.request
from pathlib import Path
from websockets.asyncio.client import connect


def get(path):
    start = time.perf_counter()
    with urllib.request.urlopen('http://127.0.0.1:8000'+path, timeout=5) as response:
        payload = json.load(response)
    return payload, (time.perf_counter()-start)*1000


async def main():
    initial, _ = await asyncio.to_thread(get, '/health')
    arrivals, probes, errors = [], [], []
    start = time.monotonic()
    async with connect('ws://127.0.0.1:8000/ws', max_size=2**22, open_timeout=5) as ws:
        while time.monotonic()-start < 75:
            snapshot = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            arrivals.append(time.monotonic())
            if not snapshot['connected']:
                errors.append('Upstream disconnected')
            if len(arrivals) % 5 == 0:
                status, latency = await asyncio.to_thread(get, '/api/forecast')
                probes.append(latency)
                assert status['report'] is None, 'No production trained report expected during initial collection'
    final, _ = await asyncio.to_thread(get, '/health')
    status, _ = await asyncio.to_thread(get, '/api/forecast')
    gaps = [b-a for a, b in zip(arrivals, arrivals[1:])]
    result = dict(duration_seconds=time.monotonic()-start, snapshots=len(arrivals),
                  received_updates=final['total_received']-initial['total_received'],
                  gap_median_seconds=statistics.median(gaps), gap_max_seconds=max(gaps),
                  forecast_api_median_ms=statistics.median(probes), forecast_api_max_ms=max(probes),
                  errors=errors, forecast_state=status)
    path = Path(__file__).resolve().parent/'forecast-live-results.json'
    path.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
