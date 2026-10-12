"""Microsoft device authorization, with ephemeral exchanges and no token database."""
import re
import time
import requests

LOGIN='https://login.microsoftonline.com/consumers/oauth2/v2.0/'
class AuthError(Exception): pass

def token_error(data):
    code=data.get('error','unknown')
    messages={'authorization_declined':'Microsoft sign-in was declined. Start again when ready.',
              'access_denied':'Microsoft sign-in was declined.',
              'expired_token':'The sign-in code expired. Request a new code.',
              'invalid_grant':'Your Microsoft session expired. Sign in again.',
              'invalid_client':'The launcher Microsoft application is not configured correctly.',
              'unauthorized_client':'Enable public-client device flows and personal Microsoft accounts for this application.',
              'invalid_request':'Microsoft rejected the sign-in request. Check the launcher application configuration.'}
    return messages.get(code,'Microsoft sign-in failed. Please try again.')

def valid_client(value):
    if not isinstance(value,str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',value):
        raise AuthError('Microsoft sign-in needs one registered public application ID. Device-code sign-in works on every domain without redirect URLs.')
    return value

def start(client):
    response=requests.post(LOGIN+'devicecode',data={'client_id':valid_client(client),'scope':'XboxLive.signin offline_access'},timeout=30)
    data=response.json()
    if not response.ok or 'device_code' not in data: raise AuthError(token_error(data))
    return data

def exchange(token,client):
    response=requests.post('https://user.auth.xboxlive.com/user/authenticate',json={'Properties':{'AuthMethod':'RPS','SiteName':'user.auth.xboxlive.com','RpsTicket':'d='+token['access_token']},'RelyingParty':'http://auth.xboxlive.com','TokenType':'JWT'},timeout=30)
    xbl=response.json()
    if not response.ok or 'Token' not in xbl:raise AuthError('Xbox sign-in failed. Check that this Microsoft account has an Xbox profile.')
    response=requests.post('https://xsts.auth.xboxlive.com/xsts/authorize',json={'Properties':{'SandboxId':'RETAIL','UserTokens':[xbl['Token']]},'RelyingParty':'rp://api.minecraftservices.com/','TokenType':'JWT'},timeout=30)
    xsts=response.json()
    if not response.ok or 'Token' not in xsts:raise AuthError('Xbox could not authorize this account. Check its Xbox profile and Microsoft family permissions.')
    claims=xsts.get('DisplayClaims',{}).get('xui',[])
    if not claims or not claims[0].get('uhs'):raise AuthError('Xbox returned an incomplete profile.')
    response=requests.post('https://api.minecraftservices.com/authentication/login_with_xbox',json={'identityToken':f"XBL3.0 x={claims[0]['uhs']};{xsts['Token']}"},timeout=30)
    minecraft=response.json()
    if not response.ok or 'access_token' not in minecraft:raise AuthError('Minecraft rejected the sign-in. This application must be permitted to access Minecraft services.')
    response=requests.get('https://api.minecraftservices.com/minecraft/profile',headers={'Authorization':'Bearer '+minecraft['access_token']},timeout=30)
    profile=response.json()
    if response.status_code==404:raise AuthError('This account does not have a Minecraft Java profile. Check Java Edition ownership or an active eligible Game Pass subscription.')
    if not response.ok or not profile.get('id') or not profile.get('name'):raise AuthError('Minecraft could not load your Java profile. Please try again.')
    return {'name':profile['name'],'id':profile['id'],'accessToken':minecraft['access_token'],
            'expires':int(time.time()*1000)+int(minecraft.get('expires_in',3600))*1000,'clientId':client}

def poll(device,client):
    response=requests.post(LOGIN+'token',data={'client_id':valid_client(client),'grant_type':'urn:ietf:params:oauth:grant-type:device_code','device_code':device},timeout=30)
    data=response.json()
    if data.get('error') in ('authorization_pending','slow_down'):return {'state':data['error']}
    if not response.ok or 'access_token' not in data:raise AuthError(token_error(data))
    return {'state':'complete','account':exchange(data,client)}
