"""Regression tests for scratch-file behavior and concurrent symlink replacement."""
import base64
from contextlib import contextmanager
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('file_probe', Path(__file__).parents[1] / 'scripts/file-probe.py')
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)
PAYLOAD = bytes(range(256))
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()


class FileProbeTests(unittest.TestCase):
    """Verify exact entries, no-follow traversal, and convergence deadlines."""

    def setUp(self):
        """Create a selected root beside a sentinel outside that root."""
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.path = self.base / 'shared'
        self.path.mkdir()
        self.outside = self.base / 'outside'
        self.outside.mkdir()
        (self.outside / 'file').write_bytes(b'outside')
        self.root = probe.ScratchRoot(self.path)

    def tearDown(self):
        """Close handles before removing temporary test data."""
        self.root.close()
        self.temp.cleanup()

    def write(self, name, op='write'):
        """Submit a binary payload through the public request executor."""
        return probe.execute(self.root, {'op': op, 'path': name, 'content': base64.b64encode(PAYLOAD).decode()})

    def test_mutations_and_hash_checks(self):
        """Exercise binary writes, atomic saves, rename, delete and absence."""
        self.assertEqual(self.write('nested/file')['sha256'], DIGEST)
        self.assertTrue(probe.execute(self.root, {'op': 'expect', 'path': 'nested/file', 'sha256': DIGEST})['ok'])
        (self.path / 'nested/file').write_bytes(b'old content before atomic save')
        self.write('nested/file', 'atomic')
        self.assertEqual((self.path / 'nested/file').read_bytes(), PAYLOAD)
        probe.execute(self.root, {'op': 'rename', 'path': 'nested/file', 'destination': 'other/renamed'})
        self.assertFalse((self.path / 'nested/file').exists())
        self.assertFalse(probe.execute(self.root, {'op': 'expect', 'path': 'other/renamed', 'absent': True, 'timeout': .04})['ok'])
        probe.execute(self.root, {'op': 'delete', 'path': 'other/renamed'})
        self.assertTrue(probe.execute(self.root, {'op': 'expect', 'path': 'other/renamed', 'absent': True})['ok'])

    def test_filesystem_root_aliases_are_rejected(self):
        """Compare the opened inode so aliases cannot select the filesystem root."""
        for path in ['/', '/usr/..', '/usr/../.']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                probe.ScratchRoot(path)

    def test_symlink_leaf_and_parent_are_rejected(self):
        """Every operation rejects observed links, including links inside root."""
        self.write('real')
        (self.path / 'link').symlink_to(self.path / 'real')
        (self.path / 'parent').symlink_to(self.outside, target_is_directory=True)
        for name in ['link', 'parent/file']:
            for op in ['write', 'atomic', 'delete', 'rename', 'expect']:
                with self.subTest(name=name, op=op):
                    request = {'op': op, 'path': name, 'content': base64.b64encode(PAYLOAD).decode(),
                               'destination': 'renamed', 'sha256': DIGEST}
                    with self.assertRaises((ValueError, OSError)):
                        probe.execute(self.root, request)
        self.assertEqual((self.path / 'real').read_bytes(), PAYLOAD)
        self.assertEqual((self.outside / 'file').read_bytes(), b'outside')

    def test_nested_runtime_paths_and_traversal_are_rejected(self):
        """Protect runtime trees at every depth, for source and destination."""
        for name in ['.relay/state', 'sub/.relay/state', '../outside/file', '/absolute', '']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.write(name)
        self.write('source')
        with self.assertRaises(ValueError):
            self.root.rename('source', 'nested/.relay/state')

    def test_parent_swap_before_open_cannot_escape(self):
        """A symlink installed just before directory open is refused."""
        (self.path / 'parent').mkdir()
        original_open = os.open
        swapped = False

        def race(name, *args, **kwargs):
            """Replace the directory at the moment a child walk opens it."""
            nonlocal swapped
            if name == 'parent' and kwargs.get('dir_fd') is not None and not swapped:
                swapped = True
                (self.path / 'parent').rename(self.path / 'parked')
                (self.path / 'parent').symlink_to(self.outside, target_is_directory=True)
            return original_open(name, *args, **kwargs)

        with mock.patch.object(probe.os, 'open', side_effect=race), self.assertRaises(OSError):
            self.write('parent/file')
        self.assertTrue(swapped)
        self.assertEqual((self.outside / 'file').read_bytes(), b'outside')

    def test_pinned_parent_survives_symlink_swap_for_every_operation(self):
        """Changing a pathname after its parent opens never retargets an operation."""
        for op in ['write', 'atomic', 'delete', 'rename', 'expect']:
            with self.subTest(op=op):
                parent = self.path / ('parent-' + op)
                parent.mkdir()
                (parent / 'file').write_bytes(PAYLOAD)
                original_parent = self.root.parent
                swapped = False

                @contextmanager
                def race(name, create=False):
                    """Swap the path after the real helper has pinned its directory."""
                    nonlocal swapped
                    with original_parent(name, create=create) as handle:
                        if name.startswith(parent.name + '/') and not swapped:
                            swapped = True
                            parent.rename(self.path / ('parked-' + op))
                            parent.symlink_to(self.outside, target_is_directory=True)
                        yield handle

                request = {'op': op, 'path': parent.name + '/file', 'sha256': DIGEST,
                           'content': base64.b64encode(PAYLOAD).decode(), 'destination': 'renamed-' + op}
                with mock.patch.object(self.root, 'parent', race):
                    self.assertTrue(probe.execute(self.root, request)['ok'])
                self.assertTrue(swapped)
                self.assertEqual((self.outside / 'file').read_bytes(), b'outside')

    def test_permission_errors_retry_then_succeed_or_expire(self):
        """Transient access failures preserve the original bounded retry contract."""
        request = {'op': 'expect', 'path': 'file', 'sha256': DIGEST, 'timeout': .06}
        with mock.patch.object(self.root, 'digest', side_effect=[PermissionError(), (True, DIGEST)]):
            self.assertTrue(probe.execute(self.root, request)['ok'])
        with mock.patch.object(self.root, 'digest', side_effect=PermissionError()):
            result = probe.execute(self.root, request)
            self.assertFalse(result['ok'])
            self.assertGreaterEqual(result['elapsed_ms'], 60)

    def test_write_rejects_hardlink_to_an_outside_file(self):
        """In-place writes cannot truncate an external inode through a hardlink."""
        os.link(self.outside / 'file', self.path / 'hardlink')
        with self.assertRaises(ValueError):
            self.write('hardlink')
        self.assertEqual((self.outside / 'file').read_bytes(), b'outside')

    def test_existing_rename_destination_is_preserved(self):
        """A preexisting destination is refused before rename."""
        self.write('source')
        (self.path / 'destination').write_bytes(b'preserve')
        with self.assertRaises(ValueError):
            self.root.rename('source', 'destination')
        self.assertEqual((self.path / 'destination').read_bytes(), b'preserve')


if __name__ == '__main__':
    unittest.main()
