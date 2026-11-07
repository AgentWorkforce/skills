"""Recompute nearest-rank percentiles from the retained benchmark samples."""
import argparse
import json
import math
from pathlib import Path


def summarize(samples):
    """Keep warmups and failures visible; calculate latency on successful trials."""
    groups = {}
    rounds = set()
    for sample in samples:
        if sample['round'] in rounds:
            raise ValueError('Duplicate round in raw samples')
        rounds.add(sample['round'])
        groups.setdefault((sample['direction'], sample['bytes']), []).append(sample)
    output = []
    for (direction, size), rows in sorted(groups.items()):
        measured = [r for r in rows if not r['warmup']]
        values = sorted(r['write_to_ack_ms'] for r in measured if r['success'])
        percentile = lambda p: values[math.ceil(len(values) * p) - 1] if values else None
        output.append({
            'direction': direction, 'bytes': size,
            'warmups': sum(r['warmup'] for r in rows),
            'warmup_failures': sum(r['warmup'] and not r['success'] for r in rows),
            'measured': len(measured), 'failures': sum(not r['success'] for r in measured),
            'p50_ms': percentile(.50), 'p95_ms': percentile(.95), 'p99_ms': percentile(.99),
            'min_ms': min(values) if values else None,
            'max_ms': max(values) if values else None,
        })
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('samples', type=Path, help='Explicit raw samples.jsonl path')
    source = parser.parse_args().samples
    rows = [json.loads(line) for line in source.read_text().splitlines() if line]
    print(json.dumps({
        'per_direction': summarize(rows),
        'pooled_directions': summarize([{**r, 'direction': 'both'} for r in rows]),
    }, indent=2))
