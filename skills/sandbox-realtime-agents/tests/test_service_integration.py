"""Optional local integration with the real built Relayfile server and engine."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

SCRIPTS = Path(__file__).parents[1] / 'scripts'
SERVER = os.environ.get('RELAY_TEST_SERVER_BIN')
MODULES = os.environ.get('RELAY_TEST_ENGINE_MODULES')
NODE = os.environ.get('RELAY_TEST_NODE_BIN', 'node')


def free_port():
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        return server.getsockname()[1]


@unittest.skipUnless(SERVER and MODULES, 'Set RELAY_TEST_SERVER_BIN and RELAY_TEST_ENGINE_MODULES for real local service integration')
class ServiceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ports = {name: free_port() for name in ('FILE', 'JWKS', 'ENGINE', 'PROXY')}
        self.env = {k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR') if k in os.environ}
        self.env.update({'RELAY_TEST_ROOT': str(self.root), 'RELAY_BENCH_ROOT': str(self.root),
                         'RELAY_TEST_HOST': '127.0.0.1', 'RELAYFILE_BIN': SERVER,
                         'RELAY_TEST_MODULES': MODULES,
                         'RELAYCAST_ENGINE_ENTRY': str(Path(MODULES)/'@relaycast/engine/dist/bin/serve.js'),
                         'RELAY_TEST_HEALTH_TIMEOUT_MS': '3000'})
        self.env.update({'RELAY_TEST_'+name+'_PORT': str(port) for name, port in self.ports.items()})
        self.process = None
    def tearDown(self):
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.communicate(timeout=5)
        self.temp.cleanup()
    def start(self, kind):
        self.process = subprocess.Popen([NODE, str(SCRIPTS/kind/'hub.mjs')], env=self.env,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def ready(self):
        deadline = time.monotonic()+8
        while time.monotonic()<deadline:
            try:
                if json.loads((self.root/'ready.json').read_text())['ready']:
                    return
            except (FileNotFoundError, json.JSONDecodeError): pass
            if self.process.poll() is not None:
                self.fail('Fixture exited before ready')
            time.sleep(.03)
        self.fail('Fixture readiness deadline')
    def assert_ports_closed(self):
        for port in self.ports.values():
            with socket.socket() as client:
                client.settimeout(.2)
                self.assertNotEqual(client.connect_ex(('127.0.0.1',port)),0)
    def test_missing_executable_is_nonzero_and_existing_modes_are_revoked(self):
        self.root.chmod(0o755)
        bundle=self.root/'mount-a.json';bundle.write_text('old');bundle.chmod(0o644)
        self.env['RELAYFILE_BIN']=str(self.root/'not-an-executable')
        self.start('benchmark')
        self.assertNotEqual(self.process.wait(timeout=5),0)
        self.assertFalse(json.loads((self.root/'ready.json').read_text())['ready'])
        self.assertEqual(self.root.stat().st_mode&0o777,0o700)
        self.assertEqual(bundle.stat().st_mode&0o777,0o600)
        self.assert_ports_closed()
    def test_later_child_exit_clears_ready_and_stops_parent(self):
        self.start('benchmark');self.ready()
        pid=json.loads((self.root/'child-pids.json').read_text())[0]
        os.kill(pid,signal.SIGTERM)
        self.assertNotEqual(self.process.wait(timeout=5),0)
        self.assertFalse(json.loads((self.root/'ready.json').read_text())['ready'])
        self.assert_ports_closed()
    def test_real_qualification_health_workspace_ids_and_bootstrap_guard(self):
        urls={'relayfile':f'http://127.0.0.1:{self.ports["FILE"]}',
              'relaycast':f'http://127.0.0.1:{self.ports["PROXY"]}'}
        (self.root/'urls.json').write_text(json.dumps(urls))
        self.env['RELAYFILE_TEST_WORKSPACE']='independent-file-namespace'
        self.start('qualification');self.ready()
        ready=json.loads((self.root/'ready.json').read_text())
        workspace=json.loads((self.root/'workspace.json').read_text())
        actual=workspace.get('data',workspace)
        self.assertEqual(ready['relaycast_workspace_id'],actual.get('id',actual.get('workspace_id')))
        self.assertEqual(ready['relayfile_workspace'],'independent-file-namespace')
        for path in ['/v1/workspaces','/v1%2fworkspaces','/v1%252fworkspaces','/foo/../v1/workspaces']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urls['relaycast']+path,timeout=2)
            self.assertEqual(error.exception.code,403)
        with urllib.request.urlopen(urls['relaycast']+'/health',timeout=2) as response:
            self.assertEqual(response.status,200)
    def test_proxy_listen_error_kills_already_started_children(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1',self.ports['PROXY']));occupied.listen()
            (self.root/'urls.json').write_text(json.dumps({'relayfile':'http://127.0.0.1', 'relaycast':'http://127.0.0.1'}))
            self.start('qualification')
            self.assertNotEqual(self.process.wait(timeout=5),0)
            self.assertFalse(json.loads((self.root/'ready.json').read_text())['ready'])
        self.assert_ports_closed()
    def specific_ipv6_binding(self,kind):
        for name in ('FILE','PROXY'):
            try:
                with socket.socket(socket.AF_INET6) as server:
                    server.bind(('::1',0));self.ports[name]=server.getsockname()[1]
            except OSError: self.skipTest('IPv6 loopback is unavailable')
            self.env['RELAY_TEST_'+name+'_PORT']=str(self.ports[name])
        self.env['RELAY_TEST_HOST']='::1'
        (self.root/'urls.json').write_text(json.dumps({
            'relayfile':f'http://[::1]:{self.ports["FILE"]}',
            'relaycast':f'http://[::1]:{self.ports["PROXY"]}'}))
        self.start(kind);self.ready()
        self.process.terminate();self.assertEqual(self.process.wait(timeout=5),0)
        for name in ('FILE','PROXY'):
            with socket.socket(socket.AF_INET6) as client:
                client.settimeout(.2)
                self.assertNotEqual(client.connect_ex(('::1',self.ports[name])),0)
    def test_benchmark_checks_the_specific_ipv6_binding(self):
        self.specific_ipv6_binding('benchmark')
    def test_qualification_checks_the_specific_ipv6_binding(self):
        self.specific_ipv6_binding('qualification')

if __name__ == '__main__': unittest.main()
