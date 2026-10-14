"""Benchmark-only instrumentation; never used by normal player sessions."""
import os,runpy,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import minecraft_launcher_lib.command

original_command=minecraft_launcher_lib.command.get_minecraft_command
def measured_command(version,directory,options):
    options={**options,'quickPlaySingleplayer':'Benchmark'}
    return original_command(version,directory,options)
minecraft_launcher_lib.command.get_minecraft_command=measured_command
original_popen=subprocess.Popen
def measured_process(command,*args,**kwargs):
    if isinstance(command,list) and Path(command[0]).name=='java':
        command=['mangohud','--dlsym',*command]
    return original_popen(command,*args,**kwargs)
subprocess.Popen=measured_process
runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts'/'glide_launch.py'),run_name='__main__')
