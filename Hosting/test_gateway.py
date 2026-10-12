import os
import unittest
from unittest.mock import patch,Mock
os.environ.setdefault('GLIDE_SESSION_SECRET','test-key')
os.environ.setdefault('GLIDE_ACCESS_CODE','test-code')
os.environ.setdefault('GITHUB_ACTIONS_TOKEN','test-token')
from app import app,safe_url
class GatewayTests(unittest.TestCase):
 def setUp(self):
  app.config.update(TESTING=True,SESSION_COOKIE_SECURE=False)
  self.client=app.test_client();self.origin={'Origin':'http://localhost'}
 def test_secrets_never_returned(self):
  r=self.client.get('/api/config');self.assertNotIn(b'test-token',r.data);self.assertNotIn(b'test-key',r.data)
 def test_cross_origin_login_and_launch_rejected(self):
  self.assertEqual(self.client.post('/api/login',json={'code':'test-code'},headers={'Origin':'https://evil.example'}).status_code,403)
  self.assertEqual(self.client.post('/api/actions',json={'path':''}).status_code,401)
 def test_only_signed_browser_owned_runs_can_be_read(self):
  self.client.post('/api/login',json={'code':'test-code'},headers=self.origin)
  response=Mock(ok=True);response.json.return_value={'display_title':'Glide · other-browser'}
  with patch('app.gh',return_value=response):
   r=self.client.post('/api/actions',json={'repo':'thetruashen/glide-web','path':'actions/runs/123','method':'GET'},headers=self.origin)
   self.assertEqual(r.status_code,403)
 def test_paths_and_download_redirects_bounded(self):
  for u in ['http://cdn.modrinth.com/a','https://127.0.0.1/a','https://cdn.modrinth.com@evil.example/a','https://cdn.modrinth.com:444/a']:
   with self.assertRaises(ValueError):safe_url(u)
  self.assertEqual(self.client.get('/api/catalog/curseforge/users').status_code,400)
  self.assertEqual(self.client.post('/api/download',json={'url':'https://127.0.0.1/a'},headers=self.origin).status_code,400)
 def test_cdn_size_header_is_not_mistaken_for_verified_file_length(self):
  upstream=Mock(ok=True,status_code=200,headers={'Content-Length':'2'})
  upstream.iter_content.return_value=[b'abcd']
  with patch('app.open_file',return_value=upstream):
   r=self.client.post('/api/download',json={'url':'https://edge.forgecdn.net/files/a.zip','size':4},headers=self.origin)
   self.assertEqual(r.status_code,200);self.assertEqual(r.data,b'abcd');self.assertEqual(r.headers['X-File-Size'],'4')
 def test_download_rejection_reports_specific_reason(self):
  r=self.client.post('/api/download',json={'url':'https://example.com/secret','size':1},headers=self.origin)
  self.assertEqual(r.status_code,400);self.assertEqual(r.json['error'],'Unsupported download host')
  r=self.client.post('/api/download',json={'url':'https://cdn.modrinth.com/a','size':1024*1048576},headers=self.origin)
  self.assertIn('512 MiB',r.json['error'])
if __name__=='__main__':unittest.main()
