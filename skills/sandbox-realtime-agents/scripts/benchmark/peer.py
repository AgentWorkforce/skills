"""Controlled scratch-files benchmark. Never bind against a customer mount."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import threading
import time
import urllib.request
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(os.environ.get('RELAY_BENCH_ROOT', '/app/bench-private'))
CONFIG = {}
SHARED = Path('/app/shared/benchmark')
PENDING = {}
LOCK = threading.Lock()
RUN_LOCK = threading.Lock()
TRIAL_TIMEOUT = 30
INTER_TRIAL_SLEEP = .1


def validate_origin(url):
    """Accept only explicit HTTPS peer origins, without credentials or paths."""
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('An explicit HTTPS peer origin is required')
    return url.rstrip('/')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep bearer credentials on the configured origin, including redirects."""
    def redirect_request(self, *_args, **_kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def post(url, body, timeout=30):
    origin = validate_origin(CONFIG['peer_url'])
    if url not in (origin + '/arm', origin + '/ack'):
        raise ValueError('Callback destination must match the peer origin')
    request = urllib.request.Request(url, json.dumps(body).encode(), {
        'Authorization': 'Bearer ' + CONFIG['callback_token'],
        'Content-Type': 'application/json',
    })
    with OPENER.open(request, timeout=timeout) as response:
        return json.load(response)


def observe(body):
    path = SHARED / body['file']
    deadline = time.monotonic() + 30
    previous = None
    while time.monotonic() < deadline:
        try:
            stat = path.stat()
            identity = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
            if identity != previous:
                previous = identity
                if stat.st_size == body['size']:
                    digest = hashlib.sha256(path.read_bytes()).hexdigest()
                    if hmac.compare_digest(digest, body['sha256']):
                        post(CONFIG['peer_url'] + '/ack', {
                            'round': body['round'], 'sha256': digest,
                        })
                        return
        except (FileNotFoundError, PermissionError):
            pass
        time.sleep(0.001)


def run_cell(body):
    """Record failures, release pending state, and never call a failed cell complete."""
    size = body['bytes']
    samples = []
    invocation = uuid.uuid4().hex
    for index in range(body['warmups'] + body['samples']):
        round_id = f"{CONFIG['run']}:{CONFIG['role']}:{size}:{invocation}:{index}"
        content = ((round_id + '\n').encode() + bytes(range(256)) * ((size // 256) + 1))[:size]
        digest = hashlib.sha256(content).hexdigest()
        filename = CONFIG['role'] + '-' + str(size) + '.bin'
        pending = {'event': threading.Event(), 'sha256': digest}
        with LOCK:
            PENDING[round_id] = pending
        sample = {'round': round_id, 'direction': CONFIG['role'] + '->' + CONFIG['peer_role'],
                  'bytes': size, 'index': index, 'warmup': index < body['warmups'],
                  'success': False, 'sha256': digest,
                  'write_to_ack_ms': None, 'local_write_ms': None}
        started = written = None
        try:
            # Arm and ACK share one bounded trial budget; arming remains outside the metric.
            deadline = time.monotonic() + TRIAL_TIMEOUT
            post(CONFIG['peer_url'] + '/arm', {
                'round': round_id, 'file': filename, 'sha256': digest, 'size': size,
            }, timeout=TRIAL_TIMEOUT)
            started = time.monotonic_ns()
            with (SHARED / filename).open('wb') as stream:
                stream.write(content)
            written = time.monotonic_ns()
            acknowledged = pending['event'].wait(max(0, deadline - time.monotonic()))
            sample['success'] = acknowledged and isinstance(pending.get('ack_ns'), int)
        except Exception as error:
            # A failed setup/write is evidence too; exception text may contain private data.
            sample['error'] = type(error).__name__
        finally:
            if sample['success'] and started is not None and 'ack_ns' in pending:
                sample['write_to_ack_ms'] = (pending['ack_ns'] - started) / 1e6
            if written is not None:
                sample['local_write_ms'] = (written - started) / 1e6
            with LOCK:
                PENDING.pop(round_id, None)
        samples.append(sample)
        with (ROOT / 'samples.jsonl').open('a') as stream:
            stream.write(json.dumps(sample) + '\n')
        if not sample['success']:
            break
        time.sleep(INTER_TRIAL_SLEEP)
    complete = len(samples) == body['warmups'] + body['samples'] and all(r['success'] for r in samples)
    return {'samples': samples, 'complete': complete}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization', '').encode('utf-8'),
                                   ('Bearer ' + CONFIG['callback_token']).encode('utf-8')):
            self.send_error(401)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError('body size')
            body = json.loads(self.rfile.read(length))
            if self.path == '/arm':
                if body['file'] not in {f'{r}-{s}.bin' for r in ('a', 'b') for s in (1024, 65536, 1048576)}:
                    raise ValueError('scratch file')
                threading.Thread(target=observe, args=(body,), daemon=True).start()
                result = {'armed': True}
            elif self.path == '/ack':
                with LOCK:
                    pending = PENDING.get(body['round'])
                    if pending and hmac.compare_digest(body['sha256'], pending['sha256']):
                        pending['ack_ns'] = time.monotonic_ns()
                        pending['event'].set()
                result = {'received': True}
            elif self.path == '/run':
                if body['bytes'] not in (1024, 65536, 1048576) or body['samples'] != 100 or body['warmups'] != 10:
                    raise ValueError('fixed benchmark parameters')
                if not RUN_LOCK.acquire(blocking=False):
                    self.send_error(409, 'A benchmark cell is already running')
                    return
                try:
                    result = run_cell(body)
                finally:
                    RUN_LOCK.release()
            else:
                self.send_error(404)
                return
            encoded = json.dumps(result).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        except Exception as error:
            # No exception text: an upstream error can contain private URLs.
            self.send_error(500, type(error).__name__)


def main():
    global CONFIG
    CONFIG = json.loads((ROOT / 'config.json').read_text())
    CONFIG['peer_url'] = validate_origin(CONFIG['peer_url'])
    SHARED.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(('0.0.0.0', 9092), Handler).serve_forever()


if __name__ == '__main__':
    main()
