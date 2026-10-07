import asyncio
import json
import logging
import math
import time
from collections import Counter, deque, OrderedDict
import ipaddress
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect

log = logging.getLogger("internet-pulse")
RIS_URL = "wss://ris-live.ripe.net/v1/ws/?client=internet-pulse-v1"
KEY_LIMIT = 4096


def bounded_add(counter, key, limit=KEY_LIMIT):
    if key in counter or len(counter) < limit:
        counter[key] += 1
        return True
    return False


class Pulse:
    def __init__(self):
        self.buckets = deque(maxlen=600)
        self.events = deque(maxlen=80)
        self.anomalies = deque(maxlen=60)
        self.alert_count = 0
        self.routes = OrderedDict()
        self.started = None
        self.filter_prefix = ""
        self.path_baseline = 0
        self.path_samples = 0
        self.last_long = {}
        self.last_burst = -1
        self.last_used = time.time()
        self.cache = {}
        self.cache_second = -1
        self.limited = False
        self.connected = False
        self.last_received = None
        self.total = 0
        self.malformed = 0
        self.error = None

    def bucket(self, now):
        second = int(now)
        if not self.buckets or self.buckets[-1]["second"] != second:
            self.buckets.append(dict(second=second, updates=0, announcements=0,
                                     withdrawals=0, path_sum=0, path_count=0,
                                     flaps=0, asns=Counter(), collectors=Counter(), edges=Counter()))
            recent = [b for b in self.buckets if second - 60 < b["second"] < second]
            self.path_samples = sum(b["path_count"] for b in recent)
            self.path_baseline = sum(b["path_sum"] for b in recent) / max(1, self.path_samples)
        while self.buckets and self.buckets[0]["second"] <= second - 600:
            self.buckets.popleft()
        return self.buckets[-1]

    def ingest(self, data, now=None):
        if not isinstance(data, dict) or data.get("type") != "UPDATE":
            return False
        try:
            peer = int(data["peer_asn"])
            timestamp = float(data["timestamp"])
            host = data["host"]
            if not 0 <= peer <= 4294967295 or not math.isfinite(timestamp) or not isinstance(host, str) or len(host) > 64:
                raise ValueError("invalid metadata")
            path = data.get("path", [])
            if not isinstance(path, list) or len(path) > 256:
                raise ValueError("invalid path")
            # AS_SETs are unordered: preserve them, but never invent edges through them.
            for segment in path:
                values = segment if isinstance(segment, list) else [segment]
                if len(values) > 256 or any(type(x) is not int or not 0 <= x <= 4294967295 for x in values):
                    raise ValueError("invalid ASN")
            announcements = data.get("announcements", [])
            withdrawals = data.get("withdrawals", [])
            if not isinstance(announcements, list) or not isinstance(withdrawals, list):
                raise ValueError("invalid prefixes")
            prefixes = []
            for announcement in announcements:
                if not isinstance(announcement, dict) or not isinstance(announcement.get("prefixes"), list):
                    raise ValueError("invalid announcement")
                prefixes.extend(announcement["prefixes"])
            if any(not isinstance(p, str) or len(p) > 64 for p in prefixes + withdrawals):
                raise ValueError("invalid prefix")
        except (KeyError, TypeError, ValueError, OverflowError):
            self.malformed += 1
            return False
        now = time.time() if now is None else now
        if self.started is None:
            self.started = now
        b = self.bucket(now)
        b["updates"] += 1
        b["announcements"] += len(prefixes)
        b["withdrawals"] += len(withdrawals)
        if path:
            b["path_sum"] += len(path)
            b["path_count"] += 1
        for asn in {x for x in path if isinstance(x, int)}:
            if not bounded_add(b["asns"], asn, 1024):
                self.limited = True
        bounded_add(b["collectors"], host, 64)
        for a, z in zip(path, path[1:]):
            if isinstance(a, int) and isinstance(z, int) and a != z:
                if not bounded_add(b["edges"], tuple(sorted((a, z))), 1024):
                    self.limited = True
        origin = path[-1] if path and type(path[-1]) is int else None
        for prefix in withdrawals:
            self.observe_route(host, peer, prefix, False, None, now, b)
        for prefix in prefixes:
            self.observe_route(host, peer, prefix, True, origin, now, b)
        if self.path_samples >= 30 and len(path) >= max(12, self.path_baseline * 2):
            if now - self.last_long.get(peer, -1000) >= 30:
                if len(self.last_long) >= 1024:
                    self.last_long.clear()
                self.last_long[peer] = now
                self.alert("LONG AS PATH", "MEDIUM", now, prefixes[0] if prefixes else None, peer, host,
                           f"Path has {len(path)} segments; recent mean is {self.path_baseline:.1f} (threshold: 2× mean, minimum 12).")
        self.total += 1
        self.last_received = now
        self.events.appendleft(dict(id=self.total, timestamp=timestamp, received_at=now,
                                    peer_asn=peer, collector=host, path=path,
                                    announcements=len(prefixes), withdrawals=len(withdrawals),
                                    prefixes=([self.filter_prefix] + [p for p in prefixes + withdrawals if p != self.filter_prefix])[:8] if self.filter_prefix else (prefixes + withdrawals)[:8],
                                    announced_prefixes=prefixes[:8], withdrawn_prefixes=withdrawals[:8]))
        return True

    def alert(self, kind, severity, now, prefix, asn, collector, explanation):
        self.alert_count += 1
        self.anomalies.appendleft(dict(id=str(self.alert_count),
                                       timestamp=now, type=kind, severity=severity, prefix=prefix,
                                       asn=asn, collector=collector, explanation=explanation))

    def observe_route(self, host, peer, prefix, announced, origin, now, bucket):
        # Scope by peering session: different collectors' legitimate routes must not look like flaps.
        key = (host, peer, prefix)
        previous = self.routes.pop(key, None)
        state = previous if previous and now - previous["seen"] <= 300 else dict(
            announced=announced, origin=None, flips=deque(maxlen=12), alert=-1000, origin_alert=-1000)
        if previous and now - previous["seen"] <= 300 and state["announced"] != announced:
            state["flips"].append(now)
            bucket["flaps"] += 1
            flips = sum(t > now - 60 for t in state["flips"])
            if flips >= 4 and now - state["alert"] >= 60:
                state["alert"] = now
                self.alert("ROUTE FLAP", "HIGH" if flips >= 8 else "MEDIUM", now, prefix, peer, host,
                           f"{flips} announce/withdraw transitions within 60s on this collector/peer route.")
        if announced and origin is not None:
            if state["origin"] is not None and state["origin"] != origin and now - state["origin_alert"] >= 60:
                state["origin_alert"] = now
                self.alert("ORIGIN CHANGE", "LOW", now, prefix, origin, host,
                           f"Observed origin changed from AS{state['origin']} to AS{origin} on the same collector/peer. This may be legitimate routing.")
            state["origin"] = origin
        state.update(announced=announced, seen=now)
        self.routes[key] = state
        while len(self.routes) > 20000:
            self.routes.popitem(last=False)

    def snapshot(self, now=None, window=60):
        now = time.time() if now is None else now
        self.bucket(now)
        window = 300 if window == 300 else 60
        recent = [b for b in self.buckets if int(now) - window < b["second"]]
        prior = [b for b in self.buckets if int(now) - 2 * window < b["second"] <= int(now) - window]
        totals = {k: sum(b[k] for b in recent) for k in
                  ("updates", "announcements", "withdrawals", "path_sum", "path_count")}
        asns, collectors, edges = Counter(), Counter(), Counter()
        node_seen, edge_seen = {}, {}
        for b in recent:
            asns.update(b["asns"])
            collectors.update(b["collectors"])
            edges.update(b["edges"])
            for a in b["asns"]:
                node_seen[a] = b["second"]
            for edge in b["edges"]:
                edge_seen[edge] = b["second"]
        by_second = {b["second"]: b for b in self.buckets}
        baseline_buckets = [by_second.get(s, {}).get("updates", 0) for s in range(int(now)-60, int(now)-1)
                            if self.started is not None and s >= int(self.started)]
        baseline = sum(baseline_buckets) / max(1, len(baseline_buckets))
        threshold = max(100, baseline * 3)
        rate = by_second.get(int(now)-1, {}).get("updates", 0)
        ready = len(baseline_buckets) >= 15
        if ready and rate > threshold and int(now) - self.last_burst >= 15:
            self.last_burst = int(now)
            ratio = rate / max(1, baseline)
            self.alert("UPDATE BURST", "CRITICAL" if ratio >= 10 else "HIGH" if ratio >= 5 else "MEDIUM",
                       int(now)-1, None, None, None,
                       f"{rate:,} updates/sec versus {baseline:,.0f}/sec baseline ({ratio:.1f}×); threshold is max(100, 3× baseline).")
        heartbeat = [dict(timestamp=s, updates=by_second.get(s, {}).get("updates", 0),
                          announcements=by_second.get(s, {}).get("announcements", 0),
                          withdrawals=by_second.get(s, {}).get("withdrawals", 0),
                          spike=by_second.get(s, {}).get("updates", 0) if ready and by_second.get(s, {}).get("updates", 0) > threshold else None)
                     for s in range(int(now) - 60, int(now))]
        links = [dict(source=str(a), target=str(z), value=n, last_seen=edge_seen[(a,z)]) for (a, z), n in edges.most_common(100)]
        nodes = sorted({l[k] for l in links for k in ("source", "target")})
        degree = Counter(x for l in links for x in (l["source"], l["target"]))
        minute = [b for b in self.buckets if int(now)-60 < b["second"]]
        ann, wd, flaps = (sum(b[k] for b in minute) for k in ("announcements", "withdrawals", "flaps"))
        index = round(min(100, 20*min(1, ann/1000000) + 25*min(1, wd/250000)
                          + 25*min(1, flaps/50000) + 30*min(1, rate/max(100, baseline*3))), 1)
        level = "SEVERE" if index >= 75 else "HIGH" if index >= 50 else "ELEVATED" if index >= 25 else "NORMAL"
        previous = None
        if self.started is not None and now - self.started >= window * 2:
            previous = {k: sum(b[k] for b in prior) for k in ("updates", "announcements", "withdrawals", "path_sum", "path_count")}
            previous["average_path_length"] = previous["path_sum"] / max(1, previous["path_count"])
            previous["updates_per_minute"] = sum(b["updates"] for b in self.buckets if int(now)-120 < b["second"] <= int(now)-60)
        # Remove expired route observations without retaining full event history.
        while self.routes and next(iter(self.routes.values()))["seen"] < now - 300:
            self.routes.popitem(last=False)
        heat_step = window // 60
        heatmap = [dict(collector=c, values=[sum(by_second.get(s, {}).get("collectors", {}).get(c, 0)
                       for s in range(t, t+heat_step)) for t in range(int(now)-window, int(now), heat_step)])
                   for c, _ in collectors.most_common(32)]
        return dict(connected=self.connected, last_received=self.last_received, error=self.error,
                    total_received=self.total, malformed=self.malformed, timestamp=now,
                    window=window, coverage_seconds=min(window, int(now-(self.started or now))),
                    baseline_ready=ready, rolling_average=round(baseline, 1), spike_threshold=round(threshold, 1),
                    previous=previous, limited=self.limited, activity=dict(index=index, level=level, flaps=flaps),
                    anomalies=[a for a in self.anomalies if a["timestamp"] > now-window][:30],
                    heatmap=heatmap, heatmap_start=int(now)-window, heatmap_step=heat_step,
                    updates_per_second=rate, updates_per_minute=sum(b["updates"] for b in minute), window_updates=totals["updates"],
                    announcements=totals["announcements"], withdrawals=totals["withdrawals"],
                    average_path_length=round(totals["path_sum"] / max(1, totals["path_count"]), 2),
                    heartbeat=heartbeat, top_asns=[dict(asn=a, updates=n) for a, n in asns.most_common(10)],
                    collectors=[dict(name=a, updates=n) for a, n in collectors.most_common(32)],
                    events=[e for e in self.events if e["received_at"] > now-window][:50], topology=dict(nodes=[dict(id=a, updates=asns[int(a)], connections=degree[a], last_seen=node_seen.get(int(a), now-window)) for a in nodes], links=links))


