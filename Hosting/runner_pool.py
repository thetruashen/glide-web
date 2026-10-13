"""Select available, administrator-configured repositories without exposing keys."""
import json,os,re,secrets

def pool():
    raw=os.environ.get('GLIDE_RUNNER_POOL')
    entries=json.loads(raw) if raw else [{'repo':os.environ.get('GLIDE_REPO','thetruashen/glide-web'),'token':os.environ.get('GITHUB_ACTIONS_TOKEN',''),'branch':os.environ.get('GLIDE_BRANCH','main'),'capacity':2}]
    if not isinstance(entries,list) or not entries:raise ValueError('Runner pool is empty')
    for entry in entries:
        if not re.fullmatch(r'[\w.-]+/[\w.-]+',entry.get('repo','')) or not entry.get('token'):raise ValueError('Invalid private runner configuration')
        entry.setdefault('branch','main');entry['capacity']=max(1,min(20,int(entry.get('capacity',2))))
    return entries

def select_runner(fetch,owned_sessions=()):
    available=[]
    for entry in pool():
        result=fetch('actions/workflows/glide-session.yml/runs?per_page=100',entry['repo'])
        if not result.ok:continue
        runs=result.json().get('workflow_runs',[])
        if any(r.get('status')!='completed' and r.get('display_title') in {'Glide · '+sid for sid in owned_sessions} for r in runs):
            raise ValueError('This browser already has an active Java session. Resume or stop it before launching another.')
        active=sum(r.get('status')!='completed' for r in runs)
        if active<entry['capacity']:available.append((active/entry['capacity'],entry))
    if not available:raise ValueError('All runners are busy or unavailable. Please try again shortly.')
    minimum=min(score for score,entry in available)
    return secrets.choice([entry for score,entry in available if score==minimum])
