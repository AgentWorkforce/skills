"""Supervise a real Pi PTY using only a dedicated private qualification home."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import time


def write_new(path, value):
    """Refuse to overwrite existing config, including symlinks."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)


def configure(root):
    """Keep the person's HOME untouched; prepare the same home used by the core."""
    home = root / 'pi-home'
    agent = home / '.pi/agent'
    for directory in (home, home / '.pi', agent):
        if directory.is_symlink():
            raise ValueError('Invalid qualification home')
        directory.mkdir(exist_ok=True, mode=0o700)
        if not directory.is_dir() or directory.stat().st_uid != os.getuid():
            raise ValueError('Invalid qualification home')
        directory.chmod(0o700)
    files = [agent / 'models.json', agent / 'settings.json']
    if any(path.exists() or path.is_symlink() for path in files):
        raise ValueError('Use a fresh qualification home; existing Pi config is preserved')
    models = {'providers': {'relay-test': {'baseUrl': 'http://127.0.0.1:8099/v1',
        'api': 'openai-completions', 'apiKey': 'synthetic-fixture-value',
        'models': [{'id': 'test', 'contextWindow': 128000, 'maxTokens': 1024}]}}}
    write_new(files[0], models)
    write_new(files[1], {'quietStartup': True, 'lastChangelogVersion': '999.0.0',
                       'defaultProvider': 'relay-test', 'defaultModel': 'test'})
    return home, agent


def drain(master, control_fd, process, output, stop_deadline=lambda: None):
    """Drain buffered PTY output even when the child has already exited."""
    while True:
        deadline = stop_deadline()
        if deadline is not None and time.monotonic() >= deadline and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        watched = [master] + ([control_fd] if process.poll() is None else [])
        ready, _, _ = select.select(watched, [], [], 1)
        if control_fd in ready:
            os.write(master, os.read(control_fd, 65536))
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output.write(data)
        elif process.poll() is not None:
            break


def main():
    root = Path(os.environ.get('RELAY_TEST_ROOT', '/app/relay-test'))
    if any((root / name).exists() or (root / name).is_symlink()
           for name in ('pi-session.jsonl', 'pi-input', 'pi-pid.json', 'pi-terminal.log')):
        raise ValueError('Use fresh qualification runtime paths')
    home, agent = configure(root)
    master, slave = pty.openpty()
    env = dict(os.environ, HOME=str(home), TERM='xterm-256color', PI_SKIP_VERSION_CHECK='1',
               PI_CODING_AGENT_DIR=str(agent))
    process = subprocess.Popen(['node', '/opt/pi-test/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        '--provider', 'relay-test', '--model', 'test', '--no-skills', '--no-prompt-templates', '--no-themes',
        '--session', str(root / 'pi-session.jsonl')], cwd='/app/shared', stdin=slave, stdout=slave,
        stderr=slave, env=env, start_new_session=True)
    # Keep our slave handle until draining finishes; some PTYs discard queued
    # bytes when the last slave closes immediately after child exit.
    control_fd = None
    stop_by = [None]
    def stop(*_args):
        if stop_by[0] is None:
            stop_by[0] = time.monotonic() + 2
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    signal.signal(signal.SIGTERM, stop)
    try:
        control = root / 'pi-input'
        os.mkfifo(control, 0o600)
        control_fd = os.open(control, os.O_RDWR | os.O_NONBLOCK)
        write_new(root / 'pi-pid.json', {'pid': process.pid})
        with open(root / 'pi-terminal.log', 'ab', buffering=0) as output:
            drain(master, control_fd, process, output, lambda: stop_by[0])
        return process.wait(timeout=5)
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        os.close(master)
        os.close(slave)
        if control_fd is not None:
            os.close(control_fd)


if __name__ == '__main__':
    raise SystemExit(main())
