"""Bounded, best-effort RIPEstat holder resolution, independent of ingestion."""
import asyncio
import json
import time
from collections import OrderedDict
from urllib.request import Request, urlopen

SOURCE = "https://stat.ripe.net/data/as-overview/data.json"


def fetch_holder(asn):
    request = Request(f"{SOURCE}?resource=AS{asn}", headers={"User-Agent": "Internet-Pulse/1.0", "Accept": "application/json"})
    with urlopen(request, timeout=4) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError("Metadata response too large")
    payload = json.loads(raw)
    data = payload.get("data", {})
    if payload.get("status") != "ok" or str(data.get("resource")).upper() not in (str(asn), f"AS{asn}"):
        return None
    holder = data.get("holder")
    if not isinstance(holder, str) or not holder.strip() or holder.strip().lower() == "null":
        return None
    return " ".join(holder.split())[:300]


class ASNResolver:
    def __init__(self, fetch=fetch_holder, capacity=2048, queue_limit=256,
                 success_ttl=86400, failure_ttl=300, interval=1.0, clock=time.monotonic):
        self.fetch, self.capacity = fetch, capacity
        self.success_ttl, self.failure_ttl = success_ttl, failure_ttl
        self.interval, self.clock = interval, clock
        self.cache = OrderedDict()
        self.queue = asyncio.Queue(maxsize=queue_limit)
        self.pending = set()

    def lookup(self, asn):
        asn = int(asn)
        if not 0 <= asn <= 4294967295:
            return None
        entry = self.cache.get(asn)
        if entry and entry[1] > self.clock():
            self.cache.move_to_end(asn)
            return entry[0]
        self.cache.pop(asn, None)
        if asn not in self.pending and not self.queue.full():
            self.pending.add(asn)
            self.queue.put_nowait(asn)
        return None

    def enrich(self, snapshot):
        # Rankings first; only resolve nodes actually included in this view.
        ranking = [dict(row, organization=self.lookup(row["asn"])) for row in snapshot["top_asns"]]
        nodes = [dict(row, organization=self.lookup(row["id"])) for row in snapshot["topology"]["nodes"]]
        return dict(snapshot, top_asns=ranking, topology=dict(snapshot["topology"], nodes=nodes))

    async def run(self):
        while True:
            asn = await self.queue.get()
            try:
                try:
                    # Blocking HTTP runs in a worker thread, never on the ingestion loop.
                    holder = await asyncio.to_thread(self.fetch, asn)
                except Exception:
                    holder = None
                self.cache[asn] = (holder, self.clock() + (self.success_ttl if holder else self.failure_ttl))
                self.cache.move_to_end(asn)
                while len(self.cache) > self.capacity:
                    self.cache.popitem(last=False)
            finally:
                self.pending.discard(asn)
                self.queue.task_done()
            # One worker, at least one second between completed request and next start.
            await asyncio.sleep(self.interval)
