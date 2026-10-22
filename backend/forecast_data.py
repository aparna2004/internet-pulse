"""Receipt-time window aggregates and strictly past-only forecasting features."""
import hashlib
import os
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

INTERVAL = 5
MIN_EXAMPLES = 8
RETENTION = 86400
FEATURES = [*[f"updates_lag_{i}" for i in range(1, 6)], "updates_mean_5", "updates_std_5",
            "updates_min_5", "updates_max_5", "updates_change", "withdrawal_share",
            "average_path_length", "flaps", "active_collectors", "announcements", "withdrawals"]


def default_history_path():
    directory = Path(os.environ.get('PULSE_DATA_DIR') or Path(__file__).resolve().parents[1] / 'data')
    return directory / 'forecast-5s.sqlite3'


def features(rows, origin):
    """Forecast [origin, origin+INTERVAL), using only five preceding complete windows."""
    by_time = {r['window']: r for r in rows}
    past = [by_time.get(origin - i * INTERVAL) for i in range(1, 6)]
    if any(r is None or not r['valid'] for r in past):
        return None
    values = [r['updates'] for r in past]
    mean = sum(values) / 5
    last = past[0]
    return values + [mean, (sum((v-mean)**2 for v in values)/5)**.5, min(values), max(values),
                     values[0]-values[1], last['withdrawals']/max(1, last['announcements']+last['withdrawals']),
                     last['path_sum']/max(1, last['path_count']), last['flaps'], last['collectors'],
                     last['announcements'], last['withdrawals']]


def examples(rows):
    # Bounded at six hours for predictable training cost.
    rows = sorted(rows, key=lambda r: r['window'])[-4326:]
    output = []
    for i, row in enumerate(rows):
        if row['valid']:
            x = features(rows[max(0, i-5):i], row['window'])
            if x is not None:
                output.append(dict(origin=row['window'], x=x, y=row['updates']))
    return output


