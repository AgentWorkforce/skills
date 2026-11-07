import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {privateRoot, savePrivate, listenAddress, healthOrigin} from '../scripts/fixture-services.mjs';
import {allowedPath, unavailable} from '../scripts/qualification/proxy-path.mjs';
import {bridge} from '../scripts/qualification/socket-proxy.mjs';

test('private writes revoke permissive modes before replacing credential bytes', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-private-'));
  try {
    fs.chmodSync(root,0o755);privateRoot(root);
    const target=path.join(root,'credential.json');fs.writeFileSync(target,'old',{mode:0o644});
    fs.chmodSync(target,0o644); // Exercise replacement even under an owner-only umask.
    savePrivate(target,{token:'synthetic-fixture-value'});
    assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),{token:'synthetic-fixture-value'});
    assert.equal(fs.statSync(root).mode&0o777,0o700);
    assert.equal(fs.statSync(target).mode&0o777,0o600);
    const link=path.join(root,'link');fs.symlinkSync(target,link);
    assert.throws(()=>savePrivate(link,{token:'new'}));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('bootstrap collection spellings are denied before proxying', () => {
  for (const url of ['/v1/workspaces','/v1/workspaces/','/v1/workspaces?x=1','/v1%2fworkspaces',
    '/v1%252fworkspaces','/v1/%77orkspaces','/foo/../v1/workspaces','/%2fv1/workspaces','/v1//workspaces','http://other.invalid/v1/workspaces'])
    assert.equal(allowedPath(url),false,url);
  for (const url of ['/health','/v1/node/ws','/v1/dm','/v1/workspaces/one']) assert.equal(allowedPath(url),true,url);
});

test('engine wrapper binds a real Node server only to loopback', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-loopback-'));
  try {
    const entry=path.join(root,'server.mjs');
    fs.writeFileSync(entry,`import http from 'node:http'; const server=http.createServer();server.listen({port:0},()=>{console.log(server.address().address);server.close();});`);
    const wrapper=new URL('../scripts/qualification/engine-loopback.mjs',import.meta.url);
    const result=spawnSync(process.execPath,[wrapper.pathname],{env:{...process.env,RELAYCAST_ENGINE_ENTRY:entry},encoding:'utf8',timeout:3000});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'127.0.0.1');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('health checks use specific bindings and loopback for wildcards, including IPv6',()=>{
  assert.equal(healthOrigin('127.0.0.2',9090),'http://127.0.0.2:9090');
  assert.equal(healthOrigin('0.0.0.0',9090),'http://127.0.0.1:9090');
  assert.equal(healthOrigin('::',9090),'http://[::1]:9090');
  assert.equal(healthOrigin('::1',9090),'http://[::1]:9090');
  assert.equal(listenAddress('::1',9090),'[::1]:9090');
});

test('startup failures identify the step without logging raw private error data',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-failure-'));
  try {
    const module=new URL('../scripts/fixture-services.mjs',import.meta.url).href;
    const code=`import {Services} from ${JSON.stringify(module)};new Services(process.argv[1]).fail('messaging dependency',new TypeError('PRIVATE_MARKER'));`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code,root],{encoding:'utf8',timeout:3000});
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/Fixture failure at messaging dependency: TypeError/);
    assert.doesNotMatch(result.stderr,/PRIVATE_MARKER/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('an upstream error destroys a partial body instead of appending a 502 message',()=>{
  const calls=[];
  unavailable({headersSent:true,destroy:()=>calls.push('destroy'),end:()=>calls.push('end'),writeHead:()=>calls.push('headers')});
  assert.deepEqual(calls,['destroy']);
  unavailable({headersSent:false,writeHead:status=>calls.push(status),end:body=>calls.push(body)});
  assert.deepEqual(calls,['destroy',502,'Backend unavailable']);
});

class Socket extends EventEmitter {
  constructor(state) { super();this.readyState=state;this.bufferedAmount=0;this.sent=[]; }
  send(data) {this.sent.push(data.toString());}
  close(code) {this.closeCode=code;this.readyState=3;this.emit('close');}
  terminate() {this.terminated=true;this.readyState=3;this.emit('close');}
}
test('a stalled websocket handshake has bounded frame and byte queues',()=>{
  for (const limits of [{maxFrames:1},{maxBytes:3}]) {
    const down=new Socket(1),up=new Socket(0);bridge(down,up,limits);
    down.emit('message',Buffer.from('ab'),false);down.emit('message',Buffer.from('cd'),false);
    assert.equal(down.closeCode,1009);assert.equal(up.terminated,true);assert.deepEqual(up.sent,[]);
  }
});
test('a stalled websocket handshake is terminated at its deadline',async()=>{
  const down=new Socket(1),up=new Socket(0);bridge(down,up,{connectTimeoutMs:10});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(up.terminated,true);assert.equal(down.readyState,3);
});
test('websocket queues flush in order and congested output closes both peers',()=>{
  const down=new Socket(1),up=new Socket(0);bridge(down,up,{maxBytes:8});
  down.emit('message',Buffer.from('one'),false);down.emit('message',Buffer.from('two'),false);
  up.readyState=1;up.emit('open');assert.deepEqual(up.sent,['one','two']);
  up.emit('message',Buffer.from('back'),false);assert.deepEqual(down.sent,['back']);
  up.bufferedAmount=7;down.emit('message',Buffer.from('xx'),false);
  assert.equal(up.closeCode,1009);assert.equal(down.closeCode,1009);
});
