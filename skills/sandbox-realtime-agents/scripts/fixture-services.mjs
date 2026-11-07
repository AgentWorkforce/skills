// Lifecycle and private-file helpers for disposable qualification fixtures.
import fs from 'node:fs';
import {spawn} from 'node:child_process';

/** Format binding/probe addresses, including specific and wildcard IPv6. */
export function listenAddress(host, port) {
  return (host.includes(':') ? `[${host}]` : host) + ':' + port;
}
export function healthOrigin(host, port) {
  const target = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return 'http://' + listenAddress(target, port);
}

export function privateRoot(root) {
  fs.mkdirSync(root, {recursive:true, mode:0o700});
  const info = fs.lstatSync(root);
  if (!info.isDirectory() || info.uid !== process.getuid()) throw new Error('Invalid private directory');
  fs.chmodSync(root, 0o700);
}

export function savePrivate(path, value) {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) throw new Error('Invalid private file');
    fs.fchmodSync(fd, 0o600);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, JSON.stringify(value));
  } finally { fs.closeSync(fd); }
}

export class Services {
  constructor(root) {
    this.root = root; this.children = []; this.servers = []; this.closing = false;
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => this.stop(0));
    process.once('uncaughtException', error => this.fail('uncaught exception', error));
    process.once('unhandledRejection', error => this.fail('unhandled rejection', error));
    savePrivate(root + '/ready.json', {ready:false});
  }
  child(command, args, options) {
    const child = spawn(command, args, {...options, stdio:['ignore','inherit','inherit']});
    this.children.push(child);
    child.once('error', error => this.fail('child spawn', error));
    child.once('exit', () => { if (!this.closing) this.fail('child exit'); });
    savePrivate(this.root + '/child-pids.json', this.children.map(item => item.pid).filter(Boolean));
    return child;
  }
  listen(server, port, host) {
    this.servers.push(server);
    server.on('error', error => this.fail('listener', error));
    return new Promise((resolve,reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  }
  ready(value) {
    if (this.closing) throw new Error('Fixture is stopping');
    savePrivate(this.root + '/ready.json', {ready:true, ...value});
  }
  fail(stage, error) {
    // Fixed step labels and whitelisted classifications are useful diagnostics;
    // raw messages/stacks can contain private JSON, URLs, headers or tokens.
    if (this.closing) return;
    const kind = ['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError'].includes(error?.name) ? error.name : 'Error';
    const code = ['ENOENT','EACCES','EADDRINUSE','ETIMEDOUT'].includes(error?.code) ? ` (${error.code})` : '';
    console.error(`Fixture failure at ${stage}: ${kind}${code}`);
    this.stop(1);
  }
  stop(code) {
    if (this.closing) return;
    this.closing = true;
    try { savePrivate(this.root + '/ready.json', {ready:false}); } catch {}
    for (const child of this.children) child.kill('SIGTERM');
    for (const server of this.servers) server.close();
    setTimeout(() => {
      for (const child of this.children) if (child.exitCode === null) child.kill('SIGKILL');
      process.exit(code);
    }, 500);
  }
}

export async function healthy(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {signal:AbortSignal.timeout(Math.max(1, Math.min(500, deadline - Date.now())))});
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Fixture health deadline exceeded');
}
