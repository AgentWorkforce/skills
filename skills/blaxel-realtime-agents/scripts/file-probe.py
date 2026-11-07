#!/usr/bin/env python3
"""Perform one authorized scratch-file mutation or bounded convergence check."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import stat
import time
import uuid

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class ScratchRoot:
    """Pin the selected POSIX root and never traverse a symlink beneath it."""

    def __init__(self, path):
        """Open the explicitly selected directory, rejecting a symlink root."""
        if Path(path).absolute() == Path('/'):
            raise ValueError('Use a dedicated shared directory')
        self.fd = os.open(path, DIRECTORY_FLAGS)

    def close(self):
        """Release the root handle."""
        os.close(self.fd)

    @staticmethod
    def parts(name):
        """Validate lexical components before opening any child directory."""
        if not isinstance(name, str) or not name:
            raise ValueError('Path must be a relative scratch-file path')
        path = Path(name)
        if path.is_absolute() or not path.parts or '..' in path.parts:
            raise ValueError('Path must be a relative scratch-file path')
        if '.relay' in path.parts:
            raise ValueError('Runtime state is not a test file')
        return path.parts

    @contextmanager
    def parent(self, name, create=False):
        """Walk using pinned directory handles and O_NOFOLLOW at every step."""
        parts = self.parts(name)
        fd = os.dup(self.fd)
        try:
            for part in parts[:-1]:
                if create:
                    try:
                        os.mkdir(part, dir_fd=fd)
                    except FileExistsError:
                        pass
                child = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
                os.close(fd)
                fd = child
            yield fd, parts[-1]
        finally:
            os.close(fd)

    @staticmethod
    def regular(fd, name, missing_ok=False):
        """Reject observed symlink and special-file entries without following them."""
        try:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            if missing_ok:
                return None
            raise
        if stat.S_ISDIR(info.st_mode):
            raise IsADirectoryError(name)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('Scratch paths must be regular files, not symlinks')
        return info

    def write(self, name, content, atomic=False):
        """Write through a pinned parent; an atomic save replaces only the entry."""
        with self.parent(name, create=True) as (parent, leaf):
            self.regular(parent, leaf, missing_ok=True)
            target = f'.{leaf}.{uuid.uuid4().hex}.tmp' if atomic else leaf
            flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
            if atomic:
                flags |= os.O_EXCL
            fd = os.open(target, flags, 0o600, dir_fd=parent)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ValueError('Writes require a single-link regular scratch file')
                with os.fdopen(fd, 'wb', closefd=False) as stream:
                    os.ftruncate(fd, 0)
                    stream.write(content)
                    stream.flush()
                    os.fsync(fd)
                if atomic:
                    os.replace(target, leaf, src_dir_fd=parent, dst_dir_fd=parent)
            finally:
                os.close(fd)
                if atomic:
                    try:
                        os.unlink(target, dir_fd=parent)
                    except FileNotFoundError:
                        pass

    def rename(self, source, destination):
        """Rename the requested entry between pinned, non-symlink parents."""
        with self.parent(source) as (src_fd, src):
            self.regular(src_fd, src)
            with self.parent(destination, create=True) as (dst_fd, dst):
                try:
                    os.stat(dst, dir_fd=dst_fd, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise ValueError('Rename destination already exists')
                os.rename(src, dst, src_dir_fd=src_fd, dst_dir_fd=dst_fd)

    def delete(self, name):
        """Unlink only the named directory entry, never a symlink target."""
        with self.parent(name) as (parent, leaf):
            self.regular(parent, leaf)
            os.unlink(leaf, dir_fd=parent)

    def digest(self, name, absent=False):
        """Hash a no-follow file handle or verify that the entry is absent."""
        with self.parent(name) as (parent, leaf):
            self.regular(parent, leaf)
            if absent:
                return False, None
            fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            with os.fdopen(fd, 'rb') as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise IsADirectoryError(name)
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(65536), b''):
                    digest.update(chunk)
                return True, digest.hexdigest()


def execute(root, request):
    """Execute a scratch request and preserve a bounded convergence deadline."""
    name, op = request['path'], request['op']
    root.parts(name)
    started = time.monotonic()
    result = {'ok': True, 'op': op, 'path': name}
    if op in ('write', 'atomic'):
        content = base64.b64decode(request['content'], validate=True)
        root.write(name, content, atomic=op == 'atomic')
        result.update(bytes=len(content), sha256=hashlib.sha256(content).hexdigest())
    elif op == 'rename':
        root.rename(name, request['destination'])
        result['destination'] = request['destination']
    elif op == 'delete':
        root.delete(name)
    elif op == 'expect':
        timeout = float(request.get('timeout', 15))
        if not 0 < timeout <= 120:
            raise ValueError('Timeout must be between 0 and 120 seconds')
        absent, expected = request.get('absent', False), request.get('sha256')
        if not absent and (not isinstance(expected, str) or len(expected) != 64):
            raise ValueError('A SHA-256 is required')
        while True:
            try:
                try:
                    exists, actual = root.digest(name, absent=absent)
                except FileNotFoundError:
                    exists, actual = False, None
                matches = not exists if absent else actual == expected
                if matches:
                    result['sha256'] = actual
                    break
            except (PermissionError, IsADirectoryError):
                pass
            if time.monotonic() - started >= timeout:
                result.update(ok=False, error='Convergence deadline exceeded')
                break
            time.sleep(.02)
    else:
        raise ValueError('Unknown operation')
    result['elapsed_ms'] = (time.monotonic() - started) * 1000
    return result


def main():
    """Load a request and execute it against an explicitly selected scratch root."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    root = ScratchRoot(args.root)
    try:
        result = execute(root, request)
    finally:
        root.close()
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
