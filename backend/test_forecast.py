"""Isolated fixtures verify mechanics; no fixture data reaches live storage or UI."""
import asyncio
import json
import tempfile
import unittest
from collections import Counter, deque
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path
from types import SimpleNamespace
from backend.forecast_data import FEATURES, MIN_EXAMPLES, INTERVAL, HistoryStore, WindowSampler, examples, features
from backend.forecast_service import ForecastService
from backend import forecast_worker


def fixture_rows(count=200):
    return [dict(window=i*INTERVAL, updates=100+i%17*3, announcements=90, withdrawals=i%7,
                 path_sum=400, path_count=100, flaps=1, collectors=3, valid=True, reason='') for i in range(count)]


class FeatureTests(unittest.TestCase):
    def test_only_past_features_and_future_target(self):
        rows = fixture_rows(8)
        x = features(rows, 5*INTERVAL)
        self.assertEqual(len(x), len(FEATURES))
        self.assertEqual(x[:5], [112, 109, 106, 103, 100])
        rows[5]['updates'] = 99999
        self.assertEqual(features(rows, 5*INTERVAL), x)
        sample = examples(rows)[0]
        self.assertEqual(sample['origin'], 5*INTERVAL)
        self.assertEqual(sample['y'], 99999)
        self.assertEqual(sample['x'], x)

    def test_missing_and_invalid_windows_exclude_examples(self):
        rows = fixture_rows(12)
        rows[5]['valid'] = False
        self.assertEqual([s['origin'] for s in examples(rows)], [11*INTERVAL])
        del rows[5]
        self.assertEqual([s['origin'] for s in examples(rows)], [11*INTERVAL])

    def test_split_has_embargo_and_shared_test_targets(self):
        samples = examples(fixture_rows())
        train, test = forecast_worker.split(samples)
        self.assertLessEqual(train[-1]['origin']+INTERVAL, test[0]['origin']-INTERVAL)
        self.assertTrue(all(s['origin'] < test[0]['origin'] for s in train))
        self.assertEqual(len(test), len(samples)-int(len(samples)*.7))

    def test_metrics(self):
        result = forecast_worker.metrics([0, 10], [2, 6])
        self.assertEqual(result['mae'], 3)
        self.assertAlmostEqual(result['rmse'], 10**.5)


class SamplerTests(unittest.TestCase):
    def test_scheduler_lag_recovers_real_completed_buckets(self):
        sampler = WindowSampler()
        buckets = [dict(second=s, updates=7, announcements=10, withdrawals=2,
                        path_sum=28, path_count=7, flaps=1, collectors={'rrc00':7}) for s in range(10, 15)]
        sampler.sample_many(5, True, [], 0)
        sampler.sample_many(6, True, [], 0)
        sampler.sample_many(10, True, buckets, 0)
        result = sampler.sample_many(15, True, buckets, 0)
        self.assertTrue(result[-1]['valid'])
        self.assertEqual(result[-1]['updates'], 35)
        self.assertEqual(result[-1]['collectors'], 1)

    def test_disconnect_between_polls_and_partial_first_second_are_excluded(self):
        sampler = WindowSampler()
        sampler.sample_many(5.4, True, [], 0)
        partial = sampler.sample_many(10, True, [], 0)
        self.assertFalse(partial[-1]['valid'])
        sampler.sample_many(11, True, [], 0)
        interrupted = sampler.sample_many(15, True, [], 1)
        self.assertFalse(interrupted[-1]['valid'])

    def test_recovery_is_bounded_and_never_fills_long_gaps(self):
        sampler = WindowSampler()
        sampler.sample_many(5, True, [], 0)
        row = sampler.sample_many(30, True, [], 0)
        self.assertEqual(len(row), 1)
        self.assertFalse(row[0]['valid'])

    def test_connected_quiet_complete_window_is_valid_zero(self):
        sampler = WindowSampler()
        sampler.sample(5, True, [])
        for second in range(6, 11):
            row = sampler.sample(second, True, [])
        self.assertTrue(row['valid'])
        self.assertEqual(row['updates'], 0)
        self.assertEqual(row['window'], 5)

    def test_partial_startup_outage_and_sampler_gap(self):
        for bad in ('startup', 'disconnect', 'gap'):
            sampler = WindowSampler()
            start = 7 if bad == 'startup' else 5
            for second in range(start, 11):
                if bad == 'gap' and second == 8:
                    continue
                row = sampler.sample(second, not (bad == 'disconnect' and second == 8), [])
            self.assertFalse(row['valid'], bad)

    def test_bucket_scalars_and_collectors_are_copied_once(self):
        sampler = WindowSampler()
        buckets = deque([dict(second=5, updates=7, announcements=10, withdrawals=2,
                              path_sum=28, path_count=7, flaps=1, collectors=Counter({'rrc00':7}))])
        sampler.sample(5, True, buckets)
        sampler.sample(6, True, buckets)
        sampler.sample(6.5, True, buckets)
        for second in range(7, 11):
            row = sampler.sample(second, True, buckets)
        self.assertTrue(row['valid'])
        self.assertEqual((row['updates'], row['collectors'], row['announcements']), (7, 1, 10))