pulse = Pulse()
views = {}  # At most four additional live filter aggregates; no raw firehose retention.


def matches(data, filters):
    collector, asn, prefix = filters
    if not isinstance(data, dict):
        return False
    if collector and data.get("host") != collector:
        return False
    if asn and str(data.get("peer_asn")) != asn and int(asn) not in data.get("path", []):
        return False
    if prefix:
        announced = [p for a in data.get("announcements", []) if isinstance(a, dict) for p in a.get("prefixes", [])]
        if prefix not in announced + data.get("withdrawals", []):
            return False
    return True


async def ingest_loop():
    delay = 1
    while True:
        try:
            async with connect(RIS_URL, max_size=2**20, max_queue=32, ping_interval=20, ping_timeout=20) as ws:
                await ws.send(json.dumps(dict(type="ris_subscribe", data=dict(type="UPDATE", socketOptions=dict(acknowledge=True)))))
                processed = 0
                async for raw in ws:
                    processed += 1
                    if processed % 250 == 0:
                        await asyncio.sleep(0)  # Give health checks and dashboard sockets time during bursts.
                    try:
                        message = json.loads(raw)
                        if not isinstance(message, dict):
                            raise ValueError("invalid envelope")
                        if message.get("type") == "ris_error":
                            raise RuntimeError(str(message.get("data"))[:200])
                        if message.get("type") == "ris_subscribe_ok":
                            pulse.connected, pulse.error, delay = True, None, 1
                        elif message.get("type") == "ris_message":
                            if pulse.ingest(message.get("data")):
                                pulse.connected, pulse.error, delay = True, None, 1
                                for filters, view in list(views.items()):
                                    if time.time() - view.last_used > 60:
                                        del views[filters]
                                    elif matches(message["data"], filters):
                                        view.ingest(message["data"])
                    except (json.JSONDecodeError, ValueError):
                        pulse.malformed += 1
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            pulse.error = str(exc)[:200]
            log.warning("RIS disconnected: %s; retry in %ss", pulse.error, delay)
        finally:
            pulse.connected = False
        await asyncio.sleep(delay)
        delay = min(delay * 2, 30)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(ingest_loop())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="Internet Pulse", lifespan=lifespan)


