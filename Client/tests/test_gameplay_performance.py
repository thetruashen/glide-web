import hashlib,json,sys,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from gameplay_performance import install,metadata,owned_mods,satisfies,java_flags

class GameplayPerformanceTests(unittest.TestCase):
 def jar(self,path,id='embeddium',minimum='[47.0,)'):
  with zipfile.ZipFile(path,'w') as jar:jar.writestr('META-INF/mods.toml',f'[[mods]]\nmodId="{id}"\n[[dependencies.{id}]]\nmodId="forge"\nmandatory=true\nversionRange="{minimum}"\n')
 def test_installed_ids_and_loader_ranges_are_checked(self):
  self.assertTrue(satisfies('47.4.5','[47.0,)'));self.assertFalse(satisfies('43.5.0','[47.0,)'));self.assertTrue(satisfies('0.16.9','>=0.16.0'));self.assertFalse(satisfies('0.15.0','>=0.16.0'));self.assertFalse(satisfies('1.20.1','unknown-rule'))
 def test_existing_renderer_is_not_replaced_and_unavailable_mods_are_nonfatal(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'mods').mkdir();self.jar(root/'mods'/'original.jar','rubidium');before=(root/'mods'/'original.jar').read_bytes()
   with patch('gameplay_performance.get_json',return_value=[]),patch('gameplay_performance.verified_file') as fetch:
    result=install(root,'1.20.1','forge','47.4.5',17,cache=root/'cache',runtime=root/'runtime')
    fetch.assert_not_called();self.assertEqual(result['added'],[]);self.assertEqual((root/'mods'/'original.jar').read_bytes(),before)
 def test_managed_mod_is_excluded_only_while_its_hash_matches(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'mods').mkdir();self.jar(root/'source.jar')
   release={'id':'safe-id','version_type':'release','version_number':'test','game_versions':['1.20.1'],'loaders':['forge'],'dependencies':[],'files':[{'primary':True}]}
   with patch('gameplay_performance.get_json',side_effect=lambda path,params:[release] if 'embeddium' in path else []),patch('gameplay_performance.verified_file',return_value=root/'source.jar'):
    result=install(root,'1.20.1','forge','47.4.5',17,cache=root/'cache',runtime=root/'runtime')
   self.assertEqual(len(result['added']),1);self.assertEqual(owned_mods(root/'runtime',root),{'mods/pigmc-embeddium-safe-id.jar'})
   (root/'mods'/'pigmc-embeddium-safe-id.jar').write_bytes(b'user changed this');self.assertEqual(owned_mods(root/'runtime',root),set())
 def test_wrong_loader_release_is_not_installed(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);self.jar(root/'source.jar',minimum='[99.0,)')
   release={'id':'wrong','version_type':'release','version_number':'test','game_versions':['1.20.1'],'loaders':['forge'],'dependencies':[],'files':[{'primary':True}]}
   with patch('gameplay_performance.get_json',return_value=[release]),patch('gameplay_performance.verified_file',return_value=root/'source.jar'):
    self.assertFalse(install(root,'1.20.1','forge','47.4.5',17,runtime=root/'runtime')['added'])
   self.assertEqual(list((root/'mods').glob('*.jar')),[])
 def test_gc_does_not_force_zgc_or_a_50ms_pause_target(self):
  self.assertIn('-XX:+UseG1GC',java_flags());self.assertFalse(any('UseZGC' in a or 'MaxGCPauseMillis' in a for a in java_flags()))
