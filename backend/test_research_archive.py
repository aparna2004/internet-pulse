"""Isolated mechanics tests; fixtures never enter live or research evidence."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
from backend.research_archive import Recorder, hour_start, summarize, single_recorder


def window(t, count=10, valid=True):
    return dict(window=t, updates=count, valid=valid, announcements=8, withdrawals=2)


def forecast(t, actual=10, outcome='observed', delay=.5):
    return dict(origin=t, target_end=t+5, generated_at=t+delay, version='v1',
                predictions={'baseline':8, 'random_forest':9, 'hist_gradient_boosting':12},
                actual=actual, outcome=outcome)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);self.source=root/'live.sqlite3';self.output=root/'archive'
        with closing(sqlite3.connect(self.source)) as db, db:
            for table,key in [('windows','window'),('forecasts','origin'),('reports','created')]:
                db.execute(f'CREATE TABLE {table}({key} INTEGER PRIMARY KEY,payload TEXT)')
        self.recorder=Recorder(self.source,self.output)

    def insert(self, table, key, payload):
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute(f'INSERT OR REPLACE INTO {table} VALUES(?,?)',(key,json.dumps(payload)))

    def test_ist_hours_align_to_local_hour_and_cross_utc_date(self):
        self.assertEqual(hour_start(0), -1800)
        self.assertEqual(hour_start(1799), -1800)
        self.assertEqual(hour_start(1800), 1800)
        self.assertEqual(hour_start(66600),66600)  # 00:00 next IST day.

    def test_common_targets_and_real_metric_units(self):
        s=summarize([window(0),window(5,20)],[forecast(0),forecast(5,20)],0,3600,10)
        self.assertEqual(s['common_matched_forecasts'],2)
        self.assertEqual(s['scores']['random_forest']['mae'],6)
        self.assertAlmostEqual(s['scores']['random_forest']['rmse'],(61)**.5)
        self.assertEqual(s['missing_completed_slots'],0)

    def test_invalid_late_mismatched_and_missing_model_excluded_for_all(self):
        p=forecast(15);p['predictions'].pop('baseline')
        s=summarize([window(0,valid=False),window(5),window(10),window(15)],
                    [forecast(0),forecast(5,delay=2),forecast(10,actual=11),p],0,3600,30)
        self.assertEqual(s['common_matched_forecasts'],0)
        self.assertEqual(s['excluded_forecasts'],4)
        self.assertEqual(s['scores'],{})

    def test_pending_zero_and_missing_are_distinct(self):
        s=summarize([window(0,0)],[forecast(5,actual=None,outcome='pending')],0,3600,6)
        self.assertEqual(s['valid_windows'],1)
        self.assertEqual(s['valid_update_messages'],0)
        self.assertEqual(s['pending_forecasts'],1)
        self.assertEqual(s['scores'],{})

    def test_repeated_capture_settlement_and_source_pruning_preserve_evidence(self):
        self.insert('windows',0,window(0));p=forecast(0,actual=None,outcome='pending')
        self.insert('forecasts',0,p);self.recorder.ingest()
        self.assertEqual(self.recorder.ingest(),set())
        self.insert('forecasts',0,forecast(0));self.recorder.ingest()
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute('DELETE FROM windows');db.execute('DELETE FROM forecasts')
        self.recorder.ingest();r=self.recorder.records()
        self.assertEqual(len(r['window']),1);self.assertEqual(r['forecast'][0]['actual'],10)

    def test_revision_rejected_and_original_forecast_kept(self):
        self.insert('forecasts',0,forecast(0));self.recorder.ingest()
        p=forecast(0);p['predictions']['baseline']=999;self.insert('forecasts',0,p)
        with self.assertRaises(ValueError):self.recorder.ingest()
        self.assertEqual(self.recorder.records()['forecast'][0]['predictions']['baseline'],8)

    def test_atomic_hourly_and_daily_exports_are_reproducible(self):
        self.insert('windows',0,window(0));self.insert('forecasts',0,forecast(0))
        self.recorder.ingest();self.recorder.export(now=3600)
        path=next((self.output/'hourly').glob('*/*.json'));first=path.read_bytes()
        self.recorder.export(now=3600);self.assertEqual(first,path.read_bytes())
        daily=json.loads(next((self.output/'daily').glob('*/summary.json')).read_text())
        self.assertEqual(daily['summary']['common_matched_forecasts'],1)
        self.assertGreater(daily['summary']['missing_completed_slots'],0)
        self.assertTrue(next((self.output/'daily').glob('*/report.html')).is_file())

    def test_source_database_is_not_modified(self):
        self.insert('windows',0,window(0));original=self.source.read_bytes()
        self.recorder.ingest();self.assertEqual(original,self.source.read_bytes())

    def test_duplicate_daemon_lock_is_rejected(self):
        with single_recorder(self.output):
            with self.assertRaises(RuntimeError):
                with single_recorder(self.output):pass


if __name__=='__main__':unittest.main()
