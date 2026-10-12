"""Same-origin gateway for the compiled Next.js app. No world data is stored here."""
import hmac
import os
import re
import time
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit, urljoin
import requests
from werkzeug.middleware.proxy_fix import ProxyFix
from flask import Flask, Response, jsonify, request, session, send_from_directory, stream_with_context

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app,x_proto=1,x_host=1)
app.config.update(SECRET_KEY=os.environ.get('GLIDE_SESSION_SECRET'), SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get('GLIDE_LOCAL_HTTP') != '1', SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30), MAX_CONTENT_LENGTH=65536)
REPO = os.environ.get('GLIDE_REPO', 'thetruashen/glide-web')
BRANCH = os.environ.get('GLIDE_BRANCH', 'main')
MAX_FILE = 512 * 1048576
HOSTS = {'cdn.modrinth.com','edge.forgecdn.net','mediafilez.forgecdn.net','media.forgecdn.net',
         'github.com','raw.githubusercontent.com','gitlab.com','release-assets.githubusercontent.com','objects.githubusercontent.com'}

@app.after_request
def private_api(response):
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.errorhandler(requests.RequestException)
def upstream_error(error):
    return jsonify(error='Upstream connection failed. Please retry.'), 502

def configured():
    return bool(app.secret_key and os.environ.get('GLIDE_ACCESS_CODE') and os.environ.get('GITHUB_ACTIONS_TOKEN'))

def expected_origin():
    return os.environ.get('GLIDE_ORIGIN',request.host_url.rstrip('/'))

def same_origin():
    # Every credentialed mutation must originate from this app, including local development.
    return request.headers.get('Origin') == expected_origin()

@app.get('/api/config')
def config():
    return jsonify(microsoftClientId=os.environ.get('MICROSOFT_CLIENT_ID',''),hosted=True, authenticated=bool(session.get('authenticated') and configured()), playConfigured=configured(), repo=REPO)

@app.post('/api/login')
def login():
    if not same_origin(): return jsonify(error='Origin not allowed'), 403
    if not configured(): return jsonify(error='The administrator has not configured remote play yet.'), 503
    code = str((request.get_json(silent=True) or {}).get('code', ''))
    if not hmac.compare_digest(code.encode(), os.environ['GLIDE_ACCESS_CODE'].encode()):
        return jsonify(error='Incorrect access code'), 401
    session.clear(); session['authenticated'] = True; session['browser_id']=os.urandom(16).hex(); session['sessions'] = []; session.permanent = True
    return jsonify(ok=True)

@app.post('/api/logout')
def logout():
    if not same_origin(): return jsonify(error='Origin not allowed'), 403
    session.clear(); return jsonify(ok=True)

@app.post('/api/microsoft/<operation>')
def microsoft_auth(operation):
    if not same_origin() or not configured() or not session.get('authenticated'):return jsonify(error='Sign in to the launcher first.'),401
    try:
        try:from . import microsoft
        except ImportError:import microsoft
        from itsdangerous import URLSafeTimedSerializer,BadSignature,SignatureExpired
        signer=URLSafeTimedSerializer(app.secret_key,salt='glide-microsoft-device')
        body=request.get_json(silent=True) or {}
        client=os.environ.get('MICROSOFT_CLIENT_ID') or body.get('clientId','')
        if operation=='start':
            if not session.get('browser_id'):session['browser_id']=os.urandom(16).hex()
            device=microsoft.start(client)
            expires=int(device.get('expires_in',900))
            ticket=signer.dumps({'code':device['device_code'],'client':client,'browser':session.get('browser_id'),'expires':time.time()+expires})
            return jsonify(ticket=ticket,code=device['user_code'],url=device.get('verification_uri','https://microsoft.com/devicelogin'),expires=expires,interval=max(5,int(device.get('interval',5))))
        if operation=='poll':
            try:data=signer.loads(body.get('ticket',''),max_age=900)
            except (BadSignature,SignatureExpired):return jsonify(error='The sign-in code expired. Request a new code.'),400
            if data['browser']!=session.get('browser_id') or data['expires']<time.time():return jsonify(error='Sign-in session expired or belongs to another browser.'),403
            return jsonify(microsoft.poll(data['code'],data['client']))
        return jsonify(error='Unknown sign-in operation'),404
    except microsoft.AuthError as error:return jsonify(error=str(error)),400

@app.get('/api/catalog/<provider>/<path:route>')
def catalog(provider, route):
    patterns = {'modrinth':r'(tag/category|tag/license|search|project/[A-Za-z0-9_-]+(?:/version)?|version/[A-Za-z0-9_-]+|version_file/[a-fA-F0-9]+)',
                'curseforge':r'(categories|mods/(search|[0-9]+(?:/description|/files(?:/[0-9]+(?:/download-url|/changelog)?)?)?))'}
    if provider not in patterns or not re.fullmatch(patterns[provider],route):
        return jsonify(error='Unsupported catalog request'), 400
    headers={'User-Agent':'GlideWeb/2 (github.com/thetruashen/glide-web)'}
    if provider=='curseforge':
        key=os.environ.get('CURSEFORGE_API_KEY')
        if not key: return jsonify(error='CurseForge is not configured on the server'), 503
        headers['x-api-key']=key
    base='https://api.modrinth.com/v2/' if provider=='modrinth' else 'https://api.curseforge.com/v1/'
    # Limit page sizes without changing project/version filters.
    params=request.args.to_dict()
    for name in ('limit','pageSize','per_page'):
        if name in params:
            try: params[name]=str(min(100,max(1,int(params[name]))))
            except ValueError: return jsonify(error='Invalid page size'),400
    result=requests.get(base+route,params=params,headers=headers,timeout=(10,30))
    return Response(result.content,status=result.status_code,content_type='application/json')

