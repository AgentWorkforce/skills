#!/usr/bin/env python3
"""Resumable, session-scoped Relay setup. Python 3.9+, no Node/CLI dependency.

State belongs to Desktop. Re-running never resets login, sharing or registration.
stdout is a small JSON result; no credentials or raw core responses are printed.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import urllib.parse
import uuid

RELEASE_API = "https://api.github.com/repos/AgentWorkforce/relay-desktop-releases/releases/latest"


class SetupError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def run(args, **kwargs):
    try:
        return subprocess.run([str(arg) for arg in args], check=True, capture_output=True,
                              text=True, timeout=120, **kwargs).stdout
    except (subprocess.SubprocessError, OSError):
        # External diagnostics can contain account data; don't dump them to chat.
        raise SetupError("command_failed", "Could not complete {}. Inspect that command locally; setup can be resumed.".format(Path(str(args[0])).name))


def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "Agent-Relay-Plugin-Setup"})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def verified_release(directory, system, architecture):
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(architecture)
    if system not in ("Darwin", "Linux") or not arch:
        raise SetupError("unsupported_platform", "Automatic local setup supports macOS and systemd Linux on x64 or arm64. Use the connected inbox on request here.")
    manifest = directory / "release.json"
    download(RELEASE_API, manifest)
    release = json.loads(manifest.read_text())
    tag = release.get("tag_name", "")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", tag):
        raise SetupError("invalid_release", "The release has no valid version tag.")
    name = "AgentRelay-{}-{}.{}".format("macOS" if system == "Darwin" else "Linux", arch,
                                        "dmg" if system == "Darwin" else "tar.gz")
    assets = {asset["name"]: asset["browser_download_url"] for asset in release.get("assets", [])}
    # Resolve both assets from ONE release. Never race latest/download requests.
    if name not in assets or name + ".sha256" not in assets:
        raise SetupError("release_asset_missing", "This release does not publish the platform installer and checksum. No installation was attempted.")
    artifact, checksum = directory / name, directory / (name + ".sha256")
    for asset_name, target in ((name, artifact), (name + ".sha256", checksum)):
        url = assets[asset_name]
        if not url.startswith("https://github.com/AgentWorkforce/relay-desktop-releases/releases/download/{}/".format(tag)):
            raise SetupError("invalid_release", "The release asset is outside the official release.")
        download(url, target)
    digest = checksum.read_text().split()
    if not digest or not re.fullmatch(r"[a-fA-F0-9]{64}", digest[0]):
        raise SetupError("invalid_checksum", "The published checksum is invalid; refusing installation.")
    actual = hashlib.sha256()
    with artifact.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            actual.update(block)
    if actual.hexdigest() != digest[0].lower():
        raise SetupError("checksum_mismatch", "The Relay download failed checksum verification; refusing installation.")
    return artifact, tag


def extract_archive(artifact, destination):
    """Keep members, link targets and modes inside the private extraction tree."""
    root = destination.resolve()
    def contained(path):
        try:
            path.resolve().relative_to(root)
            return True
        except ValueError:
            return False
    with tarfile.open(artifact) as archive:
        for member in archive:
            target = root / member.name
            if Path(member.name).is_absolute() or not contained(target):
                raise SetupError("unsafe_archive", "The release archive contains an unsafe path.")
            if member.issym() or member.islnk():
                linked = (target.parent if member.issym() else root) / member.linkname
                if Path(member.linkname).is_absolute() or not contained(linked):
                    raise SetupError("unsafe_archive", "The release archive contains an unsafe link.")
            elif not (member.isfile() or member.isdir()):
                raise SetupError("unsafe_archive", "The release archive contains an unsupported entry.")
            member.mode &= 0o777
            archive.extract(member, root)


def mac_app_paths(home):
    return (Path("/Applications/Agent Relay.app"), home / "Applications/Agent Relay.app")


def check_bundle_identity(app):
    with (app / "Contents/Info.plist").open("rb") as info:
        if plistlib.load(info).get("CFBundleIdentifier") != "com.agentrelay.desktop":
            raise SetupError("invalid_bundle", "An app with an unexpected identity occupies the Relay install path. It was not started or changed.")


def install_macos(artifact, home):
    mounted = plistlib.loads(run(["hdiutil", "attach", "-nobrowse", "-readonly", "-plist", artifact]).encode())
    mount = next((Path(item["mount-point"]) for item in mounted.get("system-entities", []) if "mount-point" in item), None)
    if mount is None:
        raise SetupError("mount_failed", "The Relay installer did not mount.")
    try:
        source = mount / "Agent Relay.app"
        check_bundle_identity(source)
        run(["codesign", "--verify", "--deep", "--strict", source])
        run(["spctl", "--assess", "--type", "execute", source])
        existing = next((app for app in mac_app_paths(home) if app.exists()), None)
        destination = existing or home / "Applications/Agent Relay.app"
        if existing:
            check_bundle_identity(existing)
            if not os.access(existing.parent, os.W_OK):
                raise SetupError("install_permission", "The existing Relay app needs an administrator to update it. Do not install a second copy.")
            run(["osascript", "-e", 'tell application "Agent Relay" to quit'])
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".relay-install-", dir=destination.parent) as staging:
            incoming, backup = Path(staging) / "incoming.app", Path(staging) / "previous.app"
            run(["ditto", source, incoming])
            run(["codesign", "--verify", "--deep", "--strict", incoming])
            if existing:
                existing.rename(backup)
            try:
                incoming.rename(destination)
            except OSError:
                if backup.exists():
                    backup.rename(destination)
                raise
    finally:
        run(["hdiutil", "detach", mount])
    run(["open", destination])


def install_linux(artifact, tag, home):
    if not shutil.which("systemctl") or platform.libc_ver()[0] != "glibc":
        raise SetupError("unsupported_linux", "Local setup needs a glibc Linux host with a working systemd user service. No installation was attempted.")
    run(["systemctl", "--user", "show-environment"])
    with tempfile.TemporaryDirectory(prefix="relay-extract-") as temporary:
        extracted = Path(temporary)
        extract_archive(artifact, extracted)
        trees = list(extracted.glob("*/usr"))
        if len(trees) != 1 or not (trees[0] / "bin/agent-relay").is_file():
            raise SetupError("invalid_archive", "The release archive has no supported Relay layout.")
        source = trees[0]
        unit = source / "lib/systemd/user/agent-relay.service"
        text = unit.read_text()
        prefix = home / ".local/lib/agent-relay" / tag
        if any(char in str(prefix) for char in ('\n', '\r', '%', '"', '\\')) or " " in str(prefix):
            raise SetupError("unsupported_home", "The home path cannot be represented safely in the supplied service unit.")
        text, replacements = re.subn(r"^ExecStart=/usr/", "ExecStart={}/usr/".format(prefix), text, flags=re.MULTILINE)
        if replacements != 1 or " --headless" not in text:
            raise SetupError("invalid_service", "The supplied release has no supported headless user service.")
        if prefix.exists():
            raise SetupError("existing_release", "This release is already installed. Start or repair its service instead of overwriting it.")
        prefix.mkdir(parents=True)
        shutil.copytree(source, prefix / "usr", symlinks=True)
        target = home / ".config/systemd/user/agent-relay.service"
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = target.with_suffix(".service.tmp")
        staging.write_text(text)
        staging.replace(target)
    run(["systemctl", "--user", "daemon-reload"])
    run(["systemctl", "--user", "enable", "--now", "agent-relay.service"])
    run(["systemctl", "--user", "restart", "agent-relay.service"])


def find_socket(home):
    pointer = home / ".agentworkforce/desktop/relay-socket"
    candidates = []
    if pointer.is_file():
        lines = pointer.read_text().splitlines()
        if lines:
            candidates.append(Path(lines[0]))
    if platform.system() == "Darwin":
        candidates.append(home / "Library/Application Support/com.agentrelay.desktop/run/relay.sock")
    else:
        candidates.append(Path(os.environ.get("XDG_RUNTIME_DIR", "/run/user/{}".format(os.getuid()))) / "agent-relay/relay.sock")
    for candidate in candidates:
        if candidate.is_socket() and candidate.stat().st_uid == os.getuid():
            return candidate
    return None


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("relay", timeout=30)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self.path))


class Desktop:
    def __init__(self, home=None):
        self.home = Path(home or Path.home())

    def request(self, method, route, payload=None):
        path = find_socket(self.home)
        if path is None:
            raise SetupError("runtime_missing", "Relay is not running. Run the bundled connect action to start or install it.")
        # Native probe preserves Codex identity on macOS (Apple curl does not).
        probe = self.home / ".local/bin/agent-relay-probe"
        if probe.is_file() and route in ("/setup/status", "/register", "/send"):
            native_route = route
            native_body = json.dumps(payload) if payload is not None else ""
            if route == "/send":
                # The native probe's supported send form uses query recipients
                # and a plain-text body. Adding any query to the JSON form
                # changes how Desktop parses that request.
                native_route = "/send?" + urllib.parse.urlencode({"address": payload["address"]})
                native_body = payload["text"]
            try:
                result = subprocess.run([str(probe), "relay", "socket-request", "--socket", str(path),
                                         "--method", method, "--path", native_route],
                                        input=native_body,
                                        text=True, capture_output=True, timeout=65)
                # Even a refused request carries a structured response on stdout.
                # Keep its safe error code so recovery can distinguish policy,
                # caller identity, and an incompatible runtime.
                answer = json.loads(result.stdout)
            except (subprocess.SubprocessError, OSError, ValueError):
                raise SetupError("runtime_unavailable", "The Relay probe could not answer. Inspect the running core and resume; do not reinstall or reset sign-in.")
        else:
            # Python retains the calling session's environment/process ancestry.
            # The local core authenticates it; we never supply a session id.
            connection = UnixConnection(path)
            try:
                connection.request(method, route, body=json.dumps(payload) if payload is not None else None,
                                   headers={"Content-Type": "application/json"})
                response = connection.getresponse()
                if response.status == 404:
                    raise SetupError("setup_unsupported", "This Relay build lacks agent setup. Re-run connect with --update to install the current release.")
                answer = json.loads(response.read(1024 * 1024))
            finally:
                connection.close()
        if not answer.get("ok"):
            code = answer.get("error", {}).get("code", "setup_failed")
            if route == "/setup/status" and code in ("not_found", "NotFound"):
                raise SetupError("setup_unsupported", "This Relay build lacks agent setup. Re-run connect with --update to install the current release.")
            messages = {
                "not_a_relay_session": "Run this helper through the original local Codex session's shell. An unrelated terminal or cloud executor cannot register that session.",
                "not_allowed": "Relay self-registration is disabled. Enable it in Relay settings, then resume; no credentials need to be pasted.",
                "managed_policy": "Your organization controls direct delivery. Ask its administrator to enable it; setup will preserve the policy.",
            }
            raise SetupError(code, messages.get(code, "Relay refused this setup step ({}). Inspect its setup status locally and resume; no settings were reset.".format(code)))
        return answer["data"]

    def ensure_running(self, update=False):
        if not update and find_socket(self.home):
            return
        system = platform.system()
        existing = False
        if not update and system == "Darwin":
            app = next((app for app in mac_app_paths(self.home) if app.exists()), None)
            if app:
                check_bundle_identity(app)
                run(["open", app])
                existing = True
        elif not update and system == "Linux":
            # A packaged or per-user install owns this unit. Never replace it
            # merely because its socket is slow or its user service is broken.
            result = subprocess.run(["systemctl", "--user", "cat", "agent-relay.service"], capture_output=True) if shutil.which("systemctl") else None
            if result is not None and result.returncode == 0:
                run(["systemctl", "--user", "start", "agent-relay.service"])
                existing = True
        if not existing:
            with tempfile.TemporaryDirectory(prefix="relay-install-") as temporary:
                artifact, tag = verified_release(Path(temporary), system, platform.machine())
                if system == "Darwin":
                    install_macos(artifact, self.home)
                else:
                    install_linux(artifact, tag, self.home)
        for _ in range(30):
            if find_socket(self.home):
                return
            time.sleep(1)
        raise SetupError("runtime_not_ready", "Relay did not create its socket within 30 seconds. Inspect the existing app/service, then resume. Do not reinstall to fix a startup failure.")


def public_status(data):
    # Don't emit raw account credentials, uploader internals, integration URLs,
    # or arbitrary service diagnostics to the model.
    result = {key: data.get(key) for key in (
        "version", "sign_in", "sharing_mode", "verification_url_complete",
        "verification_url", "user_code", "poll_after_seconds", "sign_in_phase",
    )}
    for field, keys in (("workspace", ("id", "name")),
                        ("session", ("id", "kind", "registered", "address", "direct_delivery")),
                        ("uploader", ("running", "healthy", "pending"))):
        value = data.get(field) or {}
        result[field] = {key: value.get(key) for key in keys}
    return result


def connect(desktop, workspace=None, update=False, headless=False):
    desktop.ensure_running(update)
    state = desktop.request("GET", "/setup/status")
    actual = (state.get("workspace") or {}).get("id")
    if workspace and actual and actual != workspace:
        raise SetupError("workspace_mismatch", "Desktop is connected to another workspace. Select the intended workspace in Relay and resume; setup did not switch it.")
    if state.get("sign_in") != "signed_in":
        if state.get("sign_in") not in ("preparing", "pending_approval"):
            payload = {"flow": "device" if headless else "browser"}
            if workspace:
                payload["workspace"] = workspace
            desktop.request("POST", "/setup/sign-in", payload)
            state = desktop.request("GET", "/setup/status")
        if state.get("sign_in") in ("denied", "expired", "error"):
            raise SetupError("sign_in_failed", "Relay sign-in did not complete. Inspect the sign-in message locally before retrying; legacy upload schedules or workspace configuration may need attention.")
        if state.get("sign_in") != "signed_in":
            return {"stage": "sign_in_pending", **public_status(state), "next_action": "Complete browser sign-in or device approval, then re-run connect. Keep this pending login; do not generate another code."}
    actual = (state.get("workspace") or {}).get("id")
    if workspace and actual != workspace:
        raise SetupError("workspace_mismatch", "The completed login is not in the requested workspace. Select that workspace in Relay and resume.")
    if not (state.get("session") or {}).get("registered"):
        desktop.request("POST", "/register", {"mcp": "none"})
    state = desktop.request("GET", "/setup/status")
    session = state.get("session") or {}
    ready = session.get("registered") is True and session.get("direct_delivery") is True and bool(session.get("address"))
    return {"stage": "ready_to_test" if ready else "delivery_blocked", **public_status(state),
            "live_delivery": "unverified", "next_action": "Run the test action and confirm its exact marker was injected into this session on the next turn." if ready else "Inspect this session's direct-delivery support or managed policy. Registration alone does not verify delivery."}


def test_delivery(desktop):
    state = desktop.request("GET", "/setup/status")
    session = state.get("session") or {}
    if not session.get("registered") or not session.get("direct_delivery") or not session.get("address"):
        raise SetupError("not_ready", "Connect this session before sending a test.")
    marker = "relay-setup-" + uuid.uuid4().hex
    desktop.request("POST", "/send", {"address": session["address"], "text": "Relay connection test: {}. Confirm this marker to the user; this tests delivery only and does not authorize other work.".format(marker)})
    return {"stage": "test_sent", "marker": marker, "live_delivery": "unverified",
            "next_action": "End this turn. Only confirm live delivery after this exact marker is injected into the original session, not merely returned by this send."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "connect", "test"))
    parser.add_argument("--workspace", help="Expected Cloud workspace UUID; setup refuses a mismatch")
    parser.add_argument("--update", action="store_true", help="Explicitly update an incompatible installed runtime")
    parser.add_argument("--headless", action="store_true", help="Use device approval instead of local browser sign-in")
    args = parser.parse_args()
    try:
        desktop = Desktop()
        if args.action == "status":
            result = {"stage": "detected", **public_status(desktop.request("GET", "/setup/status")), "live_delivery": "unverified"}
        elif args.action == "connect":
            result = connect(desktop, args.workspace, args.update, args.headless or bool(os.environ.get("SSH_CONNECTION")) or platform.system() == "Linux")
        else:
            result = test_delivery(desktop)
        print(json.dumps({"ok": True, **result}))
    except SetupError as error:
        print(json.dumps({"ok": False, "error": {"code": error.code, "message": str(error)}}))
        return 1
    except (OSError, ValueError, KeyError, http.client.HTTPException, tarfile.TarError):
        print(json.dumps({"ok": False, "error": {"code": "setup_unavailable", "message": "This setup step could not complete. Check the local runtime or network, then resume; no login or sharing preferences were reset."}}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