class StoreTests(unittest.TestCase):
    def test_maturation_zero_actual_invalid_target_and_retention(self):
        with tempfile.TemporaryDirectory() as folder:
            store = HistoryStore(Path(folder)/'test.sqlite3')
            prediction = dict(origin=INTERVAL, version='test', actual=None, outcome='pending', predictions={'baseline':1})
            store.save_forecast(prediction)
            self.assertIsNone(store.read()[2][0]['actual'])
            row = fixture_rows(2)[1]
            row['updates'] = 0
            store.save_window(row)
            self.assertEqual(store.read()[2][0]['actual'], 0)
            prediction.update(origin=2*INTERVAL)
            store.save_forecast(prediction)
            row.update(window=2*INTERVAL, valid=False)
            store.save_window(row)
            self.assertTrue(store.read()[2][0]['outcome'].startswith('excluded'))
            row.update(window=15*86400)
            store.save_window(row)
            self.assertEqual(len(store.read()[0]), 1)
            self.assertEqual(store.read()[2], [])

    def test_clock_rollback_does_not_replace_history(self):
        with tempfile.TemporaryDirectory() as folder:
            store = HistoryStore(Path(folder)/'test.sqlite3')
            row = fixture_rows(1)[0]
            store.save_window(row)
            row['updates'] = 9999
            store.save_window(row)
            self.assertEqual(store.read()[0][0]['updates'], 100)

    def test_cold_start_has_no_report_or_scores(self):
        service = ForecastService(SimpleNamespace(connected=False, buckets=[]), ':unused:')
        self.assertEqual(service.state['status'], 'collecting')
        self.assertIsNone(service.state['report'])
        self.assertEqual(service.state['eligible_examples'], 0)


class WorkerTests(unittest.TestCase):
    def test_minimum_live_sample_is_preliminary(self):
        samples = examples(fixture_rows(MIN_EXAMPLES+5))
        with ProcessPoolExecutor(max_workers=1, mp_context=get_context('spawn'), initializer=forecast_worker.initialize) as executor:
            report = executor.submit(forecast_worker.train, samples).result(timeout=60)
        self.assertEqual(report['samples'], 8)
        self.assertEqual(report['train_samples'], 4)
        self.assertEqual(report['test_samples'], 3)
        self.assertTrue(report['preliminary'])
        self.assertEqual(report['horizon_seconds'], 5)
        self.assertEqual(report['embargo_seconds'], 5)
        json.dumps(report, allow_nan=False)

    def test_both_models_in_spawned_worker_and_real_prediction_maturation(self):
        # Explicit isolated test fixture, never the production HistoryStore.
        rows = fixture_rows(200)
        samples = examples(rows)
        self.assertGreaterEqual(len(samples), MIN_EXAMPLES)
        with ProcessPoolExecutor(max_workers=1, mp_context=get_context('spawn'), initializer=forecast_worker.initialize) as executor:
            report = executor.submit(forecast_worker.train, samples).result(timeout=60)
            prediction = executor.submit(forecast_worker.predict, features(rows, 200*INTERVAL), 200*INTERVAL).result(timeout=15)
        self.assertEqual(set(report['scores']), {'baseline', 'random_forest', 'hist_gradient_boosting'})
        self.assertEqual(report['scores']['baseline']['mae'],
                         forecast_worker.metrics([s['y'] for s in forecast_worker.split(samples)[1]],
                                                 [s['x'][0] for s in forecast_worker.split(samples)[1]])['mae'])
        self.assertEqual(prediction['version'], report['version'])
        self.assertEqual(prediction['origin'], report['live_fit_label_end'])
        self.assertIsNone(prediction['actual'])
        self.assertTrue(all(v >= 0 for v in prediction['predictions'].values()))
        self.assertFalse(report['parameters']['hist_gradient_boosting']['early_stopping'])
        self.assertEqual(report['versions']['sklearn'], '1.7.2')
        json.dumps(report, allow_nan=False)
        with tempfile.TemporaryDirectory() as folder:
            store = HistoryStore(Path(folder)/'test.sqlite3')
            store.save_report(report)
            store.save_forecast(prediction)
            row = fixture_rows(201)[-1]
            store.save_window(row)
            self.assertEqual(store.read()[2][0]['actual'], row['updates'])


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_service_trains_and_persists_comparison_in_isolation(self):
        with tempfile.TemporaryDirectory() as folder:
            service = ForecastService(SimpleNamespace(connected=True, buckets=[]), Path(folder)/'test.sqlite3')
            try:
                await service.fit(examples(fixture_rows(200)))
                self.assertTrue(service.ready, service.error)
                self.assertEqual(service.state['status'], 'ready')
                _, persisted, _ = await asyncio.to_thread(service.store.read)
                self.assertEqual(persisted['version'], service.report['version'])
                self.assertEqual(len(persisted['scores']), 3)
                self.assertEqual(service.pulse.buckets, [])
            finally:
                if service.pool:
                    await asyncio.to_thread(service.pool.shutdown, wait=True, cancel_futures=True)

    async def test_collection_continues_while_training_waits(self):
        with tempfile.TemporaryDirectory() as folder:
            pulse = SimpleNamespace(connected=True, buckets=[])
            service = ForecastService(pulse, Path(folder)/'test.sqlite3')
            def seed():
                for row in fixture_rows(190):
                    service.store.save_window(row)
            await asyncio.to_thread(seed)
            training_started = asyncio.Event()
            training_release = asyncio.Event()

            async def delayed_fit(samples):
                training_started.set()
                await training_release.wait()

            service.fit = delayed_fit
            emitted = dict(fixture_rows(191)[-1])
            calls = 0

            def sample(*args):
                nonlocal calls
                calls += 1
                return emitted if calls == 2 else None

            service.sampler.sample = sample
            task = asyncio.create_task(service.run())
            try:
                await asyncio.wait_for(training_started.wait(), timeout=5)
                for _ in range(30):
                    if any(r['window'] == emitted['window'] for r in service.rows):
                        break
                    await asyncio.sleep(.1)
                self.assertTrue(any(r['window'] == emitted['window'] for r in service.rows))
                self.assertFalse(service.job.done())
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


if __name__ == '__main__':
    unittest.main()
