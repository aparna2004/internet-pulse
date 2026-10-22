"""Non-blocking orchestration: bounded window storage and one model worker."""
import asyncio
import logging
import multiprocessing
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from backend.forecast_data import HistoryStore, default_history_path, WindowSampler, MIN_EXAMPLES, INTERVAL, examples, features
from backend import forecast_worker

log = logging.getLogger('internet-pulse.forecast')


class ForecastService:
    def __init__(self, pulse, path=None):
        self.pulse = pulse
        self.store = HistoryStore(path or default_history_path())
        self.sampler = WindowSampler()
        self.rows, self.report, self.predictions = [], None, []
        self.pool = None
        self.job = None
        self.prediction_job = None
        self.samples = []
        self.ready = False
        self.error = None
        self.retry_at = 0
        self.last_attempt = None
        self.last_fit_origin = None
        self.state = {}
        self.publish()

    def publish(self):
        count = len(self.samples)
        scores = self.report['scores'] if self.report else None
        matched = [p for p in self.predictions if self.report and p['version'] == self.report['version']
                   and p['outcome'] == 'observed'][:60]
        prospective = None
        if matched:
            prospective = {key: forecast_worker.metrics([p['actual'] for p in matched],
                            [p['predictions'][key] for p in matched]) for key in scores}
        self.state = dict(status='unavailable' if self.error else 'training' if self.job and not self.job.done()
                          else 'ready' if self.ready else 'collecting', error=self.error,
                          scope='Global observed stream; dashboard filters do not apply',
                          eligible_examples=count, minimum_examples=MIN_EXAMPLES,
                          valid_windows=sum(bool(r['valid']) for r in self.rows),
                          excluded_windows=sum(not r['valid'] for r in self.rows),
                          report=self.report, forecasts=self.predictions[:6],
                          prospective=dict(samples=len(matched), scores=prospective),
                          horizon_seconds=INTERVAL, updated_at=time.time())

    async def reload(self):
        self.rows, self.report, self.predictions = await asyncio.to_thread(self.store.read)
        self.samples = await asyncio.to_thread(examples, self.rows)

    async def forecast(self, x, origin):
        try:
            p = await asyncio.get_running_loop().run_in_executor(self.executor(), forecast_worker.predict, x, origin)
            if origin <= p['generated_at'] < origin+2:
                await asyncio.to_thread(self.store.save_forecast, p)
                await self.reload()
                self.publish()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('Forecast inference failed; live ingestion continues')
            self.ready = False
            self.error = 'Model inference unavailable; retrying in five windows. See backend log.'
            self.retry_at = time.time()+300
            if self.pool:
                self.pool.shutdown(wait=False, cancel_futures=True)
                self.pool = None
            self.publish()

    def executor(self):
        if self.pool is None:
            self.pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context('spawn'),
                                            initializer=forecast_worker.initialize)
        return self.pool

    async def fit(self, samples):
        try:
            result = await asyncio.get_running_loop().run_in_executor(self.executor(), forecast_worker.train, samples)
            await asyncio.to_thread(self.store.save_report, result)
            self.report = result
            self.last_fit_origin = samples[-1]['origin']
            self.ready, self.error = True, None
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('Forecast training failed; live ingestion continues')
            self.error = 'Model training unavailable; retrying in five windows. See backend log.'
            self.retry_at = time.time()+300
            self.ready = False
            if self.pool:
                self.pool.shutdown(wait=False, cancel_futures=True)
                self.pool = None
        finally:
            self.publish()

    async def run(self):
        try:
            while True:
                try:
                    await self.reload()
                    self.error = None
                    break
                except Exception:
                    log.exception('Forecast storage could not initialize; retrying')
                    self.error = 'Forecast storage unavailable. Retrying; live routing continues.'
                    self.publish()
                    await asyncio.sleep(5)
            while True:
                try:
                    now = time.time()
                    row = self.sampler.sample(now, self.pulse.connected, self.pulse.buckets)
                    if row:
                        await asyncio.to_thread(self.store.save_window, row)
                        await self.reload()
                        if self.error and self.error.startswith('Forecast history'):
                            self.error = None
                    samples = self.samples
                    if (len(samples) >= MIN_EXAMPLES and now >= self.retry_at and
                        (self.job is None or self.job.done()) and
                        (not self.ready or samples[-1]['origin']-self.last_fit_origin >= (30 if len(samples) < 180 else 60))):
                        self.job = asyncio.create_task(self.fit(samples))
                    origin = int(now)//INTERVAL*INTERVAL
                    # Skip late forecasts: never backfill predictions after seeing the target.
                    if (self.ready and (self.job is None or self.job.done()) and
                        (self.prediction_job is None or self.prediction_job.done()) and
                        now-origin < 2 and origin != self.last_attempt):
                        self.last_attempt = origin
                        x = features(self.rows[-5:], origin)
                        if x is not None and self.report['live_fit_label_end'] <= origin:
                            self.prediction_job = asyncio.create_task(self.forecast(x, origin))
                    self.publish()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    log.exception('Forecast collection unavailable; live ingestion continues')
                    self.error = 'Forecast history temporarily unavailable. See backend log.'
                    self.publish()
                    await asyncio.sleep(5)
                await asyncio.sleep(.5)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('Forecast storage could not initialize')
            self.error = 'Forecast storage unavailable. Live routing continues.'
            self.publish()
        finally:
            if self.prediction_job:
                self.prediction_job.cancel()
                await asyncio.gather(self.prediction_job, return_exceptions=True)
            if self.job:
                self.job.cancel()
                await asyncio.gather(self.job, return_exceptions=True)
            if self.pool:
                self.pool.shutdown(wait=False, cancel_futures=True)
