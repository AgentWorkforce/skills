// Disposable qualification service. Run only after approval to create test credentials.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from '/opt/relay-test/node_modules/ws/wrapper.mjs';
const root='/app/relay-test';
fs.mkdirSync(root,{recursive:true,mode:0o700});
const urls=JSON.parse(fs.readFileSync(root+'/urls.json'));
const secureWrite=(p,s)=>fs.writeFileSync(p,typeof s==='string'?s:JSON.stringify(s),{mode:0o600});
let keys;
if(fs.existsSync(root+'/signing.json'))keys=JSON.parse(fs.readFileSync(root+'/signing.json'));
else {
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 keys={private:privateKey.export({type:'pkcs8',format:'pem'}),public:{...publicKey.export({format:'jwk'}),kid:'blaxel-e2e',alg:'RS256',use:'sig'},hmac:crypto.randomBytes(32).toString('hex')};
 secureWrite(root+'/signing.json',keys);
}
const jwks=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[keys.public]}));}).listen(9091,'127.0.0.1');
for(const subject of ['a','b','admin']){
 const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'blaxel-e2e'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({wks:'ws_e2b_e2e',sub:subject,aud:'relayfile',scopes:['fs:read','fs:write','ops:read'],iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200})).toString('base64url');
 const signed=header+'.'+payload;
 secureWrite(root+'/mount-'+subject+'.json',{token:signed+'.'+crypto.sign('RSA-SHA256',Buffer.from(signed),keys.private).toString('base64url')});
}
fs.chmodSync('/tmp/relayfile-server',0o755);
const server=spawn('/tmp/relayfile-server',[],{env:{...process.env,RELAYFILE_ADDR:':9090',RELAYFILE_INTERNAL_HMAC_SECRET:keys.hmac,RELAYAUTH_JWKS_URL:'http://127.0.0.1:9091/jwks',RELAYFILE_EXTERNAL_WRITEBACK:'false',RELAYFILE_STATE_FILE:root+'/relayfile-state.json',RELAYFILE_RATE_LIMIT_MAX:'10000'},stdio:['ignore','inherit','inherit']});
const engine=spawn('node',['/opt/relay-test/node_modules/@relaycast/engine/dist/bin/serve.js','--port','8788','--db',root+'/relaycast.db','--base-url',urls.relaycast],{stdio:['ignore','inherit','inherit']});
const proxy=http.createServer((req,res)=>{
 if(/^\/v1\/workspaces\/?(?:\?|$)/.test(req.url)){res.writeHead(403);res.end('Workspace bootstrap is local only');return;}
 const up=http.request({hostname:'127.0.0.1',port:8788,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 up.on('error',()=>{res.writeHead(502);res.end('Backend unavailable');});req.pipe(up);
});
const wss=new WebSocketServer({noServer:true});
proxy.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,down=>{
 const headers=Object.fromEntries(Object.entries(req.headers).filter(([k])=>!['host','connection','upgrade'].includes(k)&&!k.startsWith('sec-websocket-')));
 const up=new WebSocket('ws://127.0.0.1:8788'+req.url,{headers});
 up.on('unexpected-response',(_,r)=>{console.log('upstream-ws-status',r.statusCode);down.close();});
 up.on('upgrade',()=>console.log('upstream-ws-upgraded'));
 const queued=[];
 down.on('message',(data,isBinary)=>up.readyState===WebSocket.OPEN?up.send(data,{binary:isBinary}):queued.push([data,isBinary]));
 up.on('open',()=>queued.splice(0).forEach(([data,isBinary])=>up.send(data,{binary:isBinary})));
 up.on('message',(data,isBinary)=>down.readyState===WebSocket.OPEN&&down.send(data,{binary:isBinary}));
 down.on('close',()=>up.close());up.on('close',()=>down.close());up.on('error',e=>{console.log('upstream-ws-error',e.code||e.name);down.close();});down.on('error',()=>up.close());
}));
proxy.listen(8787,'::');
for(let i=0;i<100;i++){
 try{const r=await fetch('http://127.0.0.1:8788/health');if(r.ok)break;}catch{}
 await new Promise(r=>setTimeout(r,100));
}
if(!fs.existsSync(root+'/workspace.json')){
 const r=await fetch('http://127.0.0.1:8788/v1/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'e2b-qualification-20261107'})});
 if(!r.ok)throw new Error('Isolated messaging workspace bootstrap failed: '+r.status);
 secureWrite(root+'/workspace.json',await r.json());
}
secureWrite(root+'/ready.json',{ready:true,workspace:'ws_e2b_e2e',relayfile:urls.relayfile,relaycast:urls.relaycast});
console.log('Isolated Relayfile and Relaycast ready. No credentials logged.');
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{server.kill('SIGTERM');engine.kill('SIGTERM');proxy.close();jwks.close();setTimeout(()=>process.exit(0),500);});
