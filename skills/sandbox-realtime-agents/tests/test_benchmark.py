"""Failure, deadline, credential-boundary and serialization regression tests."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock
sys.dont_write_bytecode = True
BASE = Path(__file__).parents[1] / 'scripts/benchmark'
def load(name):
    spec = importlib.util.spec_from_file_location('benchmark_' + name, BASE / (name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
peer = load('peer')
cell = load('cell')

class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        peer.ROOT = Path(self.temp.name)
        peer.SHARED = peer.ROOT / 'shared'; peer.SHARED.mkdir()
        peer.CONFIG = {'run':'test', 'role':'a','peer_role':'b', 'peer_url':'https://example.invalid', 'callback_token':'fixture'}
        peer.PENDING.clear()
    def tearDown(self):
        self.temp.cleanup()
    def run_results(self, results):
        event = mock.Mock(); outcomes = iter(results)
        def acknowledge(_timeout):
            ok = next(outcomes)
            if ok:
                next(iter(peer.PENDING.values()))['ack_ns'] = peer.time.monotonic_ns()
            return ok
        event.wait.side_effect = acknowledge
        with mock.patch.object(peer.threading, 'Event', return_value=event), mock.patch.object(peer, 'post'), mock.patch.object(peer.time, 'sleep'):
            return peer.run_cell({'bytes':1024,'samples':len(results),'warmups':0})
    def test_final_trial_failure_is_incomplete_and_retained(self):
        result = self.run_results([True, False])
        self.assertFalse(result['complete'])
        self.assertEqual(len(result['samples']), 2)
        rows = [json.loads(x) for x in (peer.ROOT/'samples.jsonl').read_text().splitlines()]
        self.assertFalse(rows[-1]['success']); self.assertFalse(peer.PENDING)
        self.assertIsNone(rows[-1]['write_to_ack_ms'])
    def test_successful_cells_have_ack_latencies_and_unique_retry_rounds(self):
        first = self.run_results([True, True]); second = self.run_results([True, True])
        self.assertTrue(first['complete']); self.assertTrue(second['complete'])
        self.assertTrue(all(r['write_to_ack_ms'] >= r['local_write_ms'] >= 0 for r in first['samples']))
        self.assertTrue({r['round'] for r in first['samples']}.isdisjoint(r['round'] for r in second['samples']))
    def test_late_ack_cannot_turn_a_timeout_into_an_ack_latency(self):
        event=mock.Mock()
        def expired(_timeout):
            pending=next(iter(peer.PENDING.values()))
            pending['ack_ns']=peer.time.monotonic_ns()
            return False
        event.wait.side_effect=expired
        with mock.patch.object(peer.threading,'Event',return_value=event), mock.patch.object(peer,'post'):
            result=peer.run_cell({'bytes':1024,'samples':1,'warmups':0})
        self.assertFalse(result['complete'])
        self.assertIsNone(result['samples'][0]['write_to_ack_ms'])
    def test_arm_and_write_failures_release_pending_round(self):
        for stage in ('arm','write'):
            with self.subTest(stage=stage):
                if stage == 'write': peer.SHARED = peer.ROOT / 'missing'
                with mock.patch.object(peer, 'post', side_effect=OSError() if stage == 'arm' else None):
                    result = peer.run_cell({'bytes':1024,'samples':1,'warmups':0})
                self.assertFalse(result['complete']); self.assertFalse(peer.PENDING)
                self.assertFalse(result['samples'][0]['success'])
    def test_driver_failure_exit_and_timeout_budget(self):
        root = peer.ROOT
        (root/'config.json').write_text(json.dumps(peer.CONFIG))
        rows = [{'success':True} for _ in range(109)] + [{'success':False}]
        for complete in (False, True):
            response = io.BytesIO(json.dumps({'complete':complete,'samples':rows}).encode())
            with mock.patch.object(cell, 'Path', return_value=root), mock.patch.object(cell.sys,'argv',['cell.py','1024']), mock.patch.object(cell.urllib.request,'urlopen',return_value=response) as request, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cell.main(),1)
                self.assertGreaterEqual(request.call_args.kwargs['timeout'],110*30.1)
            self.assertTrue((root/'cell-1024.json').exists())
    def test_arm_consumes_budget_without_entering_metric(self):
        event = mock.Mock(); event.wait.return_value = False
        with mock.patch.object(peer.threading,'Event',return_value=event), mock.patch.object(peer,'post'), mock.patch.object(peer.time,'monotonic',side_effect=[0,6]):
            peer.run_cell({'bytes':1024,'samples':1,'warmups':0})
        self.assertEqual(event.wait.call_args.args[0],24)
    def test_unsafe_callback_origins_fail_before_network(self):
        for url in ['http://example.invalid','https://user:password@example.invalid','https://example.invalid/path','https://example.invalid/?token=value']:
            peer.CONFIG['peer_url']=url
            with mock.patch.object(peer.OPENER,'open') as network, self.assertRaises(ValueError):
                peer.post(url+'/arm',{})
            network.assert_not_called()
        self.assertIsNone(peer.NoRedirect().redirect_request(None,None,302,'',{},'http://example.invalid'))
    def test_runs_are_serialized_and_non_ascii_auth_is_rejected(self):
        entered=threading.Event(); release=threading.Event()
        def block(_body): entered.set(); release.wait(3); return {'complete':True,'samples':[]}
        server=ThreadingHTTPServer(('127.0.0.1',0),peer.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin='http://127.0.0.1:'+str(server.server_port)
        def request(token='fixture'):
            r=urllib.request.Request(origin+'/run',json.dumps({'bytes':1024,'samples':100,'warmups':10}).encode(),{'Authorization':'Bearer '+token})
            try:
                with urllib.request.urlopen(r,timeout=4) as response:return response.status
            except urllib.error.HTTPError as error:return error.code
        try:
            with mock.patch.object(peer,'run_cell',side_effect=block):
                first=threading.Thread(target=request);first.start();self.assertTrue(entered.wait(2))
                self.assertEqual(request(),409)
                self.assertEqual(request('é'),401)
                release.set();first.join(2);self.assertFalse(first.is_alive())
        finally:
            release.set();server.shutdown();server.server_close();thread.join()

if __name__ == '__main__': unittest.main()
