"""Run verified Prism Launcher; account files remain in private session storage."""
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import tarfile
import time
from pathlib import Path
import requests

URL='https://github.com/PrismLauncher/PrismLauncher/releases/download/11.1.1/PrismLauncher-Linux-Qt6-Portable-11.1.1.tar.gz'
SHA256='e21949a8101c1803dbc6f67a2cdad48ba80ede1c133f0d1f2a89da07af09e823'

def prepare_profile(work,game,launch_version):
    work.mkdir(parents=True,exist_ok=True)
    for name in ('assets','libraries'):
        destination=work/name
        if not destination.exists():destination.symlink_to(game/name,target_is_directory=True)
    installed=json.loads((game/'versions'/launch_version/f'{launch_version}.json').read_text())
    components=[{'uid':'net.minecraft','version':installed.get('inheritsFrom',launch_version),'important':True}]
    coordinates={'net.minecraftforge:forge:':'net.minecraftforge','net.neoforged:neoforge:':'net.neoforged','net.fabricmc:fabric-loader:':'net.fabricmc.fabric-loader','org.quiltmc:quilt-loader:':'org.quiltmc.quilt-loader'}
    for library in installed.get('libraries',[]):
        for prefix,uid in coordinates.items():
            if library.get('name','').startswith(prefix):
                version=library['name'][len(prefix):].split(':')[0]
                if uid=='net.minecraftforge':version=version.split('-',1)[-1]
                components.append({'uid':uid,'version':version})
    instance=work/'instances'/'glide';instance.mkdir(parents=True,exist_ok=True)
    if not (instance/'.minecraft').exists():(instance/'.minecraft').symlink_to(game,target_is_directory=True)
    memory=os.environ.get('GLIDE_MINECRAFT_XMX','4G').upper()
    megabytes=int(memory[:-1])*(1024 if memory.endswith('G') else 1)
    name=os.environ.get('GLIDE_INSTANCE_NAME','Glide instance').replace('\n',' ').replace('\r',' ')
    # Normal defaults only: leave Prism's account/consent page to the player.
    (work/'prismlauncher.cfg').write_text(f'[General]\nLanguage=en_US\nJavaPath={shutil.which("java")}\nLastHostname={socket.gethostname()}\nAutomaticJavaSwitch=false\nAutomaticJavaDownload=false\nUserAskedAboutAutomaticJavaDownload=true\nApplicationTheme=dark\nIconTheme=pe_colored\n')
    (instance/'instance.cfg').write_text(f'[General]\nInstanceType=OneSix\nname={name}\nOverrideJavaLocation=true\nJavaPath={shutil.which("java")}\nOverrideMemory=true\nMinMemAlloc=512\nMaxMemAlloc={megabytes}\n')
    (instance/'mmc-pack.json').write_text(json.dumps({'formatVersion':1,'components':components}))

def find_game_pid(game):
    # Read process IDs and cwd only, never JVM command lines or credentials.
    result=subprocess.run(['pgrep','-x','java'],capture_output=True,text=True)
    for value in result.stdout.split():
        try:
            if (Path('/proc')/value/'cwd').resolve()==game.resolve():return int(value)
        except (OSError,ValueError):pass
    # The isolated runner has no other Java application after preparation.
    if len(result.stdout.split())==1:return int(result.stdout.strip())
    return None

def launch_official(game_directory,launch_version):
    game=Path(game_directory);runtime=Path(os.environ.get('GLIDE_SESSION_DIR','/tmp/glide-session'))
    work=runtime/'prism-data';binary_root=runtime/'prism-binary'
    archive=Path('/home/runner/glide-tools/PrismLauncher-11.1.1.tar.gz');archive.parent.mkdir(parents=True,exist_ok=True)
    if not archive.exists():
        print('GLIDE_STAGE=prism-launcher-download',flush=True)
        temporary=archive.with_suffix('.partial')
        with requests.get(URL,stream=True,timeout=(15,120)) as response,temporary.open('wb') as output:
            response.raise_for_status()
            for chunk in response.iter_content(1048576):output.write(chunk)
        temporary.replace(archive)
    with archive.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
    if digest!=SHA256:
        archive.unlink();raise RuntimeError('Prism download checksum did not match the official release. Retry to download again.')
    binary_root.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive) as source:source.extractall(binary_root,filter='data')
    (binary_root/'portable.txt').unlink(missing_ok=True)
    executable=binary_root/'PrismLauncher'
    executable.chmod(executable.stat().st_mode|0o111)
    prepare_profile(work,game,launch_version)
    print('GLIDE_STAGE=prism-microsoft-login',flush=True)
    print('MICROSOFT_LOGIN_INSTRUCTIONS=In Prism, select Accounts then Add Microsoft. After signing in, launch your Glide instance.',flush=True)
    log=(runtime/'prism-launcher.log').open('wb')
    process=subprocess.Popen([str(executable),'--dir',str(work),'--launch','glide'],cwd=binary_root,stdout=log,stderr=log,start_new_session=True)
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
            elif process.poll() is not None:raise RuntimeError('Prism Launcher closed before Minecraft started. Launch again to sign in.')
            time.sleep(1)
    finally:
        try:os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        log.close()
    print('MINECRAFT_EXIT_CODE=0',flush=True)
