"""Conservative runtime-only performance additions; never replace pack mods."""
import hashlib,json,os,re,shutil,zipfile
from pathlib import Path
from urllib.parse import urlsplit
import requests

API='https://api.modrinth.com/v2'
GROUPS={'sodium':{'sodium','embeddium','rubidium','optifine','vulkanmod','iris','oculus'},'embeddium':{'sodium','embeddium','rubidium','optifine','vulkanmod','iris','oculus'},'lithium':{'lithium','canary','radium'},'ferrite-core':{'ferritecore'},'immediatelyfast':{'immediatelyfast','optifine','optifabric','vulkanmod'}}

def metadata(path):
    ids=set();requirements=[]
    with zipfile.ZipFile(path) as jar:
        for name in ('fabric.mod.json','META-INF/neoforge.mods.toml','META-INF/mods.toml','mcmod.info'):
            if name not in jar.namelist() or jar.getinfo(name).file_size>1048576:continue
            text=jar.read(name).decode('utf-8')
            if name.endswith('.toml'):
                import tomllib
                data=tomllib.loads(text);ids.update(m['modId'].lower() for m in data.get('mods',[]))
                for dependencies in data.get('dependencies',{}).values():
                    for d in dependencies:
                        if d.get('mandatory') or d.get('type')=='required':requirements.append((d['modId'].lower(),d.get('versionRange','*')))
            else:
                data=json.loads(text)
                if isinstance(data,list):ids.update(m['modid'].lower() for m in data if m.get('modid'))
                else:
                    if data.get('id'):ids.add(data['id'].lower())
                    requirements.extend((k.lower(),v) for k,v in data.get('depends',{}).items())
    return ids,requirements

def version_key(value):
    return tuple(int(n) for n in re.findall(r'\d+',str(value))[:4])

def satisfies(value,rule):
    if isinstance(rule,list):return any(satisfies(value,r) for r in rule)
    if rule in ('','*'):return True
    value=version_key(value)
    if len(rule)>2 and rule[0] in '[(' and rule[-1] in '])':
        ends=rule[1:-1].split(',')
        if len(ends)==1:return value==version_key(ends[0])
        low,high=ends
        return (not low or value>version_key(low) or rule[0]=='[' and value==version_key(low)) and (not high or value<version_key(high) or rule[-1]==']' and value==version_key(high))
    if '||' in rule:return any(satisfies('.'.join(map(str,value)),r.strip()) for r in rule.split('||'))
    parts=rule.split()
    if len(parts)>1:return all(satisfies('.'.join(map(str,value)),p) for p in parts)
    match=re.fullmatch(r'(>=|<=|>|<|=)?(\d+(?:\.\d+)*)(?:\.\*)?',rule)
    if not match:return False  # Unknown constraints are not guessed.
    op,target=match.groups();target=version_key(target)
    if rule.endswith('.*'):return value[:len(target)]==target
    return {'>=':value>=target,'<=':value<=target,'>':value>target,'<':value<target,'=':value==target,None:value==target}[op]

def get_json(path,params=None):
    response=requests.get(API+path,params=params,headers={'User-Agent':'pigmc/1 (github.com/thetruashen/glide-web)'},timeout=(5,20));response.raise_for_status();return response.json()

def verified_file(file,cache):
    url=urlsplit(file['url']);digest=file.get('hashes',{}).get('sha512','')
    if url.scheme!='https' or url.hostname!='cdn.modrinth.com' or url.username or url.password or url.port not in (None,443) or not re.fullmatch('[a-f0-9]{128}',digest):raise ValueError('Untrusted performance file')
    if not 0<int(file.get('size',0))<=32*1048576:raise ValueError('Performance file exceeds limit')
    cache.mkdir(parents=True,exist_ok=True);target=cache/(digest+'.jar')
    if target.exists() and hashlib.file_digest(target.open('rb'),'sha512').hexdigest()==digest:return target
    temporary=target.with_suffix('.partial')
    try:
        with requests.get(file['url'],stream=True,allow_redirects=False,timeout=(5,30)) as response,temporary.open('wb') as output:
            response.raise_for_status();size=0;checksum=hashlib.sha512()
            for chunk in response.iter_content(65536):
                size+=len(chunk)
                if size>int(file['size']):raise ValueError('Performance file exceeds declared size')
                output.write(chunk);checksum.update(chunk)
        if size!=int(file['size']) or checksum.hexdigest()!=digest:raise ValueError('Performance file checksum mismatch')
        temporary.replace(target);return target
    finally:temporary.unlink(missing_ok=True)

