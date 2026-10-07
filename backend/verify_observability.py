"""Real-feed assertions for all added snapshot payloads and live filter scopes."""
import asyncio
import json
from urllib.parse import urlencode
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

URL = "ws://127.0.0.1:5173/ws"


async def snapshot(ws):
    return json.loads(await asyncio.wait_for(ws.recv(), 15))


def validate(s):
    assert s["connected"] and s["global_total"] > 0
    assert len(s["heartbeat"]) == 60
    assert len(s["events"]) <= 50 and len(s["anomalies"]) <= 30
    assert len(s["topology"]["links"]) <= 100
    assert len(s["topology"]["nodes"]) <= 200
    assert len(s["top_asns"]) <= 10 and len(s["heatmap"]) <= 32
    assert all(len(row["values"]) == 60 for row in s["heatmap"])
    assert 0 <= s["activity"]["index"] <= 100
    assert s["activity"]["level"] in ("NORMAL", "ELEVATED", "HIGH", "SEVERE")
    assert s["spike_threshold"] >= 100
    assert all(n["updates"] >= 0 and n["connections"] >= 1 for n in s["topology"]["nodes"])


async def wait_for_events(ws):
    for _ in range(30):
        s = await snapshot(ws)
        if s["events"] and s["connected"]:
            validate(s)
            return s
    raise AssertionError("No real matching events in 30 seconds")


async def main():
    async with connect(URL + "?window=300") as ws:
        initial = await wait_for_events(ws)
        latest = await snapshot(ws)
        validate(latest)
        assert latest["global_total"] >= initial["global_total"]
        assert latest["heatmap_step"] == 5
        collector = latest["events"][0]["collector"]
        asn = str(latest["top_asns"][0]["asn"])
        prefix = latest["events"][0]["prefixes"][0]
        print(json.dumps(dict(scope="all", received=latest["global_total"],
                              heartbeat=len(latest["heartbeat"]), heatmap_rows=len(latest["heatmap"]),
                              nodes=len(latest["topology"]["nodes"]), edges=len(latest["topology"]["links"]),
                              anomaly_types=sorted({a["type"] for a in latest["anomalies"]}),
                              activity=latest["activity"]), indent=2))
    async with connect(URL + "?" + urlencode(dict(collector=collector))) as ws:
        s = await wait_for_events(ws)
        assert all(e["collector"] == collector for e in s["events"])
        assert all(r["collector"] == collector for r in s["heatmap"])
        assert s["global_total"] > latest["global_total"]
        print("Collector scope verified:", collector, "matching updates:", s["total_received"])
    async with connect(URL + "?" + urlencode(dict(asn=asn))) as ws:
        s = await wait_for_events(ws)
        assert all(str(e["peer_asn"]) == asn or int(asn) in e["path"] for e in s["events"])
        print("ASN scope verified: AS" + asn, "matching updates:", s["total_received"])
    # Exact prefix may quiet down: empty matching views are valid and must not invent events.
    async with connect(URL + "?" + urlencode(dict(prefix=prefix))) as ws:
        for _ in range(3):
            s = await snapshot(ws)
        validate(s)
        assert all(prefix in e["prefixes"] for e in s["events"])
        print("Prefix scope verified:", prefix, "matching updates:", s["total_received"])
    async with connect(URL + "?prefix=192.0.2.0/99") as ws:
        try:
            await ws.recv()
        except ConnectionClosed as e:
            assert e.code == 1008
            print("Invalid CIDR rejected safely with code 1008")
        else:
            raise AssertionError("Invalid CIDR accepted")


asyncio.run(main())
