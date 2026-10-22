"""Reproduce the chronological comparison from captured genuine aggregates."""
import argparse
import csv
import json
from pathlib import Path
from backend.forecast_data import HistoryStore, default_history_path, examples, MIN_EXAMPLES
from backend import forecast_worker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['evaluate', 'export'])
    parser.add_argument('--db', type=Path, default=default_history_path())
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rows, _, _ = HistoryStore(args.db).read()
    if args.action == 'export':
        if not rows:
            parser.exit(2, 'No captured history yet. Start the backend first.\n')
        with args.output.open('w', newline='', encoding='utf-8') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    else:
        samples = examples(rows)
        if len(samples) < MIN_EXAMPLES:
            parser.exit(2, f'Collecting genuine history: {len(samples)}/{MIN_EXAMPLES} eligible examples.\n')
        forecast_worker.initialize()
        result = forecast_worker.train(samples)
        args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(f'Compared both models and baseline on {result["test_samples"]} chronological holdout windows.')


if __name__ == '__main__':
    main()
