import unittest,time,tempfile,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from browser_account import consume_account,validate_account
class AccountTests(unittest.TestCase):
 def payload(self):return {'name':'ExamplePlayer','id':'a'*32,'accessToken':'secret-token'*20,'expires':time.time()*1000+3600000}
 def test_consumes_private_file_and_does_not_keep_token(self):
  with tempfile.TemporaryDirectory() as d:
   file=Path(d)/'account.json';file.write_text(json.dumps(self.payload()));result=consume_account(file)
   self.assertEqual(result['name'],'ExamplePlayer');self.assertFalse(file.exists())
 def test_expired_or_invalid_identity_rejected(self):
  for values in [{'expires':0},{'id':'invalid'},{'name':'bad/name'},{'accessToken':'bad\ntoken'}]:
   with self.assertRaises(ValueError):validate_account({**self.payload(),**values})
