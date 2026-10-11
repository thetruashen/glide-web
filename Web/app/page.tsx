'use client';
import { useEffect, useRef, useState } from 'react';
import { download, getBackup, getMods, importProfile, newProfile, packProfile, profiles, removeProfile, saveMods, saveProfile, storeBackup, type Mod, type Profile } from '../lib/storage';
import AnimatedBanner from '../components/AnimatedBanner';
import ContentBrowser from '../components/ContentBrowser';
import FeaturedPacks from '../components/FeaturedPacks';
import type { ContentType, Project } from '../lib/catalog-api';
import { connect, github, launch, persistSession, runner, RunnerEnded, streamURL, uploadProfile, type Session, type Status } from '../lib/session';

type Version = { id: string; type: string; loaders: string[] };
const DEFAULT_REPO = process.env.NEXT_PUBLIC_GLIDE_REPO || 'thetruashen/glide-web';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function Home() {
  const [view, setView] = useState<'home' | ContentType>('home');
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
  const [lastSave, setLastSave] = useState<number>();
  const [storage, setStorage] = useState('');
  const [showConnection, setShowConnection] = useState(false);
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
        let saved = await profiles();
        if (!saved.length) { const first = newProfile(); await saveProfile(first); saved = [first]; }
        setItems(saved); setProfile(saved[0]); setMods(await getMods(saved[0].id));
        setToken(sessionStorage.getItem('glide-token') || '');
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
          s = await connect(s, token);
          if (stopped) return;
          setSession(s);
          if (!s.url) { setMessage(`Preparing your runner · ${Math.round((Date.now() - s.created) / 1000)}s`); return; }
        }
        const current: Status = await (await runner(s, 'status')).json();
        if (stopped) return;
        setStatus(current);
        if (!current.started) {
          setMessage('Sending your local profile directly to the runner…');
          await uploadProfile(s, await packProfile(s.profileId));
          await runner(s, 'start', '{}');
          s = { ...s, uploaded: true }; persistSession(s); setSession(s);
        } else if (current.finished) {
          await checkpoint(s);
          if (s.runId) await github(s.repo, `actions/runs/${s.runId}/cancel`, token, {}, 'POST');
          sessionStorage.removeItem('glide-session'); setSession(undefined); setStatus(undefined);
          setMessage(current.error || 'Session finished. Your final save is in this browser.');
        } else {
          setMessage(current.stage === 'minecraft-running' ? 'Connected. Your world is ready.' : `Preparing game · ${current.stage.replaceAll('-', ' ')}`);
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
  async function select(id: string) { const selected = items.find(p => p.id === id); if (selected) { setProfile(selected); setMods(await getMods(id)); setLastSave(undefined); } }
  async function addProfile() { const p = newProfile(); p.name = `World ${items.length + 1}`; await saveProfile(p); setItems(await profiles()); setProfile(p); setMods([]); }
  async function start(profileToLaunch = profile) {
    if (!profileToLaunch || busy || session || catalogBusy) return;
    setProfile(profileToLaunch); setMods(await getMods(profileToLaunch.id));
    setError(''); setBusy(true);
    try {
      if (!token.trim()) { setShowConnection(true); throw new Error('Enter a repository-scoped GitHub token with Actions read/write access. It stays in this tab.'); }
      if (!/^[A-Za-z0-9_]{3,16}$/.test(profileToLaunch.username)) throw new Error('Use a username with 3–16 letters, digits or underscores.');
      if (profileToLaunch.auth === 'microsoft' && !profileToLaunch.clientId) throw new Error('Enter your Microsoft public-client application ID in settings.');
      const incompatible = (await getMods(profileToLaunch.id)).find(m => (m.gameVersion && m.gameVersion !== profileToLaunch.version) || (m.loader && m.loader !== profileToLaunch.loader));
      if (incompatible) throw new Error(`${incompatible.name} targets a different Minecraft version or loader. Update or remove it before launching.`);
      sessionStorage.setItem('glide-token', token.trim());
      await navigator.storage?.persist();
      setMessage('Starting a private runner…');
      setSession(await launch(profileToLaunch, repo.trim(), token.trim()));
      snapshotTime.current = Date.now();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function stop() {
    if (!session) return;
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
          const current: Status = await (await runner(session, 'status')).json();
          if (current.finished || !current.started) { finished = true; break; }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (!finished) throw new Error('Minecraft is still saving. Try Save & stop again shortly.');
        await checkpoint(session);
      }
      let s = session;
      if (!s.runId) { s = await connect(s, token); setSession(s); }
      if (!s.runId) throw new Error('Runner is still being queued. Try again shortly.');
      await github(s.repo, `actions/runs/${s.runId}/cancel`, token, {}, 'POST');
      sessionStorage.removeItem('glide-session'); setSession(undefined); setStatus(undefined);
      setMessage('Saved locally. The runner has been stopped.');
    } catch (e) { setError(String(e)); } finally { setBusy(false); stopping.current = false; }
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
    try { if (session?.url) await checkpoint(session); download(await packProfile(profile.id), `glide-${profile.version}-${profile.name.replace(/[^\w-]/g,'_')}.zip`); }
    catch (e) { setError(String(e)); }
  }
  async function fullscreen() {
    try {
      await screen.current?.requestFullscreen({ navigationUI: 'hide' });
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
  function navigate(next: 'home' | ContentType, anchor?: string) {
    setView(next); setCatalogSelection(undefined); setCatalogQuery('');
    requestAnimationFrame(() => document.getElementById(anchor || (next === 'home' ? 'launcher-home' : 'content-catalog'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  async function contentInstalled(next: Profile, text: string) {
    setItems(await profiles()); setProfile(next); setMods(await getMods(next.id)); setMessage(text); setError('');
  }


  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href={BASE + '/'}><span className="brand-icon">G</span> glide<span className="beta">WEB</span></a>
      <div className="workspace-label">YOUR SPACE</div>
      <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}><span>⌂</span> Home</button>
      <button className="nav-item" onClick={() => navigate('home','instances-list')}><span>▦</span> Instances</button>
      <button className={`nav-item ${view === 'mod' ? 'active' : ''}`} onClick={() => navigate('mod')}><span>✚</span> Mods</button>
      <button className={`nav-item ${view === 'modpack' ? 'active' : ''}`} onClick={() => navigate('modpack')}><span>▣</span> Modpacks</button>
      <button className={`nav-item ${view === 'resourcepack' ? 'active' : ''}`} onClick={() => navigate('resourcepack')}><span>▧</span> Resource Packs</button>
      <button className={`nav-item ${view === 'shader' ? 'active' : ''}`} onClick={() => navigate('shader')}><span>☀</span> Shaders</button>
      <button className="nav-item" onClick={() => navigate('home','play-settings')}><span>⚙</span> Settings</button>
      <button className="nav-item" onClick={() => setShowConnection(!showConnection)}><span>⌁</span> Connection</button>
      <div className="workspace-label worlds-heading">LOCAL PROFILES <button disabled={editingLocked} onClick={addProfile} title="Add profile">+</button></div>
      {items.map(p => <button className={`profile-button ${p.id === profile?.id ? 'selected' : ''}`} disabled={editingLocked} key={p.id} onClick={() => select(p.id)}><span className="world-icon">▦</span><span>{p.name}<small>{p.version} · {p.loader}</small></span></button>)}
      <div className="sidebar-bottom"><span className="dot"/> Browser storage <p>{storage || 'Stored on this device'}</p><small>Export a backup before clearing browser data.</small></div>
    </aside>
    <main>
      <header><div><span className="breadcrumb">YOUR SPACE</span><span className="divider">/</span> {view === 'home' ? 'Home' : view === 'modpack' ? 'Modpacks' : 'Discover'}</div><form className="global-search" onSubmit={e => { e.preventDefault(); setCatalogSelection(undefined); setCatalogQuery(globalSearch); setView(view === 'modpack' ? 'modpack' : 'mod'); requestAnimationFrame(() => document.getElementById('content-catalog')?.scrollIntoView({ behavior: 'smooth' })); }}><input aria-label="Search mods and packs" placeholder="⌕  Search mods and packs…" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}/></form><button className="account-chip" onClick={() => setShowConnection(!showConnection)}><span className={`dot ${token ? '' : 'grey'}`}/>{token ? 'GitHub connected' : 'Connect GitHub'}</button></header>
      <div className="content" id="launcher-home">
        <div className="page-heading"><div><span className="eyebrow">LESS WAITING. MORE EXPLORING.</span><h1>Your world, anywhere<span>.</span></h1><p>Minecraft on your browser. Everything you create stays yours.</p></div><span className="version-pill">GLIDE / 01</span></div>
        <div className="launcher-layout"><div className="launcher-main">
        <section className="hero"><AnimatedBanner/><div className="hero-content"><span className="hero-badge"><span className="dot"/> YOUR NEXT ADVENTURE</span><h2>Welcome back,<br/><span>{profile?.username || 'Player'}</span></h2><p>Play your way. Vanilla, modded, or something in between.</p><div className="hero-actions"><button className="primary" disabled={busy || editingLocked || !profile || !versions.length} onClick={() => void start()}>{busy ? (running ? 'Saving…' : 'Starting…') : catalogBusy ? 'Installing content…' : running ? 'Session in progress' : '▶ Play'}</button><button className="manage-button" onClick={() => navigate('home','instances-list')}>▦ Manage instances</button></div><small>Browser-local worlds · Private sessions · Cached game files</small></div></section>
        {error && <div role="alert" className="notice error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        <div role="status" className="status"><span className={`dot ${running ? '' : 'grey'}`}/>{message}{lastSave && <span className="save-time">Saved to browser at {new Date(lastSave).toLocaleTimeString()}</span>}</div>
        {showConnection && <section className="panel connection"><div className="panel-title"><h3>Connect to GitHub</h3><span>THIS TAB ONLY</span></div><p>Use a fine-grained token scoped to the session repository with Actions read/write. Your token is kept in session storage and sent only to GitHub.</p><div className="form-grid"><label>Session repository<input value={repo} disabled={editingLocked} onChange={e => setRepo(e.target.value)} placeholder="owner/repository" autoComplete="off"/></label><label>GitHub Actions token<input type="password" value={token} onChange={e => { setToken(e.target.value); sessionStorage.setItem('glide-token', e.target.value); }} autoComplete="off" spellCheck={false} placeholder="Paste your repository-scoped token"/></label></div><div className="inline-actions"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a scoped token ↗</a><button disabled={editingLocked} onClick={() => { setToken(''); sessionStorage.removeItem('glide-token'); }}>Disconnect</button></div></section>}
        {session?.url && <section className="panel player-panel"><div className="panel-title"><h3>Your session</h3><div className="inline-actions"><button onClick={fullscreen}>⛶ Fullscreen</button><a className="button-link" href={streamURL(session)} target="_blank" rel="noreferrer">Open stream ↗</a><button disabled={busy} onClick={stop}>Save & stop</button></div></div><p>Use the stream’s Gaming Mode to capture your mouse and keyboard. Hold Escape to leave fullscreen when supported. If embedded playback is blocked, open the stream in a new tab.</p>{status?.MICROSOFT_LOGIN_CODE && status.stage === 'microsoft-login' && <div className="notice">Microsoft sign-in: <a href={status.MICROSOFT_LOGIN_URL} target="_blank" rel="noreferrer">Open Microsoft</a> and enter <strong>{status.MICROSOFT_LOGIN_CODE}</strong></div>}<div className="player" ref={screen}><iframe title="Glide Minecraft stream" src={streamURL(session)} allow="fullscreen; autoplay; clipboard-read; clipboard-write" allowFullScreen sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-downloads" referrerPolicy="no-referrer"/></div><small>Live snapshots sync every minute. Use Save & stop for a final save after Minecraft exits.</small></section>}
        {running && !session?.url && <section className="panel queue"><div className="spinner"/><div><h3>Preparing your private session</h3><p>Restoring game files, starting the stream, and connecting your browser.</p></div><button disabled={busy} onClick={stop}>Cancel launch</button></section>}
        {view !== 'home' && profile && <ContentBrowser key={view} profile={profile} type={view} locked={running} initialProject={catalogSelection} initialQuery={catalogQuery} downloadRepo={repo} actionsToken={token} onInstalled={contentInstalled} onWorking={setCatalogBusy}/>}
        {view === 'home' && <>
        <FeaturedPacks onBrowse={() => navigate('modpack')} onOpen={project => { setCatalogSelection(project); setCatalogQuery(''); setView('modpack'); }}/>
        <section className="panel instance-list" id="instances-list"><div className="panel-title"><h3>▦ Instances</h3><button className="primary" disabled={editingLocked} onClick={addProfile}>＋ New instance</button></div>{items.map(p => <div className={`instance-row ${p.id === profile?.id ? 'selected' : ''}`} key={p.id}><img src={p.pack?.icon || BASE + '/banner-poster.jpg'} alt=""/><div className="instance-row-name"><strong>{p.name}</strong><small>{p.version} · {p.loader}{p.loaderVersion ? ` ${p.loaderVersion}` : ''}</small></div><span className="instance-kind">{p.pack ? p.pack.provider : 'Local'}</span><button disabled={editingLocked} onClick={() => void select(p.id)}>Manage</button><button className="primary" disabled={busy || editingLocked || !versions.length} onClick={() => void start(p)}>▶ Play</button></div>)}</section>
        <div className="dashboard-grid">
          <section className="panel" id="instance-settings"><div className="panel-title"><h3><span className="panel-icon">◈</span> Your instance</h3><span>01</span></div><div className="form-grid"><label>Profile name<input disabled={editingLocked} value={profile?.name || ''} onChange={e => change({name:e.target.value})}/></label><label>Player name<input disabled={editingLocked} maxLength={16} value={profile?.username || ''} onChange={e => change({username:e.target.value})}/></label></div><div className="form-grid"><label>Minecraft version<input disabled={editingLocked} className="search" placeholder="Filter versions…" value={search} onChange={e => setSearch(e.target.value)}/><select disabled={editingLocked} value={profile?.version || ''} onChange={e => { const v = versions.find(v => v.id === e.target.value); change({ version:e.target.value, loader: v?.loaders.includes(profile?.loader || '') ? profile?.loader : 'vanilla' }); }}><option value={profile?.version}>{profile?.version}</option>{filtered.filter(v => v.id !== profile?.version).map(v => <option key={v.id} value={v.id}>{v.id}{v.type !== 'release' ? ` (${v.type})` : ''}</option>)}</select></label><label>Mod loader<select disabled={editingLocked} value={profile?.loader || 'vanilla'} onChange={e => change({loader:e.target.value})}>{compatible.map(l => <option key={l} value={l}>{l === 'neoforge' ? 'NeoForge' : l.charAt(0).toUpperCase()+l.slice(1)}</option>)}</select><small>Compatible loaders for this version</small></label></div><label className="checkbox"><input type="checkbox" checked={allTypes} onChange={e => setAllTypes(e.target.checked)}/> Include snapshots, alpha & beta</label><div className="panel-footer"><span>◷ Game files are reused across launches</span><span>{versions.length} versions</span></div></section>
          <section className="panel mods-panel"><div className="panel-title"><h3><span className="panel-icon">▧</span> Mods</h3><span>{mods.length.toString().padStart(2,'0')}</span></div><label className={`dropzone ${running ? 'disabled' : ''}`}><span className="upload-icon">↑</span><strong>Bring your favorite mods</strong><span>Choose .jar files · Stored in this browser</span><input type="file" multiple accept=".jar" disabled={editingLocked} onChange={e => { void uploadMods(e.target.files); e.target.value=''; }}/><span className="browse">Browse files</span></label><div className="mod-list">{mods.map(mod => <div className="mod" key={mod.name}><span>▧</span><div>{mod.name}<small>{(mod.blob.size / 1048576).toFixed(1)} MB</small></div><button disabled={editingLocked} aria-label={`Remove ${mod.name}`} onClick={async () => { if (!profile) return; const next = mods.filter(m => m.name !== mod.name); await saveMods(profile.id,next); setMods(next); }}>×</button></div>)}</div><div className="inline-actions"><button onClick={() => navigate('mod')}>Browse & install mods →</button></div><small>Use mods matching both your Minecraft version and loader.</small></section>
          <section className="panel" id="play-settings"><div className="panel-title"><h3><span className="panel-icon">⌘</span> Play settings</h3><span>02</span></div><div className="form-grid"><label>Memory<select disabled={editingLocked} value={profile?.memory || 4} onChange={e => change({memory:Number(e.target.value)})}>{[2,3,4,6,8].map(n => <option key={n} value={n}>{n} GB{n===4?' · Recommended':''}</option>)}</select></label><label>Resolution<select disabled={editingLocked} value={`${profile?.width || 1280}x${profile?.height || 720}`} onChange={e => { const [width,height] = e.target.value.split('x').map(Number); change({width,height}); }}>{['854x480','1280x720','1600x900','1920x1080'].map(s => <option key={s}>{s}</option>)}</select></label></div><label>Account mode<select disabled={editingLocked} value={profile?.auth || 'offline'} onChange={e => change({auth:e.target.value})}><option value="offline">Offline · Local worlds and offline servers</option><option value="microsoft">Microsoft · Minecraft Java account</option></select></label>{profile?.auth === 'microsoft' && <label>Microsoft application ID<input disabled={editingLocked} placeholder="Registered public-client application ID" value={profile.clientId} onChange={e => change({clientId:e.target.value})}/><small>Sign in securely using Microsoft’s device-code page when your runner starts.</small></label>}<div className="panel-footer">Mouse capture and fullscreen are handled by the stream.</div></section>
          <section className="panel local-panel"><div className="panel-title"><h3><span className="panel-icon">▣</span> Yours. On this device.</h3><span className="local-tag">LOCAL</span></div><p>Your worlds, mods, and settings live in your browser. They travel directly to your private runner when you play.</p><div className="storage-flow"><span>▣ Browser</span><span>⇄</span><span>◈ Private runner</span></div><div className="inline-actions"><button onClick={backup}>↓ Export backup</button><label className="button-link">↑ Import backup<input type="file" accept=".zip" disabled={editingLocked} onChange={async e => { const file=e.target.files?.[0]; if (file && profile) { try { await importProfile(profile.id,file); setMods(await getMods(profile.id)); setMessage('Profile imported into this browser.'); } catch(err) {setError(String(err));} } e.target.value=''; }}/></label></div><small>Keep this tab open for automatic backups. Browser storage can be cleared or evicted; exported ZIPs are your portable backup.</small><button className="delete" disabled={running || items.length < 2} onClick={async () => { if (profile && confirm(`Delete local profile “${profile.name}” and its browser backups?`)) { await removeProfile(profile.id); const remaining=await profiles(); setItems(remaining); setProfile(remaining[0]); setMods(await getMods(remaining[0].id)); } }}>Delete local profile</button></section>
        </div></>}
        </div><aside className="quick-rail"><section className="panel"><div className="panel-title"><h3>▣ Active instance</h3></div><img className="rail-art" src={profile?.pack?.icon || BASE + '/banner-poster.jpg'} alt=""/><h3>{profile?.name || 'Loading…'}</h3><p>{profile?.version} · {profile?.loader}</p><div className="rail-facts"><span>Installed mods<strong>{mods.length}</strong></span><span>Memory<strong>{profile?.memory} GB</strong></span><span>Storage<strong>This browser</strong></span></div></section><section className="panel"><div className="panel-title"><h3>⚒ Quick actions</h3></div><button onClick={() => navigate('mod')}>✚ Install mod</button><button onClick={() => navigate('modpack')}>▣ Browse modpacks</button><button onClick={() => navigate('resourcepack')}>▧ Install resource pack</button><button onClick={() => navigate('shader')}>☀ Browse shaders</button><button onClick={backup}>↓ Export backup</button><button onClick={() => navigate('home','play-settings')}>⚙ Settings</button></section><section className="panel"><div className="panel-title"><h3>◷ Session activity</h3></div><p>{message}</p>{lastSave ? <small>Last saved locally: {new Date(lastSave).toLocaleString()}</small> : <small>Automatic snapshots appear here when you play.</small>}</section></aside></div>
        <footer><span><span className="brand-mini">G</span> Built for the way you play.</span><span>GitHub Pages + Actions · {elapsed > 0 && running ? `${elapsed}s elapsed` : 'Your next adventure awaits'}</span></footer>
      </div>
    </main>
  </div>;
}
