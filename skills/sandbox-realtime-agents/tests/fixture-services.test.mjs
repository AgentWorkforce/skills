import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {privateRoot, savePrivate} from '../scripts/fixture-services.mjs';
import {allowedPath} from '../scripts/qualification/proxy-path.mjs';

test('private writes revoke permissive modes before replacing credential bytes', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-private-'));
  try {
    fs.chmodSync(root,0o755);privateRoot(root);
    const target=path.join(root,'credential.json');fs.writeFileSync(target,'old',{mode:0o644});
    savePrivate(target,{token:'synthetic-fixture-value'});
    assert.equal(fs.statSync(root).mode&0o777,0o700);
    assert.equal(fs.statSync(target).mode&0o777,0o600);
    const link=path.join(root,'link');fs.symlinkSync(target,link);
    assert.throws(()=>savePrivate(link,{token:'new'}));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('bootstrap collection spellings are denied before proxying', () => {
  for (const url of ['/v1/workspaces','/v1/workspaces/','/v1/workspaces?x=1','/v1%2fworkspaces',
    '/v1%252fworkspaces','/foo/../v1/workspaces','/%2fv1/workspaces','/v1//workspaces','http://other.invalid/v1/workspaces'])
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
