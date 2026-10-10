import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from session_api import extract_archive

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

if __name__ == '__main__':
    unittest.main()
