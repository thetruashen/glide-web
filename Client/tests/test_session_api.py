import io
import sys
import tempfile
import unittest
import zipfile
import threading
import os
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from session_api import extract_archive
import session_api

def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as z:
        for name, content in entries:
            z.writestr(name, content)
    result = data.getvalue()
    # Windows' ZipInfo normalizes backslashes; simulate a ZIP made on Linux.
    for name, _ in entries:
        if '\\' in name:
            result = result.replace(name.replace('\\', '/').encode(), name.encode())
    return result

class ProfileTests(unittest.TestCase):
    def test_world_and_mod_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            extract_archive(archive([('saves/My World/level.dat', b'world'), ('mods/test.jar', b'mod'), ('options.txt', b'options')]), root)
            self.assertEqual((root / 'saves/My World/level.dat').read_bytes(), b'world')
            self.assertEqual((root / 'mods/test.jar').read_bytes(), b'mod')

    def test_rejects_traversal_and_system_files_before_any_write(self):
        for path in ['../escape', '/etc/passwd', 'mods/../../escape', 'mods\\escape', 'versions/poison.json', 'C:/escape']:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaises(ValueError):
                    extract_archive(archive([('mods/good.jar', b'good'), (path, b'bad')]), root)
                self.assertEqual(list(root.iterdir()), [])

    def test_rejects_symlinks(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            info = zipfile.ZipInfo('mods/evil.jar')
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            z.writestr(info, '/etc/passwd')
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            extract_archive(out.getvalue(), Path(directory))

    def test_authenticated_chunk_upload_and_snapshot_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'game'; root.mkdir()
            runtime = Path(directory) / 'runtime'; runtime.mkdir()
            (runtime / 'secret').write_text('private-session-capability')
            with patch.object(session_api, 'ROOT', root), patch.object(session_api, 'RUNTIME', runtime), patch.dict(os.environ, {'GLIDE_WEB_ORIGIN': 'https://example.com'}):
                server = ThreadingHTTPServer(('127.0.0.1', 0), session_api.Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
                origin = 'http://127.0.0.1:' + str(server.server_port)
                def request(path, data=None, token='private-session-capability'):
                    return urlopen(Request(origin + '/glide-api/' + path, data=data, headers={'Authorization': 'Bearer ' + token, 'Origin': 'https://example.com'}), timeout=5)
                try:
                    with self.assertRaises(HTTPError) as denied:
                        request('status', token='another-player')
                    self.assertEqual(denied.exception.code, 401)
                    with self.assertRaises(HTTPError) as csrf:
                        urlopen(Request(origin + '/glide-api/start', data=b'ignored', headers={'Cookie': 'glide_session=private-session-capability'}), timeout=5)
                    self.assertEqual(csrf.exception.code, 401)
                    self.assertFalse((runtime / 'start').exists())
                    data = archive([('saves/World/level.dat', b'private-world'), ('mods/test.jar', b'private-mod')])
                    upload_id = '12345678-1234-1234-1234-123456789abc'
                    with request(f'upload/{upload_id}/0', data) as response:
                        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://example.com')
                    request(f'import/{upload_id}/1', b'{}').close()
                    request('start', b'{}').close()
                    with self.assertRaises(HTTPError) as blocked:
                        request(f'upload/{upload_id}/0', data)
                    self.assertEqual(blocked.exception.code, 409)
                    with request('profile') as response:
                        result = zipfile.ZipFile(io.BytesIO(response.read()))
                        self.assertEqual(result.read('saves/World/level.dat'), b'private-world')
                        self.assertNotIn('versions', result.namelist())
                    self.assertFalse(any(runtime.glob('upload-*')))
                finally:
                    server.shutdown(); server.server_close(); thread.join(timeout=5)

if __name__ == '__main__':
    unittest.main()
