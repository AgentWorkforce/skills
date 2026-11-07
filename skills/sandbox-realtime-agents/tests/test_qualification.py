"""Keep fixture paths private and drain real PTY data after child exit."""
import importlib.util
import io
import os
from pathlib import Path
import pty
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
sys.dont_write_bytecode = True
BASE = Path(__file__).parents[1] / 'scripts/qualification'
def load(name):
    spec = importlib.util.spec_from_file_location(name, BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
terminal = load('pi_terminal')
model = load('model_fixture')

class QualificationTests(unittest.TestCase):
    def test_model_refuses_outside_and_runtime_paths(self):
        for name in ['/etc/passwd', '../file', '.relay/state', 'nested/.relay/state', 'file/', 'a//b']:
            with self.subTest(name=name), self.assertRaises(ValueError): model.safe_relative(name)
        self.assertEqual(str(model.safe_relative('scratch/file')), 'scratch/file')
    def test_personal_home_and_existing_fixture_configs_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); personal=root/'personal';personal.mkdir()
            sentinel=personal/'models.json';sentinel.write_text('personal value')
            with mock.patch.dict(os.environ,{'HOME':str(personal)}): home, agent=terminal.configure(root)
            self.assertEqual(sentinel.read_text(),'personal value')
            self.assertEqual(home,root/'pi-home')
            original=(agent/'models.json').read_bytes()
            with self.assertRaises(ValueError): terminal.configure(root)
            self.assertEqual((agent/'models.json').read_bytes(),original)
            self.assertEqual((agent/'models.json').stat().st_mode & 0o777,0o600)
    def test_fixture_home_symlink_is_refused_before_creating_children(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);outside=root/'outside';outside.mkdir()
            (root/'pi-home').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError): terminal.configure(root)
            self.assertFalse((outside/'.pi').exists())
    def test_pty_final_bytes_are_drained_after_child_has_exited(self):
        master, slave=pty.openpty()
        child=subprocess.Popen([sys.executable,'-c','import os;os.write(1,b"final output\\n")'],stdout=slave,stderr=slave)
        child.wait(timeout=3)
        control_read,control_write=os.pipe()
        try:
            result=io.BytesIO();terminal.drain(master,control_read,child,result)
            self.assertIn(b'final output',result.getvalue())
        finally:
            os.close(master);os.close(slave);os.close(control_read);os.close(control_write)

if __name__ == '__main__': unittest.main()
