import unittest
from backend.main import Pulse, KEY_LIMIT, bounded_add, matches
from collections import Counter


class AggregationTests(unittest.TestCase):
    def message(self, **changes):
        message = dict(type="UPDATE", peer_asn="3333", timestamp=1000.5, host="rrc00",
                    path=[3333, 3333, 1299, [10, 20]],
                    announcements=[dict(prefixes=["192.0.2.0/24", "2001:db8::/32"])],
                    withdrawals=["198.51.100.0/24"])
        message.update(changes)
        return message

    def test_counts_paths_sets_and_expiry(self):
        p = Pulse()
        self.assertTrue(p.ingest(self.message(), now=1000))
        s = p.snapshot(1000)
        self.assertEqual((s["updates_per_minute"], s["announcements"], s["withdrawals"]), (1, 2, 1))
        self.assertEqual(s["average_path_length"], 4)
        self.assertEqual(s["topology"]["links"], [dict(source="1299", target="3333", value=1, last_seen=1000)])
        self.assertEqual(len(s["heartbeat"]), 60)
        self.assertEqual(p.snapshot(1060)["updates_per_minute"], 0)
        self.assertEqual(p.snapshot(1060)["topology"]["links"], [])

    def test_malformed_and_bounds(self):
        p = Pulse()
        for bad in [None, [], {}, dict(type="UPDATE"), dict(type="UPDATE", peer_asn="bad")]:
            self.assertFalse(p.ingest(bad))
        message = self.message()
        message["path"] = [True]
        self.assertFalse(p.ingest(message))
        for i in range(700):
            p.ingest(self.message(), now=1000+i)
        self.assertEqual(len(p.events), 80)
        self.assertEqual(len(p.buckets), 600)
        c = Counter()
        for i in range(KEY_LIMIT+100):
            bounded_add(c, i)
        self.assertEqual(len(c), KEY_LIMIT)

    def test_five_minute_history_and_real_previous_window(self):
        p = Pulse()
        for second in range(1000, 1601):
            p.ingest(self.message(), now=second)
        s = p.snapshot(1600, 300)
        self.assertEqual(s["window_updates"], 300)
        self.assertEqual(s["updates_per_minute"], 60)
        self.assertEqual(s["previous"]["updates"], 300)
        self.assertEqual(s["previous"]["updates_per_minute"], 60)
        self.assertEqual(s["heatmap_step"], 5)
        self.assertEqual(len(s["heatmap"][0]["values"]), 60)
        self.assertEqual(sum(s["heatmap"][0]["values"]), 300)
        self.assertEqual(p.snapshot(1900, 300)["window_updates"], 0)

    def test_flaps_scoped_to_collector_and_peer(self):
        p = Pulse()
        for i in range(5):
            p.ingest(self.message(announcements=[dict(prefixes=["192.0.2.0/24"])] if i%2==0 else [],
                                  withdrawals=["192.0.2.0/24"] if i%2 else []), now=1000+i)
        s=p.snapshot(1005)
        self.assertEqual(s["activity"]["flaps"],4)
        self.assertTrue(any(a["type"]=="ROUTE FLAP" for a in s["anomalies"]))
        q=Pulse()
        q.ingest(self.message(announcements=[dict(prefixes=["192.0.2.0/24"])],withdrawals=[]),now=1000)
        q.ingest(self.message(host="rrc01",announcements=[],withdrawals=["192.0.2.0/24"]),now=1001)
        self.assertEqual(q.snapshot(1002)["activity"]["flaps"],0)

    def test_origin_change_and_unordered_origin(self):
        p=Pulse()
        for i,path in enumerate([[3333,10],[3333,20],[3333,[30,40]]]):
            p.ingest(self.message(path=path,withdrawals=[]),now=1000+i)
        alerts=[a for a in p.snapshot(1003)["anomalies"] if a["type"]=="ORIGIN CHANGE"]
        self.assertEqual(len(alerts),2)  # two announced prefixes, one change each
        self.assertTrue(all(a["severity"]=="LOW" for a in alerts))

    def test_long_path_relative_to_baseline(self):
        p=Pulse()
        for _ in range(30):
            p.ingest(self.message(path=[3333,10,20]),now=1000)
        p.ingest(self.message(path=list(range(15))),now=1001)
        self.assertTrue(any(a["type"]=="LONG AS PATH" for a in p.snapshot(1002)["anomalies"]))

    def test_burst_excludes_current_bucket_and_warmup(self):
        p=Pulse()
        for i in range(20):
            p.ingest(self.message(),now=1000+i)
        for _ in range(150):
            p.ingest(self.message(),now=1020)
        self.assertFalse(any(a["type"]=="UPDATE BURST" for a in p.snapshot(1020)["anomalies"]))
        s=p.snapshot(1021)
        self.assertEqual(s["updates_per_second"],150)
        self.assertTrue(any(a["type"]=="UPDATE BURST" and a["severity"]=="CRITICAL" for a in s["anomalies"]))
        self.assertTrue(0<=s["activity"]["index"]<=100)

    def test_filter_matching_does_not_invent_data(self):
        message=self.message()
        self.assertTrue(matches(message,("rrc00","3333","192.0.2.0/24")))
        self.assertTrue(matches(message,("","1299","198.51.100.0/24")))
        self.assertFalse(matches(message,("rrc01","","")))
        self.assertFalse(matches(message,("","64496","")))
        self.assertFalse(matches(message,("","","203.0.113.0/24")))

    def test_tracking_and_anomaly_memory_are_bounded(self):
        p=Pulse()
        b=p.bucket(1000)
        for i in range(20100):
            p.observe_route("rrc00",3333,str(i),True,10,1000,b)
        self.assertEqual(len(p.routes),20000)
        for i in range(100):
            p.alert("ORIGIN CHANGE","LOW",1000,str(i),10,"rrc00","test")
        self.assertEqual(len(p.anomalies),60)
        self.assertEqual(len({a["id"] for a in p.anomalies}),60)
        p.snapshot(1301)
        self.assertEqual(len(p.routes),0)


if __name__ == "__main__":
    unittest.main()
