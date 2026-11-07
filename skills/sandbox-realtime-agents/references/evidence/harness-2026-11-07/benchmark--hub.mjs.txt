// Disposable Relayfile benchmark service; key material stays on this VM.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const root = '/app/bench-private';
fs.mkdirSync(root, {recursive:true, mode:0o700});
const save = (p, value) => fs.writeFileSync(root+'/'+p, JSON.stringify(value), {mode:0o600});
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
const jwk = {...publicKey.export({format:'jwk'}), kid:'benchmark', alg:'RS256', use:'sig'};
const jwks = http.createServer((req,res) => {
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({keys:[jwk]}));
}).listen(9091,'127.0.0.1');
for (const role of ['a','b']) {
  const head = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'benchmark'})).toString('base64url');
  const body = Buffer.from(JSON.stringify({wks:'ws_relayfile_benchmark',sub:role,aud:'relayfile',scopes:['fs:read','fs:write','ops:read'],iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200})).toString('base64url');
  const unsigned=head+'.'+body;
  save('mount-'+role+'.json', {token:unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url')});
}
const server=spawn('/tmp/relayfile-server',[],{env:{...process.env,RELAYFILE_ADDR:':9090',RELAYFILE_INTERNAL_HMAC_SECRET:crypto.randomBytes(32).toString('hex'),RELAYAUTH_JWKS_URL:'http://127.0.0.1:9091/jwks',RELAYFILE_EXTERNAL_WRITEBACK:'false',RELAYFILE_STATE_FILE:root+'/state.json',RELAYFILE_RATE_LIMIT_MAX:'100000'},stdio:['ignore','inherit','inherit']});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.kill('SIGTERM');jwks.close();setTimeout(()=>process.exit(),500);});
