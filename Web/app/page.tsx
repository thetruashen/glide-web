'use client';
import {imageURL} from '../lib/images';
import { useEffect, useRef, useState } from 'react';
import { download, getBackup, getMods, importProfile, newProfile, packProfile, profiles, removeProfile, saveMods, saveProfile, storeBackup, type Mod, type Profile } from '../lib/storage';
import ProgressPanel from '../components/ProgressPanel';
import type {ProgressInfo} from '../lib/progress';
import InstanceContent from '../components/InstanceContent';
import EaglerBrowser from '../components/EaglerBrowser';
import AnimatedBanner from '../components/AnimatedBanner';
import ContentBrowser from '../components/ContentBrowser';
import {Box,Compass,Home as HomeIcon,Layers,Image as ImageIcon,Sun,Settings,Puzzle,ChevronDown,Plug,Plus,Play,Upload,Download,Trash2,X,Maximize,Package,Clock,Monitor,ArrowRight,Pencil,UserRound} from 'lucide-react';
import {configureCatalog} from '../lib/catalog-api';
import type { ContentType, Project } from '../lib/catalog-api';
import { connect, github, launch, persistSession, runner, RunnerEnded, streamURL, uploadProfile, type Session, type Status } from '../lib/session';

type Version = { id: string; type: string; loaders: string[] };
const DEFAULT_REPO = process.env.NEXT_PUBLIC_GLIDE_REPO || 'thetruashen/glide-web';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function Home() {
  const [view, setView] = useState<'home' | 'instances' | 'settings' | 'account' | ContentType>('home');
  const [mode,setMode]=useState<'java'|'eagler'>('java');
  const [stopRequested,setStopRequested]=useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogSelection, setCatalogSelection] = useState<Project>();
  const [globalSearch, setGlobalSearch] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [items, setItems] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [mods, setMods] = useState<Mod[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [search, setSearch] = useState('');
  const [allTypes, setAllTypes] = useState(false);
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [session, setSession] = useState<Session>();
  const [status, setStatus] = useState<Status>();
  const [message, setMessage] = useState('Your worlds stay with you.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [launchProgress,setLaunchProgress]=useState<ProgressInfo>({title:'Waiting to launch'});
  const [lastSave, setLastSave] = useState<number>();
  const [storage, setStorage] = useState('');
  const [showConnection, setShowConnection] = useState(false);
  const [hosted,setHosted]=useState(false);
  const [accessCode,setAccessCode]=useState('');
  const [microsoftClientId,setMicrosoftClientId]=useState('');
  const [instanceBrowse,setInstanceBrowse]=useState(false);
  const [instanceTab,setInstanceTab]=useState<'mods'|'resourcepack'|'shader'|'settings'|'backups'>('mods');
  const [streamDetached,setStreamDetached]=useState(false);
  const forceRequested=useRef(false);
  const [streamRevision,setStreamRevision]=useState(0);
  const screen = useRef<HTMLDivElement>(null);
  const polling = useRef(false);
  const initialized = useRef(false);
  const snapshotTime = useRef(0);
  const stopping = useRef(false);
  const elapsed = session ? Math.round((Date.now() - session.created) / 1000) : 0;

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      try {
        const host=await fetch('/api/config').then(r=>r.ok?r.json():null).catch(()=>null);
        if(host?.hosted){configureCatalog(true);setHosted(true);setMicrosoftClientId(host.microsoftClientId || '');if(host.authenticated){setToken('@server');setRepo(host.repo||DEFAULT_REPO);}}
        let saved = await profiles();
        for(const p of saved)if(p.name==='My world'){p.name='My instance';await saveProfile(p);}
        if (!saved.length) { const first = newProfile(); await saveProfile(first); saved = [first]; }
        setItems(saved); setProfile(saved[0]); setMods(await getMods(saved[0].id));
        if(!host?.hosted)setToken(sessionStorage.getItem('glide-token') || '');
        const active = sessionStorage.getItem('glide-session');
        if (active) {
          const s: Session = JSON.parse(active); setSession(s); setRepo(s.repo);
          const selected = saved.find(p => p.id === s.profileId);
          if (selected) { setProfile(selected); setMods(await getMods(selected.id)); }
        }
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota) setStorage(`${Math.round((estimate.usage || 0) / 1048576)} MB used of ${Math.round(estimate.quota / 1073741824)} GB available`);
        const response = await fetch(`${BASE}/versions.json`);
        if (!response.ok) throw new Error('Version catalog unavailable. Refresh after the site finishes deploying.');
        const catalog = await response.json(); setVersions(catalog.versions);
      } catch (e) { setError(String(e)); }
    })();
  }, []);

  async function checkpoint(s: Session) {
    const response = await runner(s, 'profile');
    await storeBackup(s.profileId, await response.blob());
    const now = Date.now(); snapshotTime.current = now; setLastSave(now);
  }

  useEffect(() => {
    if (!session || !token) return;
    let stopped = false;
    const poll = async () => {
      if (polling.current || stopped || stopping.current) return;
      polling.current = true;
      try {
        let s = session;
        if (!s.url) {
          s = await connect(s, token,setLaunchProgress);
          if (stopped) return;
          setSession(s);
          if (!s.url) { setMessage(`Preparing your runner · ${Math.round((Date.now() - s.created) / 1000)}s`); return; }
        }
        const current: Status = await (await runner(s, 'status')).json();
        if (stopped) return;
        setStatus(current);
        if (!current.started) {
          setMessage('Sending your local profile directly to the runner…');
          const instance=items.find(p=>p.id===s.profileId);
          setLaunchProgress({title:'Preparing your local instance'});
          const archive=await packProfile(s.profileId,false,(percent,title)=>setLaunchProgress({title:title || 'Preparing your local instance',percent}));
          await uploadProfile(s,archive,setLaunchProgress);
          await runner(s, 'start', '{}');
          setLaunchProgress({title:'Starting Minecraft'});s = { ...s, uploaded: true }; persistSession(s); setSession(s);
        } else if (current.finished) {
          let saveError="";try {await checkpoint(s);} catch(e){saveError=String(e);}
          if (s.runId) await github(s.repo, `actions/runs/${s.runId}/cancel`, token, {}, 'POST');
          sessionStorage.removeItem('glide-session'); setSession(undefined); setStatus(undefined);
          setMessage(saveError ? 'Session ended. Your last browser backup is preserved. '+saveError : current.error || 'Session finished. Your final save is in this browser.');
        } else {
          setLaunchProgress({title:current.stage==='minecraft-running'?'Minecraft is running':current.stage==='choose-account' ? 'Choose Microsoft sign-in or offline play' : current.stage==='microsoft-login'||current.stage==='prism-microsoft-login'?'pigmc · Microsoft sign-in':`Starting Minecraft · ${current.stage.replaceAll('-', ' ')}`,percent:current.stage==='minecraft-running'?100:undefined});
          setMessage(current.stage === 'minecraft-running' ? 'Connected. Minecraft is running.' : `Preparing game · ${current.stage.replaceAll('-', ' ')}`);
          if (current.stage === 'minecraft-running' && Date.now() - snapshotTime.current > 60000) await checkpoint(s);
        }
        setError('');
      } catch (e) {
        if (!stopped) {
          setError(String(e));
          if (e instanceof RunnerEnded) {
            sessionStorage.removeItem('glide-session'); setSession(undefined); setStatus(undefined);
            setMessage('Runner ended. Your last browser backup is preserved.');
          }
        }
      }
      finally { polling.current = false; }
    };
    void poll();
    const interval = setInterval(poll, session.url ? 5000 : 8000);
    return () => { stopped = true; clearInterval(interval); };
  }, [session, token]);

  useEffect(() => {
    if (!session) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);

  useEffect(() => {
    const release = () => {
      if (!document.fullscreenElement) {
        const keyboard = (navigator as Navigator & { keyboard?: { unlock(): void } }).keyboard;
        keyboard?.unlock();
      }
    };
    document.addEventListener('fullscreenchange', release);
    return () => document.removeEventListener('fullscreenchange', release);
  }, []);

  async function change(values: Partial<Profile>) {
    if (!profile || session || catalogBusy) return;
    const next = { ...profile, ...values, ...((values.version && values.version !== profile.version) || (values.loader && values.loader !== profile.loader) ? { loaderVersion: undefined } : {}) }; setProfile(next);
    await saveProfile(next); setItems(await profiles());
  }
  async function select(id: string) { setMode('java');setView('instances');setInstanceTab('mods');setInstanceBrowse(false); const selected = items.find(p => p.id === id); if (selected) { setProfile(selected); setMods(await getMods(id)); setLastSave(undefined); } }
  async function addProfile() { const p = newProfile(); p.name = `My instance ${items.length + 1}`; await saveProfile(p); setItems(await profiles()); setProfile(p); setMods([]);setMode("java");setView("instances");setInstanceTab("mods");setInstanceBrowse(false); }
  async function start(profileToLaunch = profile) {
    if (!profileToLaunch || busy || session || catalogBusy) return;
    setProfile(profileToLaunch); setMods(await getMods(profileToLaunch.id));
    setError(''); setStopRequested(false);forceRequested.current=false;setStreamDetached(false); setBusy(true);
    try {
      if (!token.trim()) { if(!hosted)setShowConnection(true); throw new Error(hosted?'Remote play is currently unavailable. Please try again shortly.':'Enter a repository-scoped GitHub token with Actions read/write access.'); }
      const incompatible = (await getMods(profileToLaunch.id)).find(m => (m.gameVersion && m.gameVersion !== profileToLaunch.version) || (m.loader && m.loader !== profileToLaunch.loader));
      if (incompatible) throw new Error(`${incompatible.name} targets a different Minecraft version or loader. Update or remove it before launching.`);
      sessionStorage.setItem('glide-token', token.trim());
      await navigator.storage?.persist();
      setLaunchProgress({title:'Requesting a private runner'});setMessage('Starting a private runner…');
      setSession(await launch({...profileToLaunch,auth:"prompt",username:"GlidePlayer",clientId:""}, repo.trim(), token.trim()));
      snapshotTime.current = Date.now();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function stop() {
    if (!session) return;
    setStopRequested(true);
    stopping.current = true;
    setBusy(true); setError('');
    try {
      if (session.runId) {
        const run = await github(session.repo, `actions/runs/${session.runId}`, token);
        if (run.status === 'completed') {
          sessionStorage.removeItem('glide-session'); setSession(undefined); setStatus(undefined);
          setMessage('Runner already ended. Your last browser backup is preserved.');
          return;
        }
      }
      if (session.url) {
        await runner(session, 'stop', '{}');
        setMessage('Stopping Minecraft and waiting for its final save…');
        let finished = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          if(forceRequested.current)return;
          const current: Status = await (await runner(session, 'status')).json();
          if (current.finished || !current.started) { finished = true; break; }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (!finished) { await runner(session,'force-stop','{}'); await new Promise(resolve=>setTimeout(resolve,3000)); }
        await checkpoint(session);
      }
      let s = session;
      if (!s.runId) { s = await connect(s, token,setLaunchProgress); setSession(s); }
      if (!s.runId) throw new Error('Runner is still being queued. Try again shortly.');
      await github(s.repo, `actions/runs/${s.runId}/cancel`, token, {}, 'POST');
      sessionStorage.removeItem('glide-session'); setSession(undefined); setStatus(undefined);
      setMessage('Saved locally. The runner has been stopped.');
    } catch (e) { if(!forceRequested.current)setError(String(e)); } finally { setBusy(false); stopping.current = false; }
  }
  async function forceStop() {
    if(!session)return;
    forceRequested.current=true;
    try { if(session.url)await runner(session,"force-stop","{}"); if(session.runId)await github(session.repo,`actions/runs/${session.runId}/cancel`,token,{},"POST"); sessionStorage.removeItem("glide-session");setSession(undefined);setStatus(undefined);setBusy(false);setMessage("Session force stopped. Your last browser backup is preserved."); } catch(e){setError(String(e));}
  }
  async function uploadMods(files: FileList | null) {
    if (!files || !profile) return;
    try {
      const next = [...mods];
      for (const file of Array.from(files)) {
        if (!/^[^/\\:]+\.jar$/i.test(file.name)) throw new Error('Upload Java mod files ending in .jar.');
        if (file.size > 100 * 1048576) throw new Error('Each mod must be under 100 MB.');
        const index = next.findIndex(m => m.name === file.name);
        if (index >= 0) next[index] = { name: file.name, blob: file }; else next.push({ name: file.name, blob: file });
      }
      await saveMods(profile.id, next); setMods(next); setError('');
    } catch (e) { setError(String(e)); }
  }
  async function backup() {
    if (!profile) return;
    try { if (session?.url) await checkpoint(session); download(await packProfile(profile.id,true), `pigmc-${profile.version}-${profile.name.replace(/[^\w-]/g,'_')}.zip`); }
    catch (e) { setError(String(e)); }
  }
  async function fullscreen() {
    try {
      await screen.current?.requestFullscreen({ navigationUI: 'hide' });
      setStreamDetached(false);setStreamRevision(n=>n+1);
      const keyboard = (navigator as Navigator & { keyboard?: { lock(keys: string[]): Promise<void> } }).keyboard;
      if (keyboard?.lock) {
        try { await keyboard.lock(['Escape']); } catch { /* Fullscreen remains usable when keyboard permission is declined. */ }
      }
    }
    catch { setError('Fullscreen was unavailable. Use the stream’s fullscreen control or open it in a new tab.'); }
  }
  const compatible = versions.find(v => v.id === profile?.version)?.loaders || ['vanilla','fabric','forge','quilt','neoforge'];
  const filtered = versions.filter(v => (allTypes || v.type === 'release') && v.id.toLowerCase().includes(search.toLowerCase()));
  const running = !!session;
  const editingLocked = running || catalogBusy;
  function navigate(next: 'home' | 'instances' | 'settings' | 'account' | ContentType, anchor?: string) {
    setMode('java');setView(next); setCatalogSelection(undefined); setCatalogQuery('');
    requestAnimationFrame(() => document.getElementById(anchor || (['home','instances','settings','account'].includes(next) ? 'launcher-home' : 'content-catalog'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  async function contentInstalled(next: Profile, text: string) {
    setItems(await profiles()); setProfile(next); setMods(await getMods(next.id)); setMessage(text); setError('');
  }


  const modeMenu=<details className="mode-menu"><summary><img src={BASE+'/pigmc.png'} alt=""/>{mode==='java'?'Java Edition':'Eaglercraft'}<ChevronDown size={16}/></summary><div><button onClick={e=>{setMode('java');setView('home');e.currentTarget.closest('details')?.removeAttribute('open');}}>Java Edition</button><button onClick={e=>{setMode('eagler');setView('home');e.currentTarget.closest('details')?.removeAttribute('open');}}>Eaglercraft</button>{!hosted&&<button onClick={()=>setShowConnection(!showConnection)}>Connection settings</button>}</div></details>;
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href={BASE + '/'}><img className="brand-pig" src={BASE+"/pigmc.png"} alt=""/> pigmc<span className="beta">WEB</span></a>
      <div className="workspace-label">YOUR SPACE</div>
      <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}><HomeIcon size={19}/> Home</button>
      <button className="nav-item" onClick={() => navigate('home','instances-list')}><Layers size={19}/> Library</button>
      <button className={`nav-item ${view === 'modpack' ? 'active' : ''}`} onClick={() => navigate('modpack')}><Package size={19}/> Modpacks</button>
      <button className="nav-item" onClick={() => navigate('settings','play-settings')}><Settings size={19}/> Settings</button>
      <div className="workspace-label worlds-heading">MY INSTANCES <button disabled={editingLocked} onClick={addProfile} title="Add instance"><Plus size={16}/></button></div>
      {items.map(p => <button className={`profile-button ${p.id === profile?.id ? 'selected' : ''}`} disabled={editingLocked} key={p.id} onClick={() => void select(p.id)}><Box className="world-icon" size={20}/><span>{p.name}<small>{p.version} · {p.loader}</small></span></button>)}
      <div className="sidebar-bottom"><span className="dot"/> Browser storage <p>{storage || 'Stored on this device'}</p><small>Export a backup before clearing browser data.</small></div>
    </aside>
    <main>
      {view!=='home' && <header><div><span className="breadcrumb">YOUR SPACE</span><span className="divider">/</span> {view==='instances'?profile?.name||'Instance':view==='settings'?'Settings':view==='account'?'Account':view==='modpack'?'Modpacks':'Discover'}</div><form className="global-search" onSubmit={e => { e.preventDefault(); setCatalogSelection(undefined); setCatalogQuery(globalSearch); if(view==='modpack'){setView('modpack');}else{setView('instances');setInstanceTab('mods');setInstanceBrowse(true);} requestAnimationFrame(() => document.getElementById('content-catalog')?.scrollIntoView({ behavior: 'smooth' })); }}><input aria-label="Search mods and packs" placeholder="Search mods and packs…" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}/></form>{modeMenu}</header>}
      <div className={`content ${view==='home'?'home-content':''}`} id="launcher-home">
        {view === 'home' && mode==='java' && <section className="hero"><AnimatedBanner/>{modeMenu}<div className="hero-content"><h2>Ready when you are<span>.</span></h2><p>{profile?.name || 'My instance'} · {profile?.version} · {profile?.loader}</p><div className="hero-actions"><button className="primary" disabled={!profile} onClick={()=>navigate('instances')}><Box size={18}/> Open instance</button><button className="manage-button" disabled={editingLocked} onClick={()=>void addProfile()}><Plus size={18}/> New instance</button></div></div></section>}
        <div className="page-sections">
        {mode==='eagler'&&<div className="eagler-topbar">{modeMenu}</div>}
        {error && <div role="alert" className="notice error">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
        <div role="status" className="status"><span className={`dot ${running ? '' : 'grey'}`}/>{message}{lastSave && <span className="save-time">Saved to browser at {new Date(lastSave).toLocaleTimeString()}</span>}</div>
        {showConnection && !hosted && <section className="panel connection"><div className="panel-title"><h3>Connect to GitHub</h3><span>THIS TAB ONLY</span></div><p>Use a fine-grained token scoped to the session repository with Actions read/write. Your token is kept in session storage and sent only to GitHub.</p><div className="form-grid"><label>Session repository<input value={repo} disabled={editingLocked} onChange={e => setRepo(e.target.value)} placeholder="owner/repository" autoComplete="off"/></label><label>GitHub Actions token<input type="password" value={token} onChange={e => { setToken(e.target.value); sessionStorage.setItem('glide-token', e.target.value); }} autoComplete="off" spellCheck={false} placeholder="Paste your repository-scoped token"/></label></div><div className="inline-actions"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a scoped token ↗</a><button disabled={editingLocked} onClick={() => { setToken(''); sessionStorage.removeItem('glide-token'); }}>Disconnect</button></div></section>}
        {mode==='eagler'?<EaglerBrowser/>:<>
        {session?.url && <section className="panel player-panel"><div className="panel-title"><h3>Your session</h3><div className="inline-actions"><button onClick={fullscreen}><Maximize size={16}/> Fullscreen</button><a className="button-link" onClick={()=>setStreamDetached(true)} href={streamURL(session)} target="_blank" rel="noreferrer">Open stream ↗</a><button disabled={busy} onClick={stop}>Save & stop</button>{stopRequested&&<button onClick={forceStop}>Force stop</button>}</div></div><p>Use the stream’s Gaming Mode to capture your mouse and keyboard. Hold Escape to leave fullscreen when supported. If embedded playback is blocked, open the stream in a new tab.</p>{status?.MICROSOFT_LOGIN_CODE && status.stage === 'microsoft-login' && <div className="notice">Microsoft sign-in: <a href={status.MICROSOFT_LOGIN_URL} target="_blank" rel="noreferrer">Open Microsoft</a> and enter <strong>{status.MICROSOFT_LOGIN_CODE}</strong></div>}<div className="player" ref={screen}>{streamDetached?<button className="resume-stream" onClick={()=>{setStreamDetached(false);setStreamRevision(n=>n+1);}}>Resume stream here</button>:<iframe key={streamRevision} title="pigmc Minecraft stream" src={streamURL(session)} allow="fullscreen; autoplay; clipboard-read; clipboard-write" allowFullScreen sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-downloads" referrerPolicy="no-referrer"/>}</div><small>Live snapshots sync every minute. Use Save & stop for a final save after Minecraft exits.</small></section>}
        {running && status?.stage!=='minecraft-running' && <ProgressPanel value={launchProgress}><button disabled={busy} onClick={stop}>{session?.url?'Save & stop':'Cancel launch'}</button></ProgressPanel>}
        {view !== 'home' && view !== 'instances' && view !== 'settings' && view !== 'account' && profile && <ContentBrowser key={view} profile={profile} type={view} locked={running} initialProject={catalogSelection} initialQuery={catalogQuery} downloadRepo={repo} actionsToken={token} onInstalled={contentInstalled} onWorking={setCatalogBusy}/>}
        {(view === 'home' || view === 'instances' || view === 'settings') && <>
        {view === 'home' && <section className="panel instance-list" id="instances-list"><div className="panel-title"><h2><Box size={22}/> My instances</h2><button className="primary" disabled={editingLocked} onClick={addProfile}><Plus size={18}/> New instance</button></div>{items.map(p => <div className={`instance-row ${p.id === profile?.id ? 'selected' : ''}`} key={p.id}>{p.pack?.icon?<img src={imageURL(p.pack.icon)} alt=""/>:<Box className="instance-icon" size={54}/>}<div className="instance-row-name"><strong>{p.name}</strong><small>{p.version} · {p.loader}{p.loaderVersion ? ` ${p.loaderVersion}` : ''}</small></div><span className="instance-kind">{p.pack ? p.pack.provider : 'Local'}</span><button disabled={editingLocked} onClick={()=>void select(p.id)}><ArrowRight size={17}/> Open instance</button></div>)}</section>}
        {view==='instances' && <><div className="instance-heading"><span className="instance-cover">{profile?.pack?.icon?<img src={imageURL(profile.pack.icon)} alt=""/>:<Box size={34}/>}</span><div><span className="eyebrow">INSTANCE</span><h1>{profile?.name}</h1><small>{profile?.version} · {profile?.loader}{profile?.loaderVersion?` ${profile.loaderVersion}`:''} · {mods.length} mods</small></div><button className="primary" disabled={busy||editingLocked||!versions.length} onClick={()=>void start()}><Play size={20}/>{running?'Session active':'Play'}</button></div><nav className="detail-tabs" aria-label="Instance sections">{(['mods','settings','backups'] as const).map(t=><button key={t} className={(instanceTab===t||(t==='mods'&&['resourcepack','shader'].includes(instanceTab)))?'selected':''} onClick={()=>{setInstanceTab(t);setInstanceBrowse(false);}}>{{mods:'Content',settings:'Settings',backups:'Backups'}[t]}</button>)}</nav></>}
        {(view === 'instances' || view === 'settings') && <div className={`dashboard-grid ${view==='instances' && instanceTab!=='settings'?'single-panel':''}`}>
          {(view==='settings'||instanceTab==='settings') && <section className="panel" id="instance-settings"><div className="panel-title"><h3><Box size={18}/> Your instance</h3><span>01</span></div><div className="form-grid"><label>Instance name<input disabled={editingLocked} maxLength={80} value={profile?.name || ''} onBlur={()=>{if(profile && !profile.name.trim())void change({name:'My instance'});}} onChange={e => change({name:e.target.value})}/></label></div><div className="form-grid"><label>Minecraft version<input disabled={editingLocked} className="search" placeholder="Filter versions…" value={search} onChange={e => setSearch(e.target.value)}/><select disabled={editingLocked} value={profile?.version || ''} onChange={e => { const v = versions.find(v => v.id === e.target.value); change({ version:e.target.value, loader: v?.loaders.includes(profile?.loader || '') ? profile?.loader : 'vanilla' }); }}><option value={profile?.version}>{profile?.version}</option>{filtered.filter(v => v.id !== profile?.version).map(v => <option key={v.id} value={v.id}>{v.id}{v.type !== 'release' ? ` (${v.type})` : ''}</option>)}</select></label><label>Mod loader<select disabled={editingLocked} value={profile?.loader || 'vanilla'} onChange={e => change({loader:e.target.value})}>{compatible.map(l => <option key={l} value={l}>{l === 'neoforge' ? 'NeoForge' : l.charAt(0).toUpperCase()+l.slice(1)}</option>)}</select><small>Compatible loaders for this version</small></label></div><label className="checkbox"><input type="checkbox" checked={allTypes} onChange={e => setAllTypes(e.target.checked)}/> Include snapshots, alpha & beta</label><div className="panel-footer"><span><Clock size={14}/> Cached game files</span><span>{versions.length} versions</span></div></section>}
          {(view==='settings'||instanceTab==='settings') && <section className="panel" id="play-settings"><div className="panel-title"><h3><Settings size={18}/> Play settings</h3><span>02</span></div><div className="form-grid"><label>Memory<select disabled={editingLocked} value={profile?.memory || 4} onChange={e => change({memory:Number(e.target.value)})}>{[2,3,4,6,8].map(n => <option key={n} value={n}>{n} GB{n===4?' · Recommended':''}</option>)}</select></label><label>Resolution<select disabled={editingLocked} value={`${profile?.width || 1280}x${profile?.height || 720}`} onChange={e => { const [width,height] = e.target.value.split('x').map(Number); change({width,height}); }}>{['854x480','1280x720','1600x900','1920x1080'].map(s => <option key={s}>{s}</option>)}</select></label></div><label className="checkbox"><input type="checkbox" disabled={editingLocked} checked={profile?.performance!==false} onChange={e=>change({performance:e.target.checked})}/> Gameplay boost</label><p>Compatible performance mods and balanced Java settings. Rendering is capped at 960×540 with a 30 FPS stream; fullscreen scales the video. Turn off to use your selected resolution. Existing pack mods stay in place.</p><div className="panel-footer">Mouse capture and fullscreen are handled by the stream.</div></section>}
          {view==='instances' && instanceTab==='backups' && <section className="panel local-panel"><div className="panel-title"><h3><Package size={18}/> Yours. On this device.</h3><span className="local-tag">LOCAL</span></div><p>Your worlds, mods, and settings live in your browser. They travel directly to your private runner when you play.</p><div className="inline-actions"><button onClick={backup}><Download size={16}/> Export backup</button><label className="button-link"><Upload size={16}/> Import backup<input type="file" accept=".zip" disabled={editingLocked} onChange={async e => { const file=e.target.files?.[0]; if (file && profile) { try { const imported=await importProfile(profile.id,file); setProfile(imported);setItems(await profiles()); setMods(await getMods(profile.id)); setMessage('Profile imported into this browser.'); } catch(err) {setError(String(err));} } e.target.value=''; }}/></label></div><small>Keep this tab open for automatic backups. Browser storage can be cleared or evicted; exported ZIPs are your portable backup.</small><button className="delete" disabled={running || items.length < 2} onClick={async () => { if (profile && confirm(`Delete instance “${profile.name}” and its browser backups?`)) { await removeProfile(profile.id); const remaining=await profiles(); setItems(remaining); setProfile(remaining[0]); setMods(await getMods(remaining[0].id)); } }}>Delete instance</button></section>}
        </div>}</>}
        {view==='instances'&&profile&&!instanceBrowse&&['mods','resourcepack','shader'].includes(instanceTab)&&<InstanceContent key={profile.id} id={profile.id} mods={mods} locked={editingLocked} revision={message} onUpload={files=>void uploadMods(files)} onRemove={async name=>{const next=mods.filter(m=>m.name!==name);await saveMods(profile.id,next);setMods(next);}} onBrowse={kind=>{setCatalogSelection(undefined);setCatalogQuery('');setInstanceTab(kind==='mod'?'mods':kind);setInstanceBrowse(true);}}/>}
        {view==='instances'&&instanceBrowse&&<button onClick={()=>setInstanceBrowse(false)}><ArrowRight size={16}/> Back to installed content</button>}
        {view==='instances'&&profile&&(['mods','resourcepack','shader'].includes(instanceTab)&&instanceBrowse)&&<ContentBrowser key={profile.id+instanceTab} profile={profile} type={instanceTab==='mods'?'mod':instanceTab==='shader'?'shader':'resourcepack'} initialProject={catalogSelection} initialQuery={catalogQuery} locked={running} downloadRepo={repo} actionsToken={token} onInstalled={contentInstalled} onWorking={setCatalogBusy}/>}
        </>}
        <footer><span><Box size={14}/> Built for the way you play.</span><span>Remote play · {elapsed > 0 && running ? `${elapsed}s elapsed` : 'Your next adventure awaits'}</span></footer>
      </div></div>
    </main>
  </div>;
}
