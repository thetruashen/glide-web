'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,Copy,ExternalLink,LogIn,LogOut,UserRound} from 'lucide-react';
import {account,setAccount,microsoft,type MinecraftAccount} from '../lib/microsoft';
import type {Profile} from '../lib/storage';
type Device={ticket:string;code:string;url:string;expires:number;interval:number};
export default function MicrosoftAccount({profile,clientId,connected,hosted,locked,onChange,onOfficialLogin}:{profile:Profile;clientId:string;connected:boolean;hosted:boolean;locked:boolean;onChange(values:Partial<Profile>):Promise<void>;onOfficialLogin():Promise<void>}){
 const [current,setCurrent]=useState<MinecraftAccount|undefined>(account());
 const [device,setDevice]=useState<Device>();const [remaining,setRemaining]=useState(0);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [copied,setCopied]=useState(false);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(!device)return;const end=Date.now()+device.expires*1000;const tick=()=>setRemaining(Math.max(0,Math.ceil((end-Date.now())/1000)));tick();const id=setInterval(tick,1000);return()=>clearInterval(id);},[device]);
 async function signIn(){
  if(busy||locked)return;if(!clientId&&!profile.clientId){setBusy(true);try{await onOfficialLogin();}catch(e){setError(String(e));}finally{setBusy(false);}return;}const id=++generation.current;setError('');setCopied(false);setBusy(true);
  try{
   const d:Device=await microsoft('start',{clientId:clientId||profile.clientId});
   if(id!==generation.current)return;setDevice(d);let delay=d.interval*1000;const end=Date.now()+d.expires*1000;
   while(id===generation.current&&Date.now()<end){
    await new Promise(resolve=>setTimeout(resolve,delay));if(id!==generation.current)return;
    const result=await microsoft('poll',{ticket:d.ticket});if(id!==generation.current)return;
    if(result.state==='slow_down'){delay+=5000;continue;}
    if(result.state==='complete'){
     const {name,id:uuid,accessToken,expires,clientId:application}=result.account;
     const connectedAccount={name,id:uuid,accessToken,expires,clientId:application};
     setAccount(connectedAccount);setCurrent(connectedAccount);
     await onChange({auth:'microsoft',username:name,clientId:application});setDevice(undefined);return;
    }
   }
   if(id===generation.current)throw new Error('The sign-in code expired. Start again for a new code.');
  }catch(e){if(id===generation.current){setError(String(e));setDevice(undefined);}}
  finally{if(id===generation.current)setBusy(false);}
 }
 function cancel(){generation.current++;setDevice(undefined);setBusy(false);setError('');}
 return <section className="panel microsoft-account">
  <div className="panel-title"><h2><UserRound size={22}/> Minecraft account</h2>{current&&<span className="account-ready"><Check size={16}/> Signed in</span>}</div>
  <p>Use your Minecraft Java account for online servers. Sign in on Microsoft’s own website before starting the game.</p>
  {current?<div className="signed-account"><UserRound size={32}/><div><strong>{current.name}</strong><small>Minecraft Java Edition</small></div><button disabled={locked} onClick={()=>void onChange({auth:'microsoft',username:current.name,clientId:current.clientId})}>Use this account</button><button disabled={locked||busy} onClick={async()=>{setAccount(undefined);setCurrent(undefined);await onChange({auth:'offline'});}}><LogOut size={16}/> Sign out</button></div>:<>
   {!hosted&&<div className="notice">Microsoft account sign-in is available on the Wasmer launcher.</div>}
   {hosted&&!connected&&<div className="notice">Sign in to the launcher with its access code first.</div>}
   {hosted&&connected&&!clientId&&!profile.clientId&&<div className="notice">The official Minecraft Launcher will open in your private stream. Sign in there, choose your prepared Glide installation, and press Play.</div>}
   {!device&&<div className="inline-actions"><button className="primary" disabled={!hosted||!connected||busy||locked} onClick={()=>void signIn()}><LogIn size={18}/> Sign in with Microsoft</button></div>}
  </>}
  {device&&<div className="device-signin" role="status"><h3>Finish Microsoft sign-in</h3><p>Open Microsoft, enter this code and confirm the account you want to use.</p><div className="device-code"><strong>{device.code}</strong><button aria-label="Copy Microsoft sign-in code" onClick={async()=>{try{await navigator.clipboard.writeText(device.code);setCopied(true);}catch{setError('Copy the displayed code manually.');}}}>{copied?<Check size={18}/>:<Copy size={18}/>}</button></div><div className="inline-actions"><a className="button-link primary" href={device.url} target="_blank" rel="noopener noreferrer">Open Microsoft <ExternalLink size={16}/></a><button onClick={cancel}>Cancel</button></div><small>Waiting for Microsoft · expires in {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</small></div>}
  {error&&<div className="notice error" role="alert">{error}</div>}
  <div className="account-mode"><label>Play this instance as<select disabled={locked} value={profile.auth} onChange={e=>void onChange({auth:e.target.value})}><option value="offline">Offline player</option><option value="microsoft">Microsoft account</option></select></label>{profile.auth==='offline'&&<label>Offline player name<input maxLength={16} value={profile.username} disabled={locked} onChange={e=>void onChange({username:e.target.value})}/></label>}</div>
  <small>{clientId||profile.clientId?'Microsoft credentials stay in memory for this browser session and are excluded from instance backups.':'The official launcher handles sign-in inside your private session. Account data is excluded from instance backups.'}</small>
  {!clientId&&<details className="account-advanced"><summary>Advanced Microsoft app setup</summary><p>Register a public client for personal Microsoft accounts with device-code flows enabled. The official launcher is the default. A public application ID enables the optional device-code method instead.</p><label>Public application ID<input disabled={locked} value={profile.clientId} onChange={e=>void onChange({clientId:e.target.value})} autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000"/></label></details>}
 </section>;
}
