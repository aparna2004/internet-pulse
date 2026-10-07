"""Verify real snapshots through either FastAPI or the frontend's Vite proxy."""
import asyncio
import json
import sys
from websockets.asyncio.client import connect


async def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:5173/ws"
    async with connect(url) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), 10))
        for _ in range(15):
            snapshot = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if snapshot["connected"] and snapshot["total_received"] > first["total_received"] and snapshot["events"]:
                assert len(snapshot["heartbeat"]) == 60
                assert snapshot["topology"]["links"]
                print(json.dumps(dict(url=url, live=True, received=snapshot["total_received"],
                                      new_updates=snapshot["total_received"]-first["total_received"],
                                      rolling_updates=snapshot["updates_per_minute"],
                                      collectors=len(snapshot["collectors"]), event=snapshot["events"][0],
                                      topology_edges=len(snapshot["topology"]["links"])), indent=2))
                return
        raise RuntimeError("No fresh real RIS updates received in 15 snapshots")


asyncio.run(main())
