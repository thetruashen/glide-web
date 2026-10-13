import unittest
from unittest.mock import Mock,patch
from app import app
from image_proxy import allowed,load_image,cached_image,LIMIT

class ImageProxyTests(unittest.TestCase):
 def tearDown(self):cached_image.cache_clear()
 def test_private_hosts_and_credentials_are_rejected(self):
  for url in ['https://127.0.0.1/x','http://cdn.modrinth.com/x','https://cdn.modrinth.com.evil.test/x','https://user:password@cdn.modrinth.com/x','https://cdn.modrinth.com:8080/x']:
   with self.assertRaises(ValueError):allowed(url)
 def test_redirect_cannot_escape_the_image_allowlist(self):
  response=Mock(is_redirect=True,headers={'Location':'http://169.254.169.254/latest/meta-data'})
  with patch('image_proxy.requests.get',return_value=response) as fetch:
   with self.assertRaises(ValueError):load_image('https://cdn.modrinth.com/x')
   self.assertEqual(fetch.call_count,1);response.close.assert_called_once()
 def test_html_and_oversized_images_are_rejected(self):
  for headers,chunks in [({'Content-Type':'text/html'},[]),({'Content-Type':'image/png','Content-Length':str(LIMIT+1)},[]),({'Content-Type':'image/png'},[b'x'*(LIMIT+1)])]:
   response=Mock(is_redirect=False,ok=True,headers=headers);response.iter_content.return_value=chunks
   with patch('image_proxy.requests.get',return_value=response):
    with self.assertRaises(ValueError):load_image('https://cdn.modrinth.com/x')
 def test_images_are_cacheable_and_have_no_upstream_credentials(self):
  response=Mock(is_redirect=False,ok=True,headers={'Content-Type':'image/png'});response.iter_content.return_value=[b'png']
  with patch('image_proxy.requests.get',return_value=response) as fetch:
   result=app.test_client().get('/api/image?url=https://cdn.modrinth.com/icon.png')
   self.assertEqual(result.status_code,200);self.assertEqual(result.data,b'png');self.assertIn('public',result.headers['Cache-Control']);self.assertEqual(result.headers['X-Content-Type-Options'],'nosniff')
   self.assertNotIn('Authorization',fetch.call_args.kwargs['headers']);self.assertNotIn('Cookie',fetch.call_args.kwargs['headers']);self.assertFalse(fetch.call_args.kwargs['allow_redirects'])
