import tempfile,sys,unittest,signal
from pathlib import Path
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from performance_defaults import apply_defaults
from session_control import request_stop,KILL_SIGNAL

class PerformanceStopTests(unittest.TestCase):
 def test_defaults_apply_once_and_preserve_other_settings(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'options.txt';path.write_text('renderDistance:16\nvolume:0.5\n')
   apply_defaults(d,'1.20.1');text=path.read_text()
   self.assertIn('renderDistance:4',text);self.assertIn('entityDistanceScaling:0.75',text);self.assertIn('volume:0.5',text)
   path.write_text('renderDistance:8\n');apply_defaults(d,'1.20.1');self.assertEqual(path.read_text(),'renderDistance:8\n')
 def test_stop_requests_save_then_escalates_a_stuck_game(self):
  with tempfile.TemporaryDirectory() as d:
   log=Path(d)/'launch.log';log.write_text('MINECRAFT_PID=123\n')
   with patch('session_control.os.kill') as kill,patch('session_control.threading.Thread') as thread,patch('session_control.time.sleep'):
    request_stop(d,log_path=log);kill.assert_called_once_with(123,signal.SIGTERM)
    thread.call_args.kwargs['target']();self.assertEqual(kill.call_args.args,(123,KILL_SIGNAL))
 def test_force_stop_also_interrupts_a_login_window(self):
  with tempfile.TemporaryDirectory() as d:
   request_stop(d,force=True,log_path=Path(d)/'missing')
   self.assertTrue((Path(d)/'force-stop').exists())
