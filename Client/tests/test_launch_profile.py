import json,tempfile,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from launch_profile import components_for

class LaunchProfileTests(unittest.TestCase):
 def prepare(self,root,identifier,base,libraries=()):
  path=Path(root)/'versions'/identifier;path.mkdir(parents=True)
  (path/f'{identifier}.json').write_text(json.dumps({'inheritsFrom':base,'libraries':[{'name':name} for name in libraries]}))
 def test_every_loader_is_preserved_when_the_installer_omits_a_coordinate(self):
  for loader,identifier,pin in [('forge','1.19.2-forge-43.5.0','43.5.0'),('neoforge','neoforge-21.1.258','21.1.258'),('fabric','fabric-loader-0.16.14-1.19.2','0.16.14'),('quilt','quilt-loader-0.28.1-1.19.2','0.28.1')]:
   with self.subTest(loader=loader),tempfile.TemporaryDirectory() as root:
    self.prepare(root,identifier,'1.19.2')
    self.assertEqual(components_for(root,identifier,'1.19.2',loader,pin)[1]['version'],pin)
 def test_modded_vanilla_fallback_and_wrong_version_are_rejected(self):
  with tempfile.TemporaryDirectory() as root:
   self.prepare(root,'1.19.4','1.19.4')
   with self.assertRaises(ValueError):components_for(root,'1.19.4','1.19.4','forge')
   with self.assertRaises(ValueError):components_for(root,'1.19.4','1.19.2','forge')
 def test_wrong_pinned_loader_is_rejected(self):
  with tempfile.TemporaryDirectory() as root:
   self.prepare(root,'1.19.2-forge-43.5.0','1.19.2')
   with self.assertRaises(ValueError):components_for(root,'1.19.2-forge-43.5.0','1.19.2','forge','43.4.0')
