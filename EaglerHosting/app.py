"""Public client host. Deliberately contains no launcher credentials or sessions."""
from functools import lru_cache
import html,re,time
from urllib.parse import urlparse
import requests
from flask import Flask,request,jsonify,Response

app=Flask(__name__)
ROOT='1S405_0KWmbdr4b70FosYeZx17_6zyHtr'
@lru_cache(maxsize=256)
def listing(folder,bucket):
    r=requests.get('https://drive.google.com/embeddedfolderview',params={'id':folder},timeout=30);r.raise_for_status()
    pattern=r'class="flip-entry" id="entry-([\w-]+)".*?<a href="([^"]+)".*?<div class="flip-entry-title">(.*?)</div>'
    result=[]
    for identifier,url,name in re.findall(pattern,r.text,re.S):
        name=html.unescape(re.sub('<[^>]+>','',name));url=html.unescape(url)
        result.append({'id':identifier,'name':name,'source':url,'type':'folder' if '/folders/' in url else 'html' if name.lower().endswith(('.html','.htm')) else 'file'})
    return result

def folder_entries():
    folder=ROOT;path=request.args.get('path','')
    parts=path.split(',') if path else []
    if len(parts)>8 or any(not re.fullmatch(r'[\w-]{10,100}',p) for p in parts):raise ValueError('Invalid folder path')
    for child in parts:
        if not any(x['id']==child and x['type']=='folder' for x in listing(folder,int(time.time()/300))):raise ValueError('Folder is outside the shared client collection')
        folder=child
    return listing(folder,int(time.time()/300))

@app.after_request
def headers(response):
    response.headers['Access-Control-Allow-Origin']='*'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['X-Content-Type-Options']='nosniff'
    return response

@app.get('/')
def home():return 'pigmc · Public Eaglercraft client host'

@app.get('/api/clients')
def clients():
    try:return jsonify({'entries':folder_entries()})
    except (ValueError,requests.RequestException) as e:return jsonify({'error':str(e)}),400

@app.get('/play/<identifier>')
def play(identifier):
    try:
        entry=next((x for x in folder_entries() if x['id']==identifier and x['type']=='html'),None)
        if not entry:raise ValueError('Choose an HTML client from the shared folder')
        upstream=requests.get('https://drive.usercontent.google.com/download',params={'id':identifier,'export':'download','confirm':'t'},stream=True,timeout=(15,120));upstream.raise_for_status()
        if int(upstream.headers.get('Content-Length','0'))>150*1048576:raise ValueError('Client exceeds 150 MB')
        chunks=upstream.iter_content(65536);first=next(chunks,b'')
        if b'Google Drive - Virus scan warning' in first or b'accounts.google.com/ServiceLogin' in first:raise ValueError('Google requires a manual download for this client. Open its Drive source.')
        def stream():
            total=len(first)
            try:
                yield first
                for chunk in chunks:
                    total+=len(chunk)
                    if total>150*1048576:break
                    yield chunk
            finally:upstream.close()
        return Response(stream(),content_type='text/html; charset=utf-8',headers={'Content-Security-Policy':"frame-ancestors https://glide-thetruashen.wasmer.app https://thetruashen.github.io http://localhost:3000"})
    except (ValueError,requests.RequestException) as e:return Response(html.escape(str(e)),status=400,content_type='text/plain')