def fingerprint(samples):
    return hashlib.sha256(json.dumps(samples, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class WindowSampler:
    """Copies completed scalar buckets; never called on the per-event ingest path.

    Both ends of each one-second interval must observe an upstream connection.
    Unrecoverable gaps invalidate windows; sample_many can recover bounded scheduler lag.
    """
    def __init__(self):
        self.previous_second = None
        self.previous_connected = False
        self.window = None
        self.seconds = 0
        self.row = None
        self.collectors = set()

    def sample_many(self, now, connected, buckets, connection_epoch=0):
        """Recover <=10 s scheduler lag from real buckets, never an upstream outage.

        The ingest loop advances connection_epoch on every disconnect, including
        one that happens entirely between sampler polls. First/reconnected partial
        seconds are excluded. Missing buckets are quiet zeros only while the same
        upstream connection has stayed open throughout the recovered interval.
        """
        second = int(now)
        previous_epoch = getattr(self, '_observed_epoch', None)
        previous_connection = getattr(self, '_observed_connected', False)
        changed = previous_epoch is not None and previous_epoch != connection_epoch
        if changed or (connected and not previous_connection):
            self._unsafe_before = second + 1
        previous = self.previous_second
        recover = (previous is not None and 1 < second-previous <= 10 and
                   connected and previous_connection and not changed)
        if changed:
            self.previous_connected = False
        steps = range(previous+1, second+1) if recover else [second]
        rows = []
        for step in steps:
            if step-1 < getattr(self, '_unsafe_before', 0):
                self.previous_connected = False
            row = self.sample(now if step == second else step, connected, buckets)
            if row is not None:
                rows.append(row)
        self._observed_epoch = connection_epoch
        self._observed_connected = connected
        return rows

    def sample(self, now, connected, buckets):
        second = int(now)
        if self.previous_second == second:
            # Latch any observed outage, including one shorter than a second.
            self.previous_connected = self.previous_connected and connected
            return None
        completed = second - 1
        window = completed // INTERVAL * INTERVAL
        continuous = self.previous_second == completed and self.previous_connected and connected
        self.previous_second, self.previous_connected = second, connected
        if self.window != window:
            self.window = window
            self.seconds = 0
            self.collectors = set()
            self.row = dict(window=window, updates=0, announcements=0, withdrawals=0,
                            path_sum=0, path_count=0, flaps=0, collectors=0, valid=True, reason='')
        self.seconds += 1
        if not continuous:
            self.row['valid'] = False
            self.row['reason'] = 'Startup, upstream disconnect, clock change or sampler gap'
        bucket = next((b for b in reversed(buckets) if b['second'] == completed), None)
        if bucket:
            for key in ('updates', 'announcements', 'withdrawals', 'path_sum', 'path_count', 'flaps'):
                self.row[key] += bucket[key]
            self.collectors.update(bucket['collectors'])
        if completed % INTERVAL != INTERVAL-1:
            return None
        self.row['valid'] = self.row['valid'] and self.seconds == INTERVAL
        if not self.row['valid'] and not self.row['reason']:
            self.row['reason'] = 'Incomplete window'
        self.row['collectors'] = len(self.collectors)
        return dict(self.row)


class HistoryStore:
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('CREATE TABLE IF NOT EXISTS windows (window INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS reports (created INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS forecasts (origin INTEGER PRIMARY KEY, version TEXT NOT NULL, payload TEXT NOT NULL)')
            with connection:
                yield connection
        finally:
            connection.close()

    def read(self):
        with self.connect() as db:
            rows = [json.loads(r[0]) for r in db.execute('SELECT payload FROM windows ORDER BY window DESC LIMIT 4326')][::-1]
            report = db.execute('SELECT payload FROM reports ORDER BY created DESC LIMIT 1').fetchone()
            predictions = [json.loads(r[0]) for r in db.execute('SELECT payload FROM forecasts ORDER BY origin DESC LIMIT 120')]
        return rows, json.loads(report[0]) if report else None, predictions

    def save_window(self, row):
        with self.connect() as db:
            # Never silently replace previously captured history after a clock rollback.
            db.execute('INSERT OR IGNORE INTO windows VALUES (?, ?)', (row['window'], json.dumps(row)))
            row = json.loads(db.execute('SELECT payload FROM windows WHERE window=?', (row['window'],)).fetchone()[0])
            pending = db.execute('SELECT origin, payload FROM forecasts WHERE origin=?', (row['window'],)).fetchone()
            if pending:
                prediction = json.loads(pending[1])
                prediction.update(actual=row['updates'] if row['valid'] else None,
                                  outcome='observed' if row['valid'] else 'excluded: incomplete target window')
                db.execute('UPDATE forecasts SET payload=? WHERE origin=?', (json.dumps(prediction), row['window']))
            # A restart or a long sampler gap may mean a target window was never captured.
            for origin, payload in db.execute('SELECT origin, payload FROM forecasts WHERE origin < ?', (row['window'],)).fetchall():
                prediction = json.loads(payload)
                if prediction['outcome'] == 'pending':
                    prediction['outcome'] = 'excluded: missing target capture'
                    db.execute('UPDATE forecasts SET payload=? WHERE origin=?', (json.dumps(prediction), origin))
            cutoff = row['window'] - RETENTION
            db.execute('DELETE FROM windows WHERE window < ?', (cutoff,))
            db.execute('DELETE FROM forecasts WHERE origin < ?', (cutoff,))

    def save_forecast(self, prediction):
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO forecasts VALUES (?, ?, ?)',
                       (prediction['origin'], prediction['version'], json.dumps(prediction)))

    def save_report(self, report):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO reports VALUES (?, ?)', (report['created_at'], json.dumps(report)))
            db.execute('DELETE FROM reports WHERE created NOT IN (SELECT created FROM reports ORDER BY created DESC LIMIT 20)')