def install(root,version,loader,loader_version,java_major,cache=None,runtime=None):
    root=Path(root);runtime=Path(runtime or os.environ.get('GLIDE_SESSION_DIR','/tmp/glide-session'));runtime.mkdir(parents=True,exist_ok=True)
    report={'added':[],'skipped':[]};owned=[]
    if loader not in ('fabric','forge','neoforge'):return report
    mods=root/'mods';mods.mkdir(exist_ok=True);ids=set();names=[]
    for path in mods.glob('*.jar'):
        names.append(path.name.lower())
        try:ids.update(metadata(path)[0])
        except (OSError,ValueError,zipfile.BadZipFile):pass
    candidates=[('embeddium' if loader=='forge' else 'sodium'),'ferrite-core']
    if loader in ('fabric','neoforge'):candidates.append('lithium')
    candidates.append('immediatelyfast')
    cache=Path(cache or '/home/runner/glide-tools/performance-mods')
    bases={'minecraft':version,'forge':loader_version,'neoforge':loader_version,'fabricloader':loader_version,'java':str(java_major)}
    for slug in candidates:
        if GROUPS[slug]&ids or any(any(name.startswith(k+'-') or name.startswith(k+'_') for k in GROUPS[slug]) for name in names):
            report['skipped'].append(slug+': already supplied or conflicting renderer');continue
        try:
            releases=get_json('/project/'+slug+'/version',{'game_versions':json.dumps([version]),'loaders':json.dumps([loader])})
            for release in [r for r in releases if r.get('version_type')=='release' and version in r['game_versions'] and loader in r['loaders']][:8]:
                # Dependencies not already in the pack are not injected speculatively.
                if any(d['dependency_type']=='required' for d in release.get('dependencies',[])):continue
                file=next((f for f in release['files'] if f.get('primary')),release['files'][0]);source=verified_file(file,cache)
                new_ids,requirements=metadata(source)
                if not new_ids or new_ids&ids:continue
                if any((mod in bases and not satisfies(bases[mod],rule)) or (mod not in bases and mod not in ids and mod not in new_ids) for mod,rule in requirements):continue
                name='pigmc-'+slug+'-'+release['id']+'.jar';target=mods/name
                if target.exists():continue
                shutil.copy2(source,target);ids.update(new_ids);owned.append({'name':name,'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest()});report['added'].append(slug+' '+release['version_number']);break
            else:report['skipped'].append(slug+': no compatible self-contained stable release')
        except (requests.RequestException,ValueError,KeyError,OSError,zipfile.BadZipFile):report['skipped'].append(slug+': unavailable; original pack retained')
    (runtime/'performance-mods.json').write_text(json.dumps(owned))
    (runtime/'performance-report.json').write_text(json.dumps(report))
    for item in report['added']:print('PIGMC_PERFORMANCE_ADDED='+item,flush=True)
    for item in report['skipped']:print('PIGMC_PERFORMANCE_SKIP='+item,flush=True)
    return report

def owned_mods(runtime,root):
    try:items=json.loads((Path(runtime)/'performance-mods.json').read_text())
    except (OSError,ValueError):return set()
    result=set()
    for item in items:
        name=item.get('name','')
        if '/' in name or '\\' in name or not name.startswith('pigmc-') or not name.endswith('.jar'):continue
        path=Path(root)/'mods'/name
        if path.is_file() and not path.is_symlink():
            with path.open('rb') as file:
                if hashlib.file_digest(file,'sha256').hexdigest()==item.get('sha256'):result.add('mods/'+name)
    return result

def java_flags():
    # Balanced collector on CPU-constrained rendering hosts; no aggressive pause target.
    return ['-XX:+UseG1GC','-XX:+DisableExplicitGC']
