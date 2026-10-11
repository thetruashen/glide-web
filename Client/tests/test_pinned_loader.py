import hashlib
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import Mock, patch
import minecraft_launcher_lib

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/install_pinned_loader.py'

class PinnedLoaderTests(unittest.TestCase):
    def test_install_writes_exact_profile_and_reuses_matching_warmed_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            loader=Mock()
            loader.get_loader_versions.return_value=['21.1.258']
            loader.get_installed_version.return_value='neoforge-21.1.258'
            def install(*args,**kwargs):
                self.assertEqual(kwargs['loader_version'],'21.1.258')
                path=Path(directory)/'versions/neoforge-21.1.258';path.mkdir(parents=True)
                (path/'neoforge-21.1.258.json').write_text('{}')
                return 'neoforge-21.1.258'
            loader.install.side_effect=install
            with patch.dict(os.environ,{'GLIDE_MINECRAFT_VERSION':'1.21.1','GLIDE_MINECRAFT_LOADER':'neoforge','GLIDE_LOADER_VERSION':'21.1.258','GLIDE_MINECRAFT_DIR':directory}),patch.object(minecraft_launcher_lib.mod_loader,'get_mod_loader',return_value=loader):
                runpy.run_path(str(SCRIPT),run_name='__main__')
                marker=json.loads((Path(directory)/'.glide-install/1.21.1-neoforge.json').read_text())
                self.assertEqual(marker['launch_version'],'neoforge-21.1.258')
                self.assertEqual(marker['fingerprint'],hashlib.sha256(SCRIPT.with_name('glide_launch.py').read_bytes()).hexdigest())
                with self.assertRaises(SystemExit) as exit_result: runpy.run_path(str(SCRIPT),run_name='__main__')
                self.assertEqual(exit_result.exception.code,0)
                self.assertEqual(loader.install.call_count,1)

    def test_invalid_pin_is_rejected_without_writing_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            loader=Mock();loader.get_loader_versions.return_value=['21.1.258'];loader.get_installed_version.return_value='neoforge-invalid'
            with patch.dict(os.environ,{'GLIDE_MINECRAFT_VERSION':'1.21.1','GLIDE_MINECRAFT_LOADER':'neoforge','GLIDE_LOADER_VERSION':'invalid','GLIDE_MINECRAFT_DIR':directory}),patch.object(minecraft_launcher_lib.mod_loader,'get_mod_loader',return_value=loader):
                with self.assertRaises(ValueError):runpy.run_path(str(SCRIPT),run_name='__main__')
                loader.install.assert_not_called()
                self.assertFalse((Path(directory)/'.glide-install').exists())
