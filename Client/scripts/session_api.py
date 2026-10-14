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
ALLOWED = {"saves", "mods", "config", "resourcepacks", "shaderpacks", "datapacks", "kubejs", "scripts", "defaultconfigs", "patchouli_books", "fancymenu", "openloader", "paxi", "global_packs", "packmenu", "journeymap"}
FILES = {"options.txt", "optionsof.txt", "servers.dat"}
MAX_BYTES = 4096 * 1024 * 1024
LOCK = threading.RLock()
DOWNLOAD_HOSTS = {'cdn.modrinth.com','edge.forgecdn.net','mediafilez.forgecdn.net','media.forgecdn.net','github.com','raw.githubusercontent.com','gitlab.com','release-assets.githubusercontent.com','objects.githubusercontent.com'}


def catalog_download(url, expected_size=0):
    import requests
    for _ in range(5):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in DOWNLOAD_HOSTS or parsed.username or parsed.password or parsed.port not in (None,443):
            raise ValueError('Unsupported download host')
        with requests.get(url, stream=True, allow_redirects=False, timeout=(15,120)) as response:
            if response.is_redirect:
                from urllib.parse import urljoin
                url = urljoin(url, response.headers['Location'])
                continue
            response.raise_for_status()
            declared=int(response.headers.get('Content-Length','0'))
            if declared>MAX_BYTES or expected_size>MAX_BYTES:
                raise ValueError('File exceeds download limit')
            result=io.BytesIO()
            for chunk in response.iter_content(1024*1024):
                if result.tell()+len(chunk)>MAX_BYTES: raise ValueError('File exceeds download limit')
                result.write(chunk)
            if expected_size and result.tell()!=expected_size: raise ValueError('File size mismatch')
            return result.getvalue()
    raise ValueError('Too many download redirects')


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
    from gameplay_performance import owned_mods
    managed=owned_mods(RUNTIME,ROOT)
    with LOCK, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for name in sorted(ALLOWED | FILES):
            path = ROOT / name
            paths = path.rglob("*") if path.is_dir() else [path]
            for child in paths:
                if child.is_file() and not child.is_symlink():
                    if child.relative_to(ROOT).as_posix() in managed:continue
                    archive.write(child, child.relative_to(ROOT))
    if out.tell() > MAX_BYTES:
        raise ValueError("Profile snapshot exceeds 4 GiB")
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
            self.send_header("Set-Cookie", f"glide_session={token}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=21600")
            width=max(640,min(int(os.environ.get('GLIDE_RENDER_WIDTH','1280')),1920))
            height=max(360,min(int(os.environ.get('GLIDE_RENDER_HEIGHT','720')),1080))
            self.send_header("Location", f"/?manual_resolution=true&manual_width={width}&manual_height={height}&scaleLocallyManual=true&useCssScaling=true")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if (route.path not in {'/glide-api/check','/glide-api/player.js'} and not self.headers.get('Authorization', '').startswith('Bearer ')) or not self.authorized():
            self.reply(401, {"error": "Unauthorized"})
            return
        if route.path == '/glide-api/player.js':
            data=(Path(__file__).resolve().parents[1]/'assets'/'player.js').read_bytes()
            self.headers_out(200,'text/javascript; charset=utf-8',len(data))
            self.wfile.write(data)
        elif route.path == "/glide-api/check":
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
        # Cookie auth is only for the streaming gateway; profile mutations must
        # carry the browser capability explicitly, preventing cross-site forms.
        if not self.headers.get('Authorization', '').startswith('Bearer ') or not self.authorized():
            self.reply(401, {"error": "Unauthorized"})
            return
        route = urlsplit(self.path).path
        if route == '/glide-api/catalog-file':
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=4096: raise ValueError('Invalid request')
                request=json.loads(self.rfile.read(length))
                data=catalog_download(request['url'],max(0,int(request.get('size') or 0)))
                self.headers_out(200,'application/octet-stream',len(data));self.wfile.write(data)
            except Exception:
                self.reply(400,{'error':'Download refused or unavailable. Use the official manual download page.'})
            return
        upload = re.fullmatch(r'/glide-api/upload/([a-f0-9-]{36})/(\d{1,3})', route)
        finish = re.fullmatch(r'/glide-api/import/([a-f0-9-]{36})/(\d{1,3})', route)
        if upload or finish:
            if (RUNTIME / 'start').exists():
                self.reply(409, {'error': 'Session already started'})
                return
            try:
                match = upload or finish
                folder = RUNTIME / ('upload-' + match[1])
                index = int(match[2])
                if index > 512 or (upload and index >= 512):
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
                            raise ValueError('Profile exceeds 4 GiB')
                    self.reply(200, {'chunk': index})
                else:
                    if not 1 <= index <= 512:
                        raise ValueError('Invalid chunk count')
                    with LOCK:
                        data = b''.join((folder / str(i)).read_bytes() for i in range(index))
                        if len(data) > MAX_BYTES:
                            raise ValueError('Profile exceeds 4 GiB')
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
                    self.reply(413, {"error": "Profile must be under 4 GiB"})
                    return
                data = self.rfile.read(length)
                with LOCK:
                    extract_archive(data, ROOT)
                self.reply(200, {"uploaded": True})
            except (ValueError, OSError, zipfile.BadZipFile):
                self.reply(400, {"error": "Invalid profile ZIP"})
        elif route == '/glide-api/account':
            if (RUNTIME / 'start').exists():
                self.reply(409, {'error':'Session already started'})
                return
            try:
                from browser_account import validate_account
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<20000:raise ValueError('Invalid account payload')
                data=json.loads(self.rfile.read(length))
                validate_account(data)
                path=RUNTIME/'account.json'
                with LOCK:
                    path.write_text(json.dumps(data))
                    path.chmod(0o600)
                self.reply(200,{'ready':True})
            except (ValueError,TypeError,OSError):
                self.reply(400,{'error':'Invalid or expired Minecraft sign-in. Sign in again.'})
        elif route == "/glide-api/start":
            (RUNTIME / "start").touch()
            self.reply(200, {"started": True})
        elif route in {"/glide-api/stop","/glide-api/force-stop"}:
            from session_control import request_stop
            request_stop(RUNTIME,force=route.endswith('force-stop'))
            self.reply(200,{"stopping":True})
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
