#!/usr/bin/env python3
"""Perform one authorized scratch-file mutation or bounded convergence check."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if not root.is_dir() or root == Path('/'):
        raise ValueError('Use a dedicated shared directory')
    request = json.loads(args.request.read_text())

    def confined(name):
        relative = Path(name)
        if relative.is_absolute() or not relative.parts or '..' in relative.parts:
            raise ValueError('Path must be a relative scratch-file path')
        path = (root / relative).resolve()
        if path == root or not path.is_relative_to(root):
            raise ValueError('Path escapes the shared directory')
        if path.relative_to(root).parts[0] == '.relay':
            raise ValueError('Runtime state is not a test file')
        return path

    path = confined(request['path'])
    op = request['op']
    start = time.monotonic()
    result = {'ok': True, 'op': op, 'path': request['path']}
    if op in ('write', 'atomic'):
        content = base64.b64decode(request['content'], validate=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        target = path if op == 'write' else path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
        try:
            with target.open('wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            if op == 'atomic':
                os.replace(target, path)
        finally:
            if op == 'atomic' and target.exists():
                target.unlink()
        result.update(bytes=len(content), sha256=hashlib.sha256(content).hexdigest())
    elif op == 'rename':
        destination = confined(request['destination'])
        if destination.exists():
            raise ValueError('Rename destination already exists')
        destination.parent.mkdir(parents=True, exist_ok=True)
        path.rename(destination)
        result['destination'] = request['destination']
    elif op == 'delete':
        path.unlink()
    elif op == 'expect':
        timeout = float(request.get('timeout', 15))
        if not 0 < timeout <= 120:
            raise ValueError('Timeout must be between 0 and 120 seconds')
        absent = request.get('absent', False)
        expected = request.get('sha256')
        if not absent and (not isinstance(expected, str) or len(expected) != 64):
            raise ValueError('A SHA-256 is required')
        while True:
            try:
                exists = path.exists()
                actual = hashlib.sha256(path.read_bytes()).hexdigest() if exists else None
                if (not exists) if absent else (actual == expected):
                    result['sha256'] = actual
                    break
            except (FileNotFoundError, IsADirectoryError):
                pass
            if time.monotonic() - start >= timeout:
                result.update(ok=False, error='Convergence deadline exceeded')
                break
            time.sleep(.02)
    else:
        raise ValueError('Unknown operation')
    result['elapsed_ms'] = (time.monotonic() - start) * 1000
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
