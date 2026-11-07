"""Controlled scratch-files benchmark. Never bind against a customer mount."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path('/app/bench-private')
CONFIG = json.loads((ROOT / 'config.json').read_text())
SHARED = Path('/app/shared/benchmark')
SHARED.mkdir(parents=True, exist_ok=True)
PENDING = {}
LOCK = threading.Lock()


def post(url, body, timeout=35):
    request = urllib.request.Request(url, json.dumps(body).encode(), {
        'Authorization': 'Bearer ' + CONFIG['callback_token'],
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
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
    size = body['bytes']
    samples = []
    for index in range(body['warmups'] + body['samples']):
        round_id = f"{CONFIG['run']}:{CONFIG['role']}:{size}:{index}"
        header = (round_id + '\n').encode()
        content = (header + bytes(range(256)) * ((size // 256) + 1))[:size]
        digest = hashlib.sha256(content).hexdigest()
        filename = CONFIG['role'] + '-' + str(size) + '.bin'
        pending = {'event': threading.Event(), 'sha256': digest}
        with LOCK:
            PENDING[round_id] = pending
        post(CONFIG['peer_url'] + '/arm', {
            'round': round_id, 'file': filename, 'sha256': digest, 'size': size,
        })
        started = time.monotonic_ns()
        with (SHARED / filename).open('wb') as stream:
            stream.write(content)
        written = time.monotonic_ns()
        ok = pending['event'].wait(30)
        ended = pending.get('ack_ns', time.monotonic_ns())
        sample = {
            'round': round_id, 'direction': CONFIG['role'] + '->' + CONFIG['peer_role'],
            'bytes': size, 'index': index, 'warmup': index < body['warmups'],
            'success': ok, 'sha256': digest,
            'write_to_ack_ms': (ended - started) / 1e6,
            'local_write_ms': (written - started) / 1e6,
        }
        samples.append(sample)
        with (ROOT / 'samples.jsonl').open('a') as stream:
            stream.write(json.dumps(sample) + '\n')
        with LOCK:
            PENDING.pop(round_id, None)
        if not ok:
            break  # Fail closed: no endless writes into a broken mirror.
        time.sleep(0.1)
    return {'samples': samples, 'complete': len(samples) == body['warmups'] + body['samples']}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''),
                                   'Bearer ' + CONFIG['callback_token']):
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
                result = run_cell(body)
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


ThreadingHTTPServer(('0.0.0.0', 9092), Handler).serve_forever()
