// Disposable Relayfile benchmark service. Historical measured source is archived separately.
import http from 'node:http';
import crypto from 'node:crypto';
import {privateRoot, savePrivate, Services, healthy, listenAddress, healthOrigin} from '../fixture-services.mjs';

const root = process.env.RELAY_BENCH_ROOT || '/app/bench-private';
privateRoot(root);
const group = new Services(root);
let stage = 'configuration';
try {
  const port = Number(process.env.RELAY_TEST_FILE_PORT || 9090);
  const jwksPort = Number(process.env.RELAY_TEST_JWKS_PORT || 9091);
  const host = process.env.RELAY_TEST_HOST || '0.0.0.0';
  const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
  const jwk = {...publicKey.export({format:'jwk'}), kid:'benchmark', alg:'RS256', use:'sig'};
  stage = 'JWKS listener';
  await group.listen(http.createServer((_req,res) => {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({keys:[jwk]}));
  }), jwksPort, '127.0.0.1');
  stage = 'private mount bundles';
  for (const role of ['a','b']) {
    const head = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'benchmark'})).toString('base64url');
    const body = Buffer.from(JSON.stringify({wks:'ws_relayfile_benchmark',sub:role,aud:'relayfile',scopes:['fs:read','fs:write','ops:read'],iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200})).toString('base64url');
    const unsigned = head + '.' + body;
    savePrivate(root+'/mount-'+role+'.json', {token:unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url')});
  }
  stage = 'Relayfile startup';
  group.child(process.env.RELAYFILE_BIN || '/tmp/relayfile-server', [], {env:{...process.env,
    RELAYFILE_ADDR:listenAddress(host, port), RELAYFILE_INTERNAL_HMAC_SECRET:crypto.randomBytes(32).toString('hex'),
    RELAYAUTH_JWKS_URL:`http://127.0.0.1:${jwksPort}/jwks`, RELAYFILE_EXTERNAL_WRITEBACK:'false',
    RELAYFILE_STATE_FILE:root+'/state.json', RELAYFILE_RATE_LIMIT_MAX:'100000'}});
  stage = 'Relayfile health';
  await healthy(healthOrigin(host, port)+'/health', Number(process.env.RELAY_TEST_HEALTH_TIMEOUT_MS || 10000));
  group.ready({relayfile_workspace:'ws_relayfile_benchmark'});
} catch (error) { group.fail(stage, error); }
