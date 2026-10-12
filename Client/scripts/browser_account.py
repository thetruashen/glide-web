"""Consume a browser-authorized Minecraft token from the private runtime only."""
import json
import re
import time
from pathlib import Path

def validate_account(data, now=None):
    now=time.time()*1000 if now is None else now
    if not isinstance(data,dict) or not re.fullmatch(r'[0-9a-f]{32}',str(data.get('id',''))):
        raise ValueError('Invalid Minecraft profile ID')
    if not re.fullmatch(r'[A-Za-z0-9_]{3,16}',str(data.get('name',''))):
        raise ValueError('Invalid Minecraft player name')
    token=data.get('accessToken')
    if not isinstance(token,str) or not 50<len(token)<16000 or '\n' in token or '\r' in token:
        raise ValueError('Invalid Minecraft session credential')
    expires=data.get('expires',0)
    if not isinstance(expires,(int,float)) or not now+60000<expires<now+172800000:
        raise ValueError('Minecraft sign-in expired. Sign in again.')
    return {'name':data['name'],'id':data['id'],'access_token':token}

def consume_account(path):
    path=Path(path)
    if path.stat().st_size>20000:raise ValueError('Invalid account payload')
    try:return validate_account(json.loads(path.read_text()))
    finally:path.unlink(missing_ok=True)