def safe_url(value):
    parsed=urlsplit(value)
    if parsed.scheme!='https' or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None,443):
        raise ValueError('Unsupported download host')
    return value

def open_file(url):
    for _ in range(6):
        safe_url(url)
        result=requests.get(url,stream=True,allow_redirects=False,timeout=(15,120),headers={'User-Agent':'GlideWeb/2','Accept-Encoding':'identity'})
        if result.is_redirect:
            next_url=urljoin(url,result.headers.get('Location',''));result.close();url=next_url;continue
        return result
    raise ValueError('Too many download redirects')

@app.post('/api/download')
def download():
    if not same_origin(): return jsonify(error='Origin not allowed'),403
    body=request.get_json(silent=True) or {}
    try:
        size=int(body.get('size',0))
        if not 0<=size<=MAX_FILE: raise ValueError('This file exceeds the 512 MiB download limit')
        url=body.get('url','')
        if not isinstance(url,str) or not url or len(url)>4096: raise ValueError('The provider did not supply a valid file URL')
        upstream=open_file(url)
        if not upstream.ok:
            status=upstream.status_code;upstream.close()
            return jsonify(error=f'The official download returned {status}.'),502
        # CDN/proxy Content-Length may describe encoded bytes or be missing.
        # Enforce the actual streamed length; the browser also verifies the hash.
        length_header=upstream.headers.get('Content-Length','')
        length=int(length_header) if str(length_header).isdigit() else 0
        if length>MAX_FILE:
            upstream.close();raise ValueError('This file exceeds the 512 MiB download limit')
        if upstream.status_code==206:
            upstream.close();raise ValueError('The CDN returned only part of the file. Retry the download.')
    except (ValueError,TypeError) as error:
        return jsonify(error=str(error) or 'Invalid download request'),400
    def chunks():
        total=0
        try:
            for chunk in upstream.iter_content(131072):
                total+=len(chunk)
                if total>MAX_FILE or (size and total>size): raise ValueError('Download exceeds expected size')
                yield chunk
            if size and total!=size: raise ValueError('Incomplete download')
        finally: upstream.close()
    response=Response(stream_with_context(chunks()),content_type='application/octet-stream')
    if size:response.headers['X-File-Size']=str(size)
    return response

def gh(path,method='GET',body=None):
    return requests.request(method,f'https://api.github.com/repos/{REPO}'+('/'+path if path else ''),
        json=body,headers={'Authorization':'Bearer '+os.environ['GITHUB_ACTIONS_TOKEN'],
        'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},timeout=(10,30))

def owns_run(run):
    return run.get('display_title') in ['Glide · '+v for v in session.get('sessions',[])]

@app.post('/api/actions')
def actions():
    if not same_origin() or not configured() or not session.get('authenticated'): return jsonify(error='Sign in to play'),401
    data=request.get_json(silent=True) or {};path=data.get('path','');method=data.get('method','GET');body=data.get('body')
    if data.get('repo')!=REPO or not isinstance(path,str): return jsonify(error='Invalid repository'),400
    if path=='': return jsonify(default_branch=BRANCH)
    dispatch=re.fullmatch(r'actions/workflows/(glide-session.yml|catalog-download.yml)/dispatches',path)
    listing=re.fullmatch(r'actions/workflows/(glide-session.yml|catalog-download.yml)/runs\?event=workflow_dispatch&per_page=100',path)
    run=re.fullmatch(r'actions/runs/([0-9]+)(/jobs|/cancel)?',path)
    if dispatch and method=='POST':
        try:
            sid=body['inputs']['session_id']
            if not re.fullmatch(r'[a-f0-9-]{36}',sid): raise ValueError()
            import json
            settings=json.loads(body['inputs']['request'])
            if settings.get('origin')!=expected_origin() or len(body['inputs']['request'])>12000: raise ValueError()
            if not re.fullmatch(r'[A-Za-z0-9+/=]{500,1000}',settings.get('publicKey','')): raise ValueError()
        except (KeyError,TypeError,ValueError): return jsonify(error='Invalid launch request'),400
        # Signed cookies isolate each browser's launches; no global Actions proxy is exposed.
        if time.time()-session.get('last_dispatch',0)<30: return jsonify(error='Wait 30 seconds before another launch'),429
        sessions=session.get('sessions',[])[-7:]+[sid]
        result=gh(path,'POST',{'ref':BRANCH,'inputs':body['inputs']})
        if result.ok: session['sessions']=sessions;session['last_dispatch']=time.time()
    elif listing and method=='GET':
        result=gh(path)
        if result.ok:
            runs=result.json();runs['workflow_runs']=[r for r in runs['workflow_runs'] if owns_run(r)]
            return jsonify(runs)
    elif run and ((method=='GET' and run[2]!='/cancel') or (method=='POST' and run[2]=='/cancel')):
        check=gh('actions/runs/'+run[1])
        if not check.ok or not owns_run(check.json()): return jsonify(error='Run is not owned by this browser'),403
        result=check if not run[2] else gh(path,method,{} if method=='POST' else None)
    else: return jsonify(error='Unsupported Actions operation'),400
    return Response(result.content,status=result.status_code,content_type='application/json')

@app.route('/',defaults={'path':''})
@app.route('/<path:path>')
def frontend(path):
    public=ROOT/'public'
    if path.startswith('api/'): return jsonify(error='Not found'),404
    if not path or path.endswith('/'): path+='index.html'
    return send_from_directory(public,path)

if __name__=='__main__': app.run(host='127.0.0.1',port=int(os.environ.get('PORT','5000')))
