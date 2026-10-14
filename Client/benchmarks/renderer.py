"""Compare non-mod rendering controls on one runner using a generated world."""
import csv,io,json,math,os,signal,statistics,subprocess,sys,time,zipfile
from pathlib import Path

ROOT=Path(os.environ['GLIDE_MINECRAFT_DIR'])
OUT=Path('benchmark-results');OUT.mkdir(exist_ok=True)
CASES=[('default',{}),('threads-2',{'LP_NUM_THREADS':'2'}),('threads-3',{'LP_NUM_THREADS':'3'}),('threads-4-vector128',{'LP_NUM_THREADS':'4','LP_NATIVE_VECTOR_WIDTH':'128'}),('threads-3-vector128',{'LP_NUM_THREADS':'3','LP_NATIVE_VECTOR_WIDTH':'128'}),('default-repeat',{})]
if os.environ.get('BENCH_SUITE')=='confirm':
    candidate=os.environ.get('BENCH_CANDIDATE','threads-3')
    settings=next(settings for name,settings in CASES if name==candidate)
    CASES=[('default',{}),(candidate,settings),(candidate+'-repeat',settings),('default-repeat',{})]

def percentile(values,p):
    ordered=sorted(values);return ordered[min(len(ordered)-1,math.ceil(p*len(ordered))-1)]

def stop(process):
    if process.poll() is None:
        os.killpg(process.pid,signal.SIGTERM)
        try:process.wait(timeout=12)
        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()

def frame_summary(folder):
    samples=[]
    for path in folder.glob('*.csv'):
        lines=path.read_text().splitlines()
        for i,line in enumerate(lines):
            columns=next(csv.reader([line]))
            if 'frametime' not in columns:continue
            for row in csv.DictReader(lines[i:]):
                try:value=float(row['frametime'])
                except (ValueError,KeyError,TypeError):continue
                if 0<value<10000:samples.append(value)
            break
    if len(samples)<200:raise RuntimeError('Insufficient measured game frames: '+str(len(samples)))
    return {'frames':len(samples),'sample_seconds':sum(samples)/1000,'mean_fps':1000/statistics.mean(samples),'p50_ms':percentile(samples,.50),'p95_ms':percentile(samples,.95),'p99_ms':percentile(samples,.99),'over_50ms_percent':100*sum(v>50 for v in samples)/len(samples)}

results=[]
encoder_log=(OUT/'encoder.log').open('w')
encoder=subprocess.Popen(['nice','-n','5','ffmpeg','-nostdin','-loglevel','warning','-f','x11grab','-video_size','960x540','-framerate','30','-i',':99','-an','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-threads','2','-b:v','8M','-f','null','-'],stdout=encoder_log,stderr=encoder_log,start_new_session=True)
try:
    for name,settings in CASES:
        folder=OUT/name;folder.mkdir(exist_ok=True)
        saves=ROOT/'saves'
        if saves.exists():
            import shutil
            if saves.resolve().parent!=ROOT.resolve() or saves.is_symlink():raise RuntimeError('Unsafe benchmark fixture path')
            shutil.rmtree(saves)
        with zipfile.ZipFile(Path(__file__).with_name('generated-world.zip')) as fixture:fixture.extractall(ROOT)
        (ROOT/'options.txt').write_text('pauseOnLostFocus:false\nonboardAccessibility:false\nskipMultiplayerWarning:true\nenableVsync:false\nrenderDistance:4\nsimulationDistance:6\nentityDistanceScaling:0.75\nao:false\nentityShadows:false\nparticles:2\nmipmapLevels:0\ngraphicsMode:0\nrenderClouds:false\nbiomeBlendRadius:0\nmaxFps:60\n')
        env={**os.environ,**settings,'MANGOHUD_CONFIG':f'no_display,output_folder={folder.resolve()},autostart_log=30,log_duration=30,log_interval=0,permit_upload=0','MANGOHUD_DLSYM':'1'}
        for key in ('LP_NUM_THREADS','LP_NATIVE_VECTOR_WIDTH'):
            if key not in settings:env.pop(key,None)
        Path('/tmp/glide-minecraft.log').unlink(missing_ok=True)
        game_log=(folder/'launcher.log').open('w')
        game=subprocess.Popen([sys.executable,str(Path(__file__).with_name('launch.py'))],env=env,stdout=game_log,stderr=game_log,start_new_session=True)
        print('BENCHMARK_START='+name,flush=True)
        try:
            started=time.monotonic();deadline=started+150;joined=None
            while time.monotonic()<deadline:
                if game.poll() is not None:raise RuntimeError('Game exited during benchmark '+name)
                log=Path('/tmp/glide-minecraft.log')
                text=log.read_text(errors='replace') if log.exists() else ''
                if 'logged in with entity id' in text and joined is None:
                    joined=time.monotonic();print('BENCHMARK_WORLD_JOINED='+name,flush=True)
                csvs=list(folder.glob('*.csv'))
                # CSV files are written during logging; their existence alone must
                # not truncate the recording. Require a complete sample window.
                if joined and time.monotonic()-started>80 and time.monotonic()-joined>40 and csvs:
                    try:
                        if frame_summary(folder)['sample_seconds']>=25:break
                    except RuntimeError:pass
                time.sleep(2)
            if joined is None:raise RuntimeError('Quick Play did not enter the generated world')
            subprocess.run(['ffmpeg','-y','-loglevel','error','-f','x11grab','-video_size','960x540','-i',':99','-frames:v','1',str(folder/'world.png')],timeout=20,check=True)
        finally:
            log=Path('/tmp/glide-minecraft.log')
            if log.exists():(folder/'minecraft.log').write_text(log.read_text(errors='replace'))
            stop(game);game_log.close()
        # Only generated benchmark game data is copied, never player session data.
        summary={'case':name,'settings':settings,**frame_summary(folder)}
        if summary['sample_seconds']<25:raise RuntimeError('Recording window incomplete: '+name)
        results.append(summary);(OUT/'summary.json').write_text(json.dumps(results,indent=2))
        print(json.dumps(summary),flush=True)
finally:stop(encoder);encoder_log.close()
