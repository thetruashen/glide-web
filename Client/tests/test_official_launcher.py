import unittest,json,tempfile,sys,os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from official_launcher import prepare_profile,find_game_pid
from types import SimpleNamespace
class OfficialTests(unittest.TestCase):
 def test_java_probe_is_not_reported_as_minecraft(self):
  game=Path('/tmp/glide-minecraft')
  with patch('official_launcher.subprocess.run',return_value=SimpleNamespace(stdout='123\n')),patch('official_launcher.Path.resolve',side_effect=[Path('/tmp/prism-data'),game]):
   self.assertIsNone(find_game_pid(game))
 def test_profile_has_pinned_game_and_no_credentials(self):
  with tempfile.TemporaryDirectory() as d:
   game=Path(d)/'game';work=Path(d)/'private'
   for name in ['assets','libraries','versions']:(game/name).mkdir(parents=True,exist_ok=True)
   version=game/'versions'/'1.19.2-forge-43.5.0';version.mkdir();(version/'1.19.2-forge-43.5.0.json').write_text(json.dumps({'inheritsFrom':'1.19.2','libraries':[{'name':'net.minecraftforge:forge:1.19.2-43.5.0'}]}))
   with patch.dict(os.environ,{'GLIDE_INSTANCE_NAME':'Chocolate','GLIDE_MINECRAFT_XMX':'6G'}):prepare_profile(work,game,'1.19.2-forge-43.5.0')
   data=json.loads((work/'instances'/'glide'/'mmc-pack.json').read_text())
   self.assertEqual(data['components'][1],{'uid':'net.minecraftforge','version':'43.5.0'})
   self.assertEqual(data['components'][0]['version'],'1.19.2')
   self.assertNotIn('accessToken',str(data))
   self.assertIn('MaxMemAlloc=6144',(work/'instances'/'glide'/'instance.cfg').read_text())
