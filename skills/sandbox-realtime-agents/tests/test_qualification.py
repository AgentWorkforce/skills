"""Keep fixture paths private and drain real PTY data after child exit."""
import importlib.util
import io
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import time
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
    def test_root_is_private_and_root_symlink_is_refused_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o755)
            terminal.configure(root)
            self.assertEqual(root.stat().st_mode&0o777,0o700)
            outside=root/'outside';outside.mkdir();outside.chmod(0o755)
            link=root/'linked';link.symlink_to(outside,target_is_directory=True)
            with self.assertRaises(OSError): terminal.configure(link)
            self.assertFalse((outside/'pi-home').exists())
            self.assertEqual(outside.stat().st_mode&0o777,0o755)
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
    def test_pty_shutdown_kills_a_child_that_ignores_sigterm(self):
        master,slave=pty.openpty();control_read,control_write=os.pipe()
        child=subprocess.Popen([sys.executable,'-c',
            'import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);os.write(1,b"ready\\n");time.sleep(60)'],
            stdout=slave,stderr=slave,start_new_session=True)
        try:
            self.assertTrue(select.select([master],[],[],3)[0]);os.read(master,1024)
            os.killpg(child.pid,signal.SIGTERM)
            started=time.monotonic()
            terminal.drain(master,control_read,child,io.BytesIO(),lambda: started+.05)
            self.assertEqual(child.wait(timeout=2),-signal.SIGKILL)
            self.assertLess(time.monotonic()-started,3)
        finally:
            if child.poll() is None: os.killpg(child.pid,signal.SIGKILL);child.wait()
            for fd in (master,slave,control_read,control_write): os.close(fd)
    def test_exited_leader_does_not_leave_a_helper_process_running(self):
        master,slave=pty.openpty();control_read,control_write=os.pipe()
        code='import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);print(p.pid,flush=True)'
        child=subprocess.Popen([sys.executable,'-c',code],stdout=slave,stderr=slave,start_new_session=True)
        try:
            child.wait(timeout=3)
            self.assertTrue(select.select([master],[],[],3)[0])
            helper=int(os.read(master,1024).strip())
            terminal.drain(master,control_read,child,io.BytesIO())
            deadline=time.monotonic()+2
            while True:
                result=subprocess.run(['ps','-o','stat=','-p',str(helper)],capture_output=True,text=True)
                if result.returncode or result.stdout.strip().startswith('Z'): break
                if time.monotonic()>deadline: self.fail('Owned helper survived direct Pi exit')
                time.sleep(.02)
        finally:
            terminal.kill_group(child)
            if child.poll() is None: child.wait(timeout=3)
            for fd in (master,slave,control_read,control_write): os.close(fd)

if __name__ == '__main__': unittest.main()
