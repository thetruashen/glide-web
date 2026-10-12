import os,unittest,time
from unittest.mock import patch,Mock
from microsoft import start,poll,AuthError
class MicrosoftTests(unittest.TestCase):
 def response(self,data,ok=True,status=200):
  result=Mock(ok=ok,status_code=status);result.json.return_value=data;return result
 def test_device_flow_requires_no_redirect_uri(self):
  response=self.response({'device_code':'device','user_code':'CODE','expires_in':900})
  with patch('microsoft.requests.post',return_value=response) as post:
   start('11111111-1111-1111-1111-111111111111')
   self.assertNotIn('redirect_uri',post.call_args.kwargs['data'])
 def test_pending_and_declined_distinct(self):
  with patch('microsoft.requests.post',return_value=self.response({'error':'authorization_pending'},False)):
   self.assertEqual(poll('device','11111111-1111-1111-1111-111111111111')['state'],'authorization_pending')
  with patch('microsoft.requests.post',return_value=self.response({'error':'authorization_declined'},False)):
   with self.assertRaisesRegex(AuthError,'declined'):poll('device','11111111-1111-1111-1111-111111111111')
 def test_account_exchange_returns_only_game_credential(self):
  responses=[self.response({'access_token':'ms','refresh_token':'never-return-this'}),self.response({'Token':'xbox'}),self.response({'Token':'xsts','DisplayClaims':{'xui':[{'uhs':'hash'}]}}),self.response({'access_token':'game-session','expires_in':3600})]
  with patch('microsoft.requests.post',side_effect=responses),patch('microsoft.requests.get',return_value=self.response({'name':'Player','id':'a'*32})):
   result=poll('device','11111111-1111-1111-1111-111111111111')
   self.assertEqual(result['account']['accessToken'],'game-session');self.assertNotIn('refreshToken',result['account']);self.assertGreater(result['account']['expires'],time.time()*1000)
