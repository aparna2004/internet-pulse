"""Independent research recorder: python -m backend.research_archive run.

Reads the live WAL database without changing it. Preserves real observations and
issued forecasts, publishes IST hourly evidence and comparable prospective errors.
"""
import argparse
import asyncio
from contextlib import contextmanager
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import html
import io
import json
import logging
import math
import os
from pathlib import Path
import sqlite3
import time

LOG = logging.getLogger('internet-pulse.research')
IST = timezone(timedelta(hours=5, minutes=30), 'IST')
MODELS = ('baseline', 'random_forest', 'hist_gradient_boosting')
SCHEMA = 1


def iso(ts, tz=timezone.utc):
    return datetime.fromtimestamp(ts, tz).isoformat()


def hour_start(ts):
    return int((ts + 19800) // 3600) * 3600 - 19800


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    with tmp.open('w', encoding='utf-8', newline='') as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


@contextmanager
def single_recorder(directory):
    directory.mkdir(parents=True, exist_ok=True)
    handle = (directory / 'recorder.lock').open('a+b')
    if os.fstat(handle.fileno()).st_size == 0:
        handle.write(b'0')
        handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise RuntimeError('Another recorder is already using this output directory')
    try:
        yield
    finally:
        handle.close()  # OS releases the lock even after a crash.


class Recorder:
    def __init__(self, source, output):
        self.source, self.output = Path(source).resolve(), Path(output).resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.dbpath = self.output / 'research.sqlite3'
        if self.dbpath == self.source:
            raise ValueError('Archive database must differ from the live database')
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS records(kind TEXT, key INTEGER, payload TEXT NOT NULL, PRIMARY KEY(kind,key))')
            db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            previous = db.execute("SELECT value FROM meta WHERE key='source'").fetchone()
            if previous and previous[0] != str(self.source):
                raise ValueError('Use a separate archive directory for a different source database')
            db.execute("INSERT OR IGNORE INTO meta VALUES('source',?)", (str(self.source),))
            db.execute("INSERT OR IGNORE INTO meta VALUES('started_utc',?)", (iso(time.time()),))
        sources = Path(__file__).parent
        provenance = {'schema_version': SCHEMA, 'source_database': str(self.source),
                      'created_utc': iso(time.time()), 'timezone': 'IST UTC+05:30',
                      'python_version': __import__('platform').python_version(),
                      'source_hashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                        for p in sources.glob('*.py')},
                      'scope': 'Global observed RIS Live stream; no dashboard filters',
                      'note': 'No retroactive predictions. No synthetic or interpolated observations.'}
        if not (self.output / 'provenance.json').exists():
            atomic(self.output / 'provenance.json', json.dumps(provenance, indent=2))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.dbpath, timeout=5)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            with db:
                yield db
        finally:
            db.close()

    def ingest(self):
        # No mode=rwc, PRAGMA, schema creation, or writes on the source.
        source = sqlite3.connect(self.source.as_uri() + '?mode=ro', uri=True, timeout=3)
        try:
            source.execute('BEGIN')
            batch = {kind: source.execute(f'SELECT {key},payload FROM {table} ORDER BY {key}').fetchall()
                     for kind, table, key in [('window', 'windows', 'window'),
                                             ('forecast', 'forecasts', 'origin'),
                                             ('report', 'reports', 'created')]}
        finally:
            source.close()
        changed = set()
        with self.connect() as db:
            for kind, records in batch.items():
                for key, payload in records:
                    obj = json.loads(payload)
                    # Preserve the original byte-independent numeric content.
                    clean = canonical(obj)
                    old = db.execute('SELECT payload FROM records WHERE kind=? AND key=?', (kind, key)).fetchone()
                    if old and old[0] == clean:
                        continue
                    if old:
                        prior = json.loads(old[0])
                        # A pending forecast can settle; issued values must never be revised.
                        if kind != 'forecast' or any(prior.get(k) != obj.get(k) for k in
                                                    ('origin', 'target_end', 'generated_at', 'version', 'predictions')):
                            raise ValueError(f'Conflicting archived {kind} at {key}; original evidence preserved')
                        if prior.get('outcome') != 'pending':
                            raise ValueError(f'Attempted revision of settled forecast at {key}')
                    db.execute('INSERT OR REPLACE INTO records VALUES(?,?,?)', (kind, key, clean))
                    changed.add(hour_start(key))
            db.execute("INSERT OR REPLACE INTO meta VALUES('last_capture_utc',?)", (iso(time.time()),))
        return changed

    async def capture_dashboard(self, url):
        import websockets
        async with websockets.connect(url, open_timeout=4, close_timeout=1, max_size=4_000_000) as ws:
            snapshot = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        timestamp = snapshot['timestamp']
        key = int(timestamp * 1000)
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?)', ('snapshot', key, canonical(snapshot)))
        return hour_start(timestamp)

    def records(self, days=None):
        with self.connect() as db:
            if days is None:
                rows = db.execute('SELECT kind,payload FROM records ORDER BY key').fetchall()
            else:
                rows = []
                for day in sorted(days):
                    start = int(datetime.fromisoformat(day).replace(tzinfo=IST).timestamp())
                    rows.extend(db.execute('SELECT kind,payload FROM records WHERE '
                        "(kind!='snapshot' AND key>=? AND key<?) OR "
                        "(kind='snapshot' AND key>=? AND key<?) ORDER BY key",
                        (start, start+86400, start*1000, (start+86400)*1000)).fetchall())
        result = {kind: [] for kind in ('window', 'forecast', 'report', 'snapshot')}
        for kind, payload in rows:
            result[kind].append(json.loads(payload))
        return result

    def export(self, now=None, changed_hours=None):
        now = time.time() if now is None else now
        days = None if changed_hours is None else {datetime.fromtimestamp(t, IST).strftime('%Y-%m-%d')
                                                  for t in set(changed_hours) | {hour_start(now)}}
        records = self.records(days)
        with self.connect() as db:
            reports = {r['version']: r for (payload,) in db.execute("SELECT payload FROM records WHERE kind='report'")
                       for r in [json.loads(payload)]}
        groups = {}
        for kind, objects in records.items():
            for obj in objects:
                stamp = obj[{'window': 'window', 'forecast': 'origin', 'report': 'created_at', 'snapshot': 'timestamp'}[kind]]
                h = hour_start(stamp)
                groups.setdefault(h, {k: [] for k in records})[kind].append(obj)
        daily = {}
        for start, objects in sorted(groups.items()):
            date = datetime.fromtimestamp(start, IST).strftime('%Y-%m-%d')
            label = datetime.fromtimestamp(start, IST).strftime('%H-00_IST')
            summary = summarize(objects['window'], objects['forecast'], start, start + 3600, now)
            hourly = {'schema_version': SCHEMA, 'hour_start_utc': iso(start), 'hour_start_ist': iso(start, IST),
                      'hour_end_utc': iso(start + 3600), 'is_current_partial_hour': now < start + 3600,
                      'summary': summary, **objects,
                      'referenced_reports': {v: reports.get(v) for v in summary['model_versions']},
                      'snapshot_note': 'Sampled five-minute dashboard views, not exhaustive hourly topology or anomaly counts.'}
            # A content hash allows settled outcomes/late captures to refresh an hour safely.
            content = canonical(hourly)
            digest = hashlib.sha256(content.encode()).hexdigest()
            destination = self.output / 'hourly' / date / (label + '.json')
            with self.connect() as db:
                old = db.execute('SELECT value FROM meta WHERE key=?', ('export:' + str(start),)).fetchone()
                if not old or old[0] != digest:
                    atomic(destination, json.dumps(dict(hourly, content_sha256=digest), indent=2))
                    db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('export:' + str(start), digest))
            daily.setdefault(date, []).append((start, objects, summary))
        for date, hours in daily.items():
            self.export_day(date, hours, now)
        return {'hours': len(groups), 'days': len(daily),
                'records': {k: len(v) for k, v in records.items()}}

    def export_day(self, date, hours, now):
        start = datetime.fromisoformat(date).replace(tzinfo=IST).timestamp()
        windows = [r for _, obj, _ in hours for r in obj['window']]
        forecasts = [r for _, obj, _ in hours for r in obj['forecast']]
        summary = summarize(windows, forecasts, start, start + 86400, now)
        # Show completed empty hours explicitly; unavailable scores stay blank.
        present = {t for t, _, _ in hours}
        hours = list(hours)
        for t in range(int(start), int(min(start+86400, now))+1, 3600):
            if t >= start+86400:
                break
            if t not in present:
                hours.append((t, {}, summarize([], [], t, t+3600, now)))
        hours.sort(key=lambda h: h[0])
        report = {'date_ist': date, 'period_start_utc': iso(start), 'period_end_utc': iso(start + 86400),
                  'summary': summary, 'hours': [dict(hour_ist=iso(t, IST), **s) for t, _, s in hours],
                  'interpretation': 'Prospective errors on identical matched targets for all three methods. '
                  'Model versions can change during the day. Rolling holdout reports are preserved separately; '
                  'their overlapping test windows are not pooled. Missing intervals are never zero-filled.'}
        root = self.output / 'daily' / date
        atomic(root / 'summary.json', json.dumps(report, indent=2))
        fields = ['hour_ist', 'partial_hour', 'captured_windows', 'valid_windows', 'missing_completed_slots',
                  'issued_forecasts', 'common_matched_forecasts', 'model', 'mae', 'rmse']
        buff = io.StringIO(newline='');writer = csv.DictWriter(buff, fieldnames=fields);writer.writeheader()
        table = []
        for ts, _, values in hours:
            for model in MODELS:
                metrics = values['scores'].get(model, {})
                row = dict(hour_ist=iso(ts, IST), partial_hour=now < ts + 3600,
                           **{k: values[k] for k in fields if k in values}, model=model,
                           mae=metrics.get('mae'), rmse=metrics.get('rmse'))
                writer.writerow(row)
                table.append(row)
        atomic(root / 'hourly-comparison.csv', buff.getvalue())
        numbers = lambda v: 'Unavailable' if v is None else f'{v:,.2f}'
        body = ''.join('<tr>' + ''.join('<td>' + html.escape(str(row[k]) if k not in ('mae', 'rmse') else numbers(row[k])) + '</td>'
                                      for k in ['hour_ist', 'common_matched_forecasts', 'model', 'mae', 'rmse']) + '</tr>' for row in table)
        totals = ''.join(f'<li>{m}: MAE {numbers(summary["scores"].get(m, {}).get("mae"))}; RMSE '
                         f'{numbers(summary["scores"].get(m, {}).get("rmse"))}</li>' for m in MODELS)
        page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Internet Pulse daily research {date}</title><style>body{{max-width:1100px;margin:35px auto;padding:0 22px;font:15px/1.6 system-ui;color:#183044}}table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}code{{background:#f0f4f6}}@media print{{body{{font-size:11px}}}}</style>
<h1>Daily research comparison · {date} IST</h1><p>{html.escape(report['interpretation'])}</p>
<p>Captured windows: {summary['captured_windows']}; valid: {summary['valid_windows']}; invalid: {summary['invalid_windows']};
missing completed five-second slots: {summary['missing_completed_slots']}. Issued forecasts: {summary['issued_forecasts']};
common matched targets: {summary['common_matched_forecasts']}; pending: {summary['pending_forecasts']}; excluded: {summary['excluded_forecasts']}.</p>
<h2>Day totals</h2><ul>{totals}</ul><h2>Hourly comparison</h2><p><a href="hourly-comparison.csv">Download CSV</a> · <a href="summary.json">Full report and quality details</a></p>
<table><thead><tr><th>Hour IST</th><th>Matched targets</th><th>Method</th><th>MAE</th><th>RMSE</th></tr></thead><tbody>{body}</tbody></table>
<p>Current hours and days are partial. No completed slots before the collection began have been invented. Missing hours are reported as gaps.
Figures describe received routing observations, not Internet-wide traffic or incident labels. Keep this recorder, the backend, the computer and Internet connection running.</p></html>'''
        atomic(root / 'report.html', page)


def summarize(windows, forecasts, start, end, now):
    valid = {r['window']: r for r in windows if r['valid']}
    completed_end = min(end, int(now) // 5 * 5)
    expected = max(0, int((completed_end - start) // 5))
    complete_captured = {r['window'] for r in windows if start <= r['window'] < completed_end}
    eligible, pending, excluded = [], 0, 0
    reasons = {}
    for p in forecasts:
        reason = None
        if p.get('outcome') == 'pending' and p['origin'] + 5 > now:
            pending += 1
            continue
        if not (p['origin'] <= p.get('generated_at', -1) < p['origin'] + 2):
            reason = 'not_issued_within_original_two_second_deadline'
        elif p.get('target_end') != p['origin'] + 5:
            reason = 'unexpected_target_interval'
        elif p.get('outcome') != 'observed' or p.get('actual') is None:
            reason = 'unmatched_or_excluded_target'
        elif p['origin'] not in valid or p['actual'] != valid[p['origin']]['updates']:
            reason = 'target_missing_invalid_or_disagrees_with_captured_window'
        elif any(not isinstance(p.get('predictions', {}).get(m), (int, float)) or
                 not math.isfinite(p['predictions'][m]) for m in MODELS):
            reason = 'missing_or_nonfinite_model_prediction'
        if reason:
            excluded += 1
            reasons[reason] = reasons.get(reason, 0) + 1
        else:
            eligible.append(p)
    scores = {}
    if eligible:
        for model in MODELS:
            errors = [p['actual'] - p['predictions'][model] for p in eligible]
            scores[model] = {'mae': sum(abs(e) for e in errors) / len(errors),
                             'rmse': math.sqrt(sum(e * e for e in errors) / len(errors))}
    return {'captured_windows': len(windows), 'valid_windows': len(valid),
            'invalid_windows': len(windows) - len(valid), 'completed_expected_slots': expected,
            'missing_completed_slots': max(0, expected - len(complete_captured)),
            'issued_forecasts': len(forecasts), 'common_matched_forecasts': len(eligible),
            'pending_forecasts': pending, 'excluded_forecasts': excluded, 'exclusion_reasons': reasons,
            'scores': scores, 'model_versions': sorted({p['version'] for p in forecasts}),
            'valid_update_messages': sum(r['updates'] for r in valid.values()),
            'announced_prefix_operations': sum(r['announcements'] for r in valid.values()),
            'withdrawn_prefix_operations': sum(r['withdrawals'] for r in valid.values())}


def main():
    from backend.forecast_data import default_history_path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'once', 'report'])
    parser.add_argument('--source', type=Path, default=default_history_path())
    parser.add_argument('--output', type=Path, default=default_history_path().parent / 'research-archive')
    parser.add_argument('--interval', type=int, default=30)
    parser.add_argument('--dashboard-url', default='ws://127.0.0.1:8000/ws?window=300')
    parser.add_argument('--no-dashboard', action='store_true')
    args = parser.parse_args()
    if args.interval < 10:
        parser.error('--interval must be at least 10 seconds')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    with single_recorder(args.output):
        recorder = Recorder(args.source, args.output)
        last_snapshot = 0
        while True:
            try:
                if args.action != 'report':
                    changed = recorder.ingest()
                    if not args.no_dashboard and time.time() - last_snapshot >= 300:
                        try:
                            changed.add(asyncio.run(recorder.capture_dashboard(args.dashboard_url)))
                        except Exception:
                            LOG.exception('Dashboard sample unavailable; aggregate archiving continues')
                        last_snapshot = time.time()
                result = recorder.export(changed_hours=changed if args.action != 'report' else None)
                status = {'state': 'running' if args.action == 'run' else 'completed',
                          'pid': os.getpid(), 'last_success_utc': iso(time.time()), **result}
                atomic(args.output / 'status.json', json.dumps(status, indent=2))
                LOG.info('Archived %s', result)
            except Exception as exc:
                LOG.exception('Research capture failed; source and live pipeline unchanged')
                atomic(args.output / 'status.json', json.dumps({'state': 'error', 'pid': os.getpid(),
                       'last_error_utc': iso(time.time()), 'error': str(exc)}, indent=2))
                if args.action != 'run':
                    raise
            if args.action != 'run':
                break
            time.sleep(args.interval)


if __name__ == '__main__':
    main()
