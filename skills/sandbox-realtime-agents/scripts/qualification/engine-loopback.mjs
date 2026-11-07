// Engine 8.12.0 has no hostname option. Confine HTTP listeners in this child
// before importing its real entry point; the public proxy is a separate process.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'object') args[0] = {...args[0], host:'127.0.0.1'};
  else if (typeof args[0] === 'number') {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    else args.splice(1, 0, '127.0.0.1');
  } else throw new Error('Unexpected engine listener');
  return Reflect.apply(listen, this, args);
};
await import(pathToFileURL(process.env.RELAYCAST_ENGINE_ENTRY || '/opt/relay-test/node_modules/@relaycast/engine/dist/bin/serve.js').href);
