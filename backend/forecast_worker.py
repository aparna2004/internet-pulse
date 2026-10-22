"""CPU-bound sklearn work. Imported in a single separate, thread-limited process."""
import os
import pickle
import platform
import time
from backend.forecast_data import FEATURES, MIN_EXAMPLES, INTERVAL, fingerprint

_models = None
_version = None


def initialize():
    for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'NUMEXPR_NUM_THREADS'):
        os.environ[name] = '1'


def metrics(actual, predicted):
    n = len(actual)
    return dict(mae=sum(abs(a-b) for a, b in zip(actual, predicted))/n,
                rmse=(sum((a-b)**2 for a, b in zip(actual, predicted))/n)**.5)


def split(samples):
    boundary = int(len(samples) * .7)
    test = samples[boundary:]
    # Training labels end at least one window before the first holdout origin.
    train = [s for s in samples[:boundary] if s['origin'] + INTERVAL <= test[0]['origin'] - INTERVAL]
    return train, test


def train(samples):
    global _models, _version
    if len(samples) < MIN_EXAMPLES:
        raise ValueError(f'At least {MIN_EXAMPLES} eligible examples required')
    import sklearn
    import numpy as np
    from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
    from threadpoolctl import threadpool_limits
    train_rows, test = split(samples)
    x = np.asarray([s['x'] for s in train_rows], dtype=float)
    y = np.asarray([s['y'] for s in train_rows], dtype=float)
    xt = np.asarray([s['x'] for s in test], dtype=float)
    yt = [s['y'] for s in test]
    params = {
        'random_forest': dict(n_estimators=80, max_depth=8, min_samples_leaf=2, n_jobs=1, random_state=42),
        'hist_gradient_boosting': dict(max_iter=100, max_leaf_nodes=15, learning_rate=.06,
                                       min_samples_leaf=2, l2_regularization=.1, early_stopping=False, random_state=42)}
    candidates = {'random_forest': RandomForestRegressor(**params['random_forest']),
                  'hist_gradient_boosting': HistGradientBoostingRegressor(**params['hist_gradient_boosting'])}
    scores = {'baseline': dict(**metrics(yt, [s['x'][0] for s in test]), train_seconds=0,
                               inference_ms_per_row=0, model_bytes=0)}
    with threadpool_limits(limits=1):
        for key, model in candidates.items():
            start = time.perf_counter()
            model.fit(x, y)
            elapsed = time.perf_counter()-start
            start = time.perf_counter()
            predictions = np.maximum(0, model.predict(xt))
            inference = (time.perf_counter()-start)*1000/len(test)
            scores[key] = dict(**metrics(yt, predictions), train_seconds=elapsed,
                               inference_ms_per_row=inference, model_bytes=len(pickle.dumps(model)))
        # Evaluation models are discarded. Refit both on the identical full available
        # past dataset for prospective predictions; holdout scores stay untouched.
        all_x, all_y = [s['x'] for s in samples], [s['y'] for s in samples]
        for model in candidates.values():
            model.fit(all_x, all_y)
    _models = candidates
    _version = fingerprint(samples)[:16]
    best = min(scores, key=lambda k: scores[k]['mae'])
    if best == 'baseline':
        insight = 'Repeating the previous window performs at least as well as both models on holdout MAE.'
    else:
        gain = scores['baseline']['mae'] - scores[best]['mae']
        relative = f" ({gain/scores['baseline']['mae']*100:.1f}%)" if scores['baseline']['mae'] else ''
        insight = (f'{best.replace("_", " ")} has the lowest holdout MAE, '
                   f'{gain:,.1f} UPDATEs{relative} lower than the baseline.')
    return dict(created_at=int(time.time()), version=_version, dataset_sha256=fingerprint(samples),
                target='RIPE RIS Live observed UPDATE count in the next aligned five-second window', horizon_seconds=INTERVAL,
                preliminary=len(samples) < 180,
                scope='Global observed stream; dashboard filters do not apply', feature_names=FEATURES,
                samples=len(samples), train_samples=len(train_rows), test_samples=len(test),
                train_start=train_rows[0]['origin'], train_end=train_rows[-1]['origin']+INTERVAL,
                test_start=test[0]['origin'], test_end=test[-1]['origin']+INTERVAL,
                embargo_seconds=INTERVAL, split='Chronological 70/30; no shuffling or hyperparameter search',
                live_fit_samples=len(samples), live_fit_label_end=samples[-1]['origin']+INTERVAL,
                versions=dict(python=platform.python_version(), sklearn=sklearn.__version__, numpy=np.__version__),
                parameters=params, scores=scores, best_mae=best,
                insight=insight+' This is an observed-stream forecast, not an outage or attack detector.')


def predict(x, origin):
    from threadpoolctl import threadpool_limits
    if _models is None:
        raise RuntimeError('Models have not been trained')
    with threadpool_limits(limits=1):
        values = {key: max(0., float(model.predict([x])[0])) for key, model in _models.items()}
    return dict(origin=origin, target_end=origin+INTERVAL, generated_at=time.time(), version=_version,
                predictions=dict(values, baseline=x[0]), actual=None, outcome='pending')
