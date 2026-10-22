import asyncio
import io
import json
import time
import unittest
from unittest.mock import patch

from backend.asn_metadata import ASNResolver, fetch_holder


class MetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_dedup_nonblocking_ttl_and_negative_cache(self):
        now = [0]
        calls = []
        def fetch(asn):
            calls.append(asn)
            return 'Fixture holder' if asn == 1 else None
        resolver = ASNResolver(fetch=fetch, interval=0, clock=lambda: now[0])
        for _ in range(20):
            self.assertIsNone(resolver.lookup(1))
        self.assertEqual(calls, [])
        self.assertEqual(resolver.queue.qsize(), 1)
        worker = asyncio.create_task(resolver.run())
        try:
            await asyncio.wait_for(resolver.queue.join(), 2)
            self.assertEqual(resolver.lookup(1), 'Fixture holder')
            self.assertEqual(calls, [1])
            resolver.lookup(2)
            await asyncio.wait_for(resolver.queue.join(), 2)
            resolver.lookup(2)
            self.assertEqual(calls, [1, 2])
            now[0] = 301
            resolver.lookup(2)
            await asyncio.wait_for(resolver.queue.join(), 2)
            self.assertEqual(calls, [1, 2, 2])
            now[0] = 86401
            self.assertIsNone(resolver.lookup(1))
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)

    async def test_bounds_rate_limit_failure_and_snapshot_semantics(self):
        starts = []
        def failing(asn):
            starts.append(time.monotonic())
            raise TimeoutError()
        resolver = ASNResolver(fetch=failing, capacity=2, queue_limit=3, interval=.03)
        snapshot = dict(top_asns=[dict(asn=1, updates=10)], topology=dict(nodes=[dict(id='2', updates=5)], links=[]), events=[{'peer_asn':999}])
        result = resolver.enrich(snapshot)
        self.assertEqual(snapshot['top_asns'], [dict(asn=1, updates=10)])
        self.assertIs(result['events'], snapshot['events'])
        self.assertIs(result['topology']['links'], snapshot['topology']['links'])
        for asn in range(3, 100): resolver.lookup(asn)
        self.assertEqual(resolver.queue.qsize(), 3)
        self.assertEqual(len(resolver.pending), 3)
        worker = asyncio.create_task(resolver.run())
        try:
            await asyncio.wait_for(resolver.queue.join(), 2)
            self.assertEqual(len(resolver.cache), 2)
            self.assertTrue(all(b-a >= .025 for a,b in zip(starts, starts[1:])))
            self.assertFalse(resolver.pending)
            self.assertNotIn(999, resolver.cache)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)

    def test_source_validation(self):
        def response(data):
            return patch('backend.asn_metadata.urlopen', return_value=io.BytesIO(json.dumps(data).encode()))
        with response(dict(status='ok', data=dict(resource='AS1', holder='  Fixture   holder  '))):
            self.assertEqual(fetch_holder(1), 'Fixture holder')
        for data in [dict(status='error'), dict(status='ok', data=dict(resource='AS2', holder='Mismatch')), dict(status='ok', data=dict(resource='AS1', holder=None))]:
            with response(data): self.assertIsNone(fetch_holder(1))


if __name__ == '__main__':
    unittest.main()
