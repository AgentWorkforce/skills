// Lifecycle and private-file helpers for disposable qualification fixtures.
import fs from 'node:fs';
import {spawn} from 'node:child_process';

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
    process.once('uncaughtException', () => this.stop(1));
    process.once('unhandledRejection', () => this.stop(1));
    savePrivate(root + '/ready.json', {ready:false});
  }
  child(command, args, options) {
    const child = spawn(command, args, {...options, stdio:['ignore','inherit','inherit']});
    this.children.push(child);
    child.once('error', () => this.stop(1));
    child.once('exit', () => { if (!this.closing) this.stop(1); });
    savePrivate(this.root + '/child-pids.json', this.children.map(item => item.pid).filter(Boolean));
    return child;
  }
  listen(server, port, host) {
    this.servers.push(server);
    server.on('error', () => this.stop(1));
    return new Promise((resolve,reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
  }
  ready(value) {
    if (this.closing) throw new Error('Fixture is stopping');
    savePrivate(this.root + '/ready.json', {ready:true, ...value});
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
