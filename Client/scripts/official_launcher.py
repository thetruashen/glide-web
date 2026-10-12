"""Run the vendor's launcher; Microsoft credentials remain inside that client."""
import json
import os
import shutil
import signal
import subprocess
import tarfile
import time
from pathlib import Path
import requests

URL='https://launcher.mojang.com/download/Minecraft.tar.gz'

def prepare_profile(work,game,launch_version):
    work.mkdir(parents=True,exist_ok=True)
    for name in ('assets','libraries','versions'):
        destination=work/name
        if not destination.exists():destination.symlink_to(game/name,target_is_directory=True)
    profile={'name':os.environ.get('GLIDE_INSTANCE_NAME','Glide instance'),'type':'custom','lastVersionId':launch_version,
             'gameDir':str(game),'javaDir':shutil.which('java'),'javaArgs':f"-Xmx{os.environ.get('GLIDE_MINECRAFT_XMX','4G')} -Xms512M -XX:+UseG1GC",
             'resolution':{'width':int(os.environ.get('GLIDE_RENDER_WIDTH','1280')),'height':int(os.environ.get('GLIDE_RENDER_HEIGHT','720'))}}
    (work/'launcher_profiles.json').write_text(json.dumps({'profiles':{'glide':profile},'selectedProfile':'glide','settings':{'enableAdvanced':True,'profileSorting':'ByLastPlayed'}}))

def find_game_pid(game):
    # Read process IDs and cwd only, never JVM command lines or credentials.
    result=subprocess.run(['pgrep','-x','java'],capture_output=True,text=True)
    for value in result.stdout.split():
        try:
            if (Path('/proc')/value/'cwd').resolve()==game.resolve():return int(value)
        except (OSError,ValueError):pass
    return None

def launch_official(game_directory,launch_version):
    game=Path(game_directory);runtime=Path(os.environ.get('GLIDE_SESSION_DIR','/tmp/glide-session'))
    work=runtime/'official-minecraft';binary_root=runtime/'official-binary'
    archive=Path('/home/runner/glide-tools/Minecraft.tar.gz');archive.parent.mkdir(parents=True,exist_ok=True)
    if not archive.exists():
        print('GLIDE_STAGE=official-launcher-download',flush=True)
        temporary=archive.with_suffix('.partial')
        with requests.get(URL,stream=True,timeout=(15,120)) as response,temporary.open('wb') as output:
            response.raise_for_status()
            for chunk in response.iter_content(1048576):output.write(chunk)
        temporary.replace(archive)
    binary_root.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive) as source:source.extractall(binary_root,filter='data')
    executable=next(path for path in binary_root.rglob('minecraft-launcher') if path.is_file())
    executable.chmod(executable.stat().st_mode|0o111)
    prepare_profile(work,game,launch_version)
    print('GLIDE_STAGE=official-microsoft-login',flush=True)
    print('MICROSOFT_LOGIN_INSTRUCTIONS=Sign in inside the official Minecraft Launcher, select your Glide installation and press Play.',flush=True)
    log=(runtime/'official-launcher.log').open('wb')
    process=subprocess.Popen([str(executable),'--workDir',str(work)],cwd=work,stdout=log,stderr=log,start_new_session=True)
    pid=None
    try:
        while not (runtime/'stop').exists():
            candidate=find_game_pid(game)
            if not pid and candidate:
                pid=candidate;print(f'MINECRAFT_PID={pid}',flush=True);print('GLIDE_STAGE=minecraft-running',flush=True)
            if pid:
                try:
                    if (Path('/proc')/str(pid)/'stat').read_text().split()[2]=='Z':break
                except OSError:break
            elif process.poll() is not None:raise RuntimeError('The official launcher closed before Minecraft started. Launch again to sign in.')
            time.sleep(1)
    finally:
        try:os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        log.close()
    print('MINECRAFT_EXIT_CODE=0',flush=True)
