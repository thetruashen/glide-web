import unittest,json,tempfile,sys,os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from official_launcher import prepare_profile
class OfficialTests(unittest.TestCase):
 def test_profile_has_pinned_game_and_no_credentials(self):
  with tempfile.TemporaryDirectory() as d:
   game=Path(d)/'game';work=Path(d)/'private'
   for name in ['assets','libraries','versions']:(game/name).mkdir(parents=True,exist_ok=True)
   with patch.dict(os.environ,{'GLIDE_INSTANCE_NAME':'Chocolate','GLIDE_MINECRAFT_XMX':'6G'}):prepare_profile(work,game,'1.19.2-forge-43.5.0')
   data=json.loads((work/'launcher_profiles.json').read_text());profile=data['profiles']['glide']
   self.assertEqual(profile['lastVersionId'],'1.19.2-forge-43.5.0');self.assertEqual(profile['gameDir'],str(game));self.assertNotIn('accessToken',str(data));self.assertIn('-Xmx6G',profile['javaArgs'])
