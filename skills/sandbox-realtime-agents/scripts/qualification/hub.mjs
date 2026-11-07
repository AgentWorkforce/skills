// Maintained fixture. The two original measured service sources are text evidence.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {privateRoot, savePrivate, Services, healthy, listenAddress, healthOrigin} from '../fixture-services.mjs';
import {allowedPath, unavailable} from './proxy-path.mjs';
import {bridge} from './socket-proxy.mjs';

const root = process.env.RELAY_TEST_ROOT || '/app/relay-test';
privateRoot(root);
const group = new Services(root);
let stage = 'configuration';
try {
  // Reusing old bindings is a separate recovery task, never implicit bootstrap.
  if (fs.existsSync(root+'/workspace.json')) throw new Error('Use a fresh qualification directory');
  const urls = JSON.parse(fs.readFileSync(root+'/urls.json','utf8'));
  const namespace = process.env.RELAYFILE_TEST_WORKSPACE || 'ws_sandbox_e2e';
  const filePort = Number(process.env.RELAY_TEST_FILE_PORT || 9090);
  const jwksPort = Number(process.env.RELAY_TEST_JWKS_PORT || 9091);
  const enginePort = Number(process.env.RELAY_TEST_ENGINE_PORT || 8788);
  const proxyPort = Number(process.env.RELAY_TEST_PROXY_PORT || 8787);
  const timeout = Number(process.env.RELAY_TEST_HEALTH_TIMEOUT_MS || 10000);
  const host = process.env.RELAY_TEST_HOST || '0.0.0.0';
  const modules = process.env.RELAY_TEST_MODULES || '/opt/relay-test/node_modules';
  stage = 'messaging dependency';
  const {WebSocketServer, WebSocket} = await import(pathToFileURL(modules+'/ws/wrapper.mjs').href);
  const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
  const jwk = {...publicKey.export({format:'jwk'}), kid:'qualification', alg:'RS256', use:'sig'};
  const hmac = crypto.randomBytes(32).toString('hex');
  stage = 'JWKS listener';
  await group.listen(http.createServer((_req,res) => {
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));
  }), jwksPort, '127.0.0.1');
  stage = 'private mount bundles';
  for (const subject of ['a','b']) {
    const head = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'qualification'})).toString('base64url');
    const body = Buffer.from(JSON.stringify({wks:namespace,sub:subject,aud:'relayfile',scopes:['fs:read','fs:write','ops:read'],iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200})).toString('base64url');
    const signed = head+'.'+body;
    savePrivate(root+'/mount-'+subject+'.json', {token:signed+'.'+crypto.sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url')});
  }
  stage = 'service startup';
  group.child(process.env.RELAYFILE_BIN || '/tmp/relayfile-server', [], {env:{...process.env,
    RELAYFILE_ADDR:listenAddress(host,filePort), RELAYFILE_INTERNAL_HMAC_SECRET:hmac,
    RELAYAUTH_JWKS_URL:`http://127.0.0.1:${jwksPort}/jwks`, RELAYFILE_EXTERNAL_WRITEBACK:'false',
    RELAYFILE_STATE_FILE:root+'/relayfile-state.json', RELAYFILE_RATE_LIMIT_MAX:'10000'}});
  group.child(process.execPath, [fileURLToPath(new URL('./engine-loopback.mjs',import.meta.url)),
    '--port',String(enginePort),'--db',root+'/relaycast.db','--base-url',urls.relaycast], {env:process.env});
  const proxy = http.createServer((req,res) => {
    if (!allowedPath(req.url)) { res.writeHead(403);res.end('Workspace bootstrap is local only');return; }
    const up = http.request({hostname:'127.0.0.1',port:enginePort,path:req.url,method:req.method,headers:req.headers}, response => {
      response.on('error',()=>res.destroy());
      response.on('aborted',()=>res.destroy());
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    up.on('error',()=>unavailable(res));
    req.pipe(up);
  });
  const sockets = new WebSocketServer({noServer:true,maxPayload:256*1024});
  proxy.on('upgrade',(req,socket,head) => {
    if (!allowedPath(req.url)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return; }
    sockets.handleUpgrade(req,socket,head,down => {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) =>
        !['host','connection','upgrade'].includes(key) && !key.startsWith('sec-websocket-')));
      const up = new WebSocket(`ws://127.0.0.1:${enginePort}`+req.url,
        {headers,handshakeTimeout:2000,maxPayload:256*1024});
      bridge(down,up);
    });
  });
  // This proxy is intentionally reachable from the other VMs; the engine is loopback-only.
  stage = 'public proxy listener';
  await group.listen(proxy, proxyPort, host);
  stage = 'Relayfile health';
  await healthy(healthOrigin(host,filePort)+'/health',timeout);
  stage = 'messaging health';
  await healthy(`http://127.0.0.1:${enginePort}/health`,timeout);
  stage = 'messaging workspace bootstrap';
  const response = await fetch(`http://127.0.0.1:${enginePort}/v1/workspaces`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:process.env.RELAY_TEST_NAME || 'isolated-qualification'}),
    signal:AbortSignal.timeout(timeout)});
  if (!response.ok) throw new Error('Workspace bootstrap failed');
  const workspace = await response.json();
  const data = workspace.data || workspace;
  const id = data.id || data.workspace_id;
  if (!id) throw new Error('Missing messaging workspace identifier');
  savePrivate(root+'/workspace.json',workspace);
  group.ready({relayfile_workspace:namespace,relaycast_workspace_id:id,relayfile:urls.relayfile,relaycast:urls.relaycast});
} catch (error) { group.fail(stage,error); }
