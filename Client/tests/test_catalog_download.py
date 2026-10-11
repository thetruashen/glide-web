import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from session_api import catalog_download

class DownloadRelayTests(unittest.TestCase):
    def test_rejects_private_network_and_unapproved_hosts(self):
        for url in ['http://edge.forgecdn.net/a','https://127.0.0.1/secret','https://api.curseforge.com/v1/mods','https://u:p@edge.forgecdn.net/a','https://edge.forgecdn.net:8443/a']:
            with self.subTest(url=url),patch('requests.get') as request:
                with self.assertRaises(ValueError):catalog_download(url)
                request.assert_not_called()

    def test_never_forwards_api_credentials_and_checks_size(self):
        response=MagicMock();response.__enter__.return_value=response
        response.is_redirect=False;response.headers={'Content-Length':'3'};response.iter_content.return_value=iter([b'abc'])
        with patch('requests.get',return_value=response) as request:
            self.assertEqual(catalog_download('https://edge.forgecdn.net/files/test.jar',3),b'abc')
            self.assertNotIn('headers',request.call_args.kwargs)
            self.assertFalse(request.call_args.kwargs['allow_redirects'])
        response.iter_content.return_value=iter([b'abc'])
        with patch('requests.get',return_value=response),self.assertRaises(ValueError):catalog_download('https://edge.forgecdn.net/files/test.jar',4)

    def test_redirect_is_revalidated_before_following(self):
        response=MagicMock();response.__enter__.return_value=response
        response.is_redirect=True;response.headers={'Location':'https://localhost/secret'}
        with patch('requests.get',return_value=response) as request:
            with self.assertRaises(ValueError):catalog_download('https://edge.forgecdn.net/files/test.jar')
            self.assertEqual(request.call_count,1)
