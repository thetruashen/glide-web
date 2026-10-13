import os,json,unittest
from unittest.mock import patch,Mock
from app import app
from runner_pool import select_runner

class RunnerPoolTests(unittest.TestCase):
 def setUp(self):
  app.config.update(TESTING=True,SECRET_KEY='test-key',SESSION_COOKIE_SECURE=False)
  self.client=app.test_client();self.origin={'Origin':'http://localhost'}
 def test_public_visitors_receive_isolated_sessions_without_an_access_code(self):
  with patch.dict(os.environ,{'GITHUB_ACTIONS_TOKEN':'test-private-key'}):
   self.assertTrue(self.client.get('/api/config').json['authenticated'])
   response=Mock(ok=True);response.json.return_value={'workflow_runs':[]}
   with patch('app.gh',return_value=response):
    allocation=self.client.post('/api/allocate',headers=self.origin).json
    self.assertEqual(allocation['repo'],'thetruashen/glide-web');self.assertNotIn('test-private-key',json.dumps(allocation))
   with self.client.session_transaction() as s:self.assertEqual(s['launch_repos'][allocation['id']],allocation['repo'])
 def test_client_cannot_claim_someone_elses_launch_identifier(self):
  self.client.get('/api/config')
  with patch('app.gh') as gh:
   r=self.client.post('/api/actions',json={'repo':'thetruashen/glide-web','path':'actions/workflows/glide-session.yml/dispatches','method':'POST','body':{'inputs':{'session_id':'01234567-1234-1234-1234-012345678901','request':'{}'}}},headers=self.origin)
   self.assertEqual(r.status_code,400);gh.assert_not_called()
 def test_busy_repository_is_skipped_and_browser_cannot_launch_twice(self):
  entries=[{'repo':'one/game','token':'private-one','capacity':1},{'repo':'two/game','token':'private-two','capacity':2}]
  def fetch(path,repo):
   response=Mock(ok=True);response.json.return_value={'workflow_runs':[{'status':'in_progress','display_title':'Glide · existing'}] if repo=='one/game' else []};return response
  with patch.dict(os.environ,{'GLIDE_RUNNER_POOL':json.dumps(entries)}):
   self.assertEqual(select_runner(fetch)['repo'],'two/game')
   with self.assertRaises(ValueError):select_runner(fetch,['existing'])
