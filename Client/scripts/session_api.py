"""Ephemeral, capability-authenticated runner storage. No repository writes."""
import base64
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import signal
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(os.environ.get("GLIDE_MINECRAFT_DIR", "/home/runner/glide-minecraft"))
RUNTIME = Path(os.environ.get("GLIDE_SESSION_DIR", "/tmp/glide-session"))
ALLOWED = {"saves", "mods", "config", "resourcepacks", "shaderpacks", "datapacks"}
FILES = {"options.txt", "optionsof.txt", "servers.dat"}
MAX_BYTES = 512 * 1024 * 1024
LOCK = threading.RLock()


def extract_archive(data, root):
    """Validate the entire archive before extracting; disallow traversal and symlinks."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 100000 or sum(m.file_size for m in members) > MAX_BYTES * 2:
            raise ValueError("Expanded profile exceeds 1 GiB or 100,000 files")
        for member in members:
            path = PurePosixPath(member.filename)
            if (not path.parts or path.is_absolute() or ".." in path.parts
                    or "\\" in member.orig_filename or ":" in member.orig_filename
                    or ((member.external_attr >> 16) & 0o170000) == 0o120000
                    or not (path.parts[0] in ALLOWED or str(path) in FILES)):
                raise ValueError("Invalid profile path")
            target = root.joinpath(*path.parts)
            if not target.resolve().is_relative_to(root.resolve()):
                raise ValueError("Invalid profile destination")
        archive.extractall(root)


def snapshot():
    out = io.BytesIO()
    with LOCK, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for name in sorted(ALLOWED | FILES):
            path = ROOT / name
            paths = path.rglob("*") if path.is_dir() else [path]
            for child in paths:
                if child.is_file() and not child.is_symlink():
                    archive.write(child, child.relative_to(ROOT))
    if out.tell() > MAX_BYTES:
        raise ValueError("Profile snapshot exceeds 512 MiB")
    return out.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # URLs, cookies and capabilities must never enter public Actions logs.

    def headers_out(self, code, content_type="application/json", size=None):
        self.send_response(code)
        if self.headers.get("Origin") == os.environ["GLIDE_WEB_ORIGIN"]:
            self.send_header("Access-Control-Allow-Origin", os.environ["GLIDE_WEB_ORIGIN"])
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", content_type)
        if size is not None:
            self.send_header("Content-Length", str(size))
        self.end_headers()

    def reply(self, code, value):
        data = json.dumps(value).encode()
        self.headers_out(code, size=len(data))
        self.wfile.write(data)

    def authorized(self):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if not token:
            cookies = dict(part.strip().split("=", 1) for part in self.headers.get("Cookie", "").split(";") if "=" in part)
            token = cookies.get("glide_session", "")
        return secrets.compare_digest(token, (RUNTIME / "secret").read_text())

    def do_OPTIONS(self):
        self.headers_out(204, size=0)

    def do_GET(self):
        route = urlsplit(self.path)
        if route.path == "/glide-api/login":
            token = parse_qs(route.query).get("ticket", [""])[0]
            if not secrets.compare_digest(token, (RUNTIME / "secret").read_text()):
                self.reply(401, {"error": "Unauthorized"})
                return
            self.send_response(302)
            self.send_header("Set-Cookie", f"glide_session={token}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=21600")
            self.send_header("Location", "/")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if not self.authorized():
            self.reply(401, {"error": "Unauthorized"})
            return
        if route.path == "/glide-api/check":
            self.headers_out(204, size=0)
        elif route.path == "/glide-api/status":
            log = Path("/tmp/glide-launch.log")
            text = log.read_text(errors="replace")[-100000:] if log.exists() else ""
            stage = re.findall(r"GLIDE_STAGE=([^\r\n]+)", text)
            pid = re.findall(r"MINECRAFT_PID=(\d+)", text)
            result = {"stage": stage[-1] if stage else "waiting-for-profile", "started": (RUNTIME / "start").exists(), "finished": (RUNTIME / "finished").exists()}
            codes = re.findall(r'MINECRAFT_EXIT_CODE=(-?\d+)', text)
            if codes:
                result['exitCode'] = int(codes[-1])
            if result['finished'] and ('Traceback (most recent call last)' in text or (codes and int(codes[-1]) != 0)):
                result['error'] = 'Minecraft failed to start or exited with an error. Check mod compatibility and try a vanilla profile.'
            for key in ("MICROSOFT_LOGIN_URL", "MICROSOFT_LOGIN_CODE", "MINECRAFT_ACCOUNT_NAME"):
                values = re.findall(re.escape(key) + r"=([^\r\n]+)", text)
                if values:
                    result[key] = values[-1]
            if pid:
                result["pid"] = int(pid[-1])
            self.reply(200, result)
        elif route.path == "/glide-api/profile":
            try:
                data = snapshot()
                self.headers_out(200, "application/zip", len(data))
                self.wfile.write(data)
            except (ValueError, OSError):
                self.reply(409, {"error": "Save is changing; retry the snapshot"})
        else:
            self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if not self.authorized():
            self.reply(401, {"error": "Unauthorized"})
            return
        route = urlsplit(self.path).path
        upload = re.fullmatch(r'/glide-api/upload/([a-f0-9-]{36})/(\d{1,2})', route)
        finish = re.fullmatch(r'/glide-api/import/([a-f0-9-]{36})/(\d{1,2})', route)
        if upload or finish:
            if (RUNTIME / 'start').exists():
                self.reply(409, {'error': 'Session already started'})
                return
            try:
                match = upload or finish
                folder = RUNTIME / ('upload-' + match[1])
                index = int(match[2])
                if index > 64:
                    raise ValueError('Too many chunks')
                if upload:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 8 * 1024 * 1024:
                        raise ValueError('Invalid chunk size')
                    with LOCK:
                        # One upload attempt at a time keeps temporary disk use bounded.
                        import shutil
                        for previous in RUNTIME.glob('upload-*'):
                            if previous != folder:
                                shutil.rmtree(previous)
                        folder.mkdir(exist_ok=True)
                        part = folder / str(index)
                        data = self.rfile.read(length)
                        if len(data) != length:
                            raise ValueError('Incomplete chunk')
                        part.write_bytes(data)
                        if sum(p.stat().st_size for p in folder.iterdir()) > MAX_BYTES:
                            shutil.rmtree(folder)
                            raise ValueError('Profile exceeds 512 MiB')
                    self.reply(200, {'chunk': index})
                else:
                    if not 1 <= index <= 64:
                        raise ValueError('Invalid chunk count')
                    with LOCK:
                        data = b''.join((folder / str(i)).read_bytes() for i in range(index))
                        if len(data) > MAX_BYTES:
                            raise ValueError('Profile exceeds 512 MiB')
                        extract_archive(data, ROOT)
                        import shutil
                        shutil.rmtree(folder)
                    self.reply(200, {'uploaded': True})
            except (ValueError, OSError, zipfile.BadZipFile):
                self.reply(400, {'error': 'Invalid or incomplete profile upload'})
        elif route == "/glide-api/profile":
            if (RUNTIME / "start").exists():
                self.reply(409, {"error": "Session already started"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > MAX_BYTES:
                    self.reply(413, {"error": "Profile must be under 512 MiB"})
                    return
                data = self.rfile.read(length)
                with LOCK:
                    extract_archive(data, ROOT)
                self.reply(200, {"uploaded": True})
            except (ValueError, OSError, zipfile.BadZipFile):
                self.reply(400, {"error": "Invalid profile ZIP"})
        elif route == "/glide-api/start":
            (RUNTIME / "start").touch()
            self.reply(200, {"started": True})
        elif route == "/glide-api/stop":
            text = Path("/tmp/glide-launch.log").read_text(errors="replace") if Path("/tmp/glide-launch.log").exists() else ""
            pids = re.findall(r"MINECRAFT_PID=(\d+)", text)
            if pids:
                try:
                    os.kill(int(pids[-1]), signal.SIGTERM)
                except ProcessLookupError:
                    pass
            (RUNTIME / "stop").touch()
            self.reply(200, {"stopping": True})
        else:
            self.reply(404, {"error": "Not found"})


def bootstrap():
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    config = json.loads(os.environ["GLIDE_REQUEST"])
    key = serialization.load_der_public_key(base64.b64decode(config["publicKey"]))
    payload = json.dumps({"url": Path("/tmp/glide-session-url.txt").read_text().strip(), "secret": (RUNTIME / "secret").read_text()}, separators=(",", ":")).encode()
    encrypted = key.encrypt(payload, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("envelope=" + base64.b64encode(encrypted).decode() + "\n")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "bootstrap":
        bootstrap()
    else:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        (RUNTIME / "secret").write_text(secrets.token_urlsafe(32))
        ROOT.mkdir(parents=True, exist_ok=True)
        ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
