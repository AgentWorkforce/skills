"""Run one cell, retain all returned rows, and fail the process on any failed trial."""
import json
from pathlib import Path
import sys
import urllib.request

# Peer bounds arming and acknowledgement within 30 seconds per trial.
CELL_TIMEOUT = 110 * (30 + .1) + 60


def main():
    root = Path('/app/bench-private')
    config = json.loads((root / 'config.json').read_text())
    size = int(sys.argv[1])
    request = urllib.request.Request('http://127.0.0.1:9092/run',
        json.dumps({'bytes': size, 'samples': 100, 'warmups': 10}).encode(),
        {'Authorization': 'Bearer ' + config['callback_token'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=CELL_TIMEOUT) as response:
        result = json.load(response)
    (root / ('cell-' + str(size) + '.json')).write_text(json.dumps(result))
    rows = result.get('samples', [])
    ok = result.get('complete') is True and len(rows) == 110 and all(r.get('success') is True for r in rows)
    print('complete', ok, 'samples', len(rows))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
