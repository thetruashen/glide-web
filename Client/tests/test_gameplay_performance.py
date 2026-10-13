import hashlib,json,sys,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from gameplay_performance import owned_mods,java_flags,render_resolution

class GameplayPerformanceTests(unittest.TestCase):
 def test_legacy_runtime_ownership_preserves_user_edits(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'mods').mkdir();runtime=root/'runtime';runtime.mkdir()
   path=root/'mods'/'pigmc-old-release.jar';path.write_bytes(b'old runtime file')
   (runtime/'performance-mods.json').write_text(json.dumps([{'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}]))
   self.assertEqual(owned_mods(runtime,root),{'mods/'+path.name})
   path.write_bytes(b'user edited this');self.assertEqual(owned_mods(runtime,root),set())
 def test_gc_does_not_force_zgc_or_a_50ms_pause_target(self):
  self.assertIn('-XX:+UseG1GC',java_flags());self.assertFalse(any('UseZGC' in a or 'MaxGCPauseMillis' in a for a in java_flags()))
 def test_boost_caps_render_work_and_off_preserves_selected_resolution(self):
  self.assertEqual(render_resolution(1920,1080),(960,540));self.assertEqual(render_resolution(1280,720),(960,540));self.assertEqual(render_resolution(854,480),(854,480));self.assertEqual(render_resolution(1920,1080,False),(1920,1080))
 def test_snapshot_preserves_user_files_without_recompressing_jars(self):
  import io,session_api
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'mods').mkdir();(root/'saves').mkdir();(root/'mods'/'player.jar').write_bytes(b'original mod bytes');(root/'saves'/'world.dat').write_bytes(b'world bytes')
   with patch.object(session_api,'ROOT',root),patch.object(session_api,'RUNTIME',root/'runtime'):
    snapshot=session_api.snapshot()
   with zipfile.ZipFile(io.BytesIO(snapshot)) as archive:
    self.assertEqual(archive.read('mods/player.jar'),b'original mod bytes');self.assertEqual(archive.read('saves/world.dat'),b'world bytes');self.assertEqual(archive.getinfo('mods/player.jar').compress_type,zipfile.ZIP_STORED)