@app.get("/health")
async def health():
    return dict(service="ok", ris_connected=pulse.connected, total_received=pulse.total,
                last_received=pulse.last_received, error=pulse.error)


@app.websocket("/ws")
async def stream(ws: WebSocket):
    collector = ws.query_params.get("collector", "")
    asn = ws.query_params.get("asn", "")
    prefix = ws.query_params.get("prefix", "")
    window = 300 if ws.query_params.get("window") == "300" else 60
    try:
        if collector and (len(collector) > 32 or not collector.startswith("rrc")):
            raise ValueError("collector")
        if asn and not 0 <= int(asn) <= 4294967295:
            raise ValueError("ASN")
        if asn:
            asn = str(int(asn))
        if prefix:
            prefix = str(ipaddress.ip_network(prefix, strict=False))
    except ValueError:
        await ws.accept()
        await ws.close(code=1008, reason="Invalid filter")
        return
    filters = (collector, asn, prefix)
    if any(filters) and filters not in views and len(views) >= 4:
        for key in list(views):
            if time.time() - views[key].last_used > 60:
                del views[key]
        if len(views) >= 4:
            await ws.accept()
            await ws.close(code=1013, reason="Filter capacity reached; reset filters or retry later")
            return
    view = views.setdefault(filters, Pulse()) if any(filters) else pulse
    view.filter_prefix = prefix
    await ws.accept()
    try:
        while True:
            now = time.time()
            view.last_used = now
            if view.cache_second != int(now):
                view.cache.clear()
                view.cache_second = int(now)
            if window not in view.cache:
                view.cache[window] = view.snapshot(now, window)
            snapshot = dict(view.cache[window], connected=pulse.connected, error=pulse.error,
                            last_received=pulse.last_received, global_total=pulse.total,
                            filters=dict(collector=collector, asn=asn, prefix=prefix),
                            available_collectors=sorted({c for b in pulse.buckets for c in b["collectors"]}))
            await asyncio.wait_for(ws.send_json(snapshot), timeout=5)
            await asyncio.sleep(1)
    except (WebSocketDisconnect, RuntimeError, OSError, asyncio.TimeoutError):
        with suppress(Exception):
            await ws.close()
