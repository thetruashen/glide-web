'use client';
import { useEffect, useRef, useState } from 'react';
import {ArrowLeft,ArrowRight,SlidersHorizontal,Download,ExternalLink,Package,Search,Upload} from 'lucide-react';
import ProjectText from './ProjectText';
import ProgressPanel from './ProgressPanel';
import type {ProgressInfo} from '../lib/progress';
import {gatewayDownload} from '../lib/gateway-download';
import { categories as getCategories, type Category, changelog, clearCatalogCache, curseKey, downloadable, getDescription, getProject, hostedCatalog, releasePage, releases, searchProjects, type CatalogFile, type ContentType, type Project, type Provider, type Release } from '../lib/catalog-api';
import { commitInstallation, getBackup, getMods, type Profile } from '../lib/storage';
import { fileFetcher, installAsset, installMod, installPack } from '../lib/install-content';
import { DownloadHelper } from '../lib/download-helper';

type Props = { profile: Profile; type: ContentType; locked: boolean; initialProject?: Project; initialQuery?: string; downloadRepo?: string; actionsToken?: string; onInstalled(profile: Profile, message: string): Promise<void>; onWorking(working: boolean): void };
type Manual = { file: CatalogFile; resolve(blob: Blob): void; reject(error: Error): void };
const label = { mod: 'Mods', modpack: 'Modpacks', resourcepack: 'Resource packs', shader: 'Shaders' };
const count = (value: number) => new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(value || 0);
export default function ContentBrowser({ profile, type, locked, initialProject, initialQuery, downloadRepo, actionsToken, onInstalled, onWorking }: Props) {
  const [provider, setProvider] = useState<Provider>(type === 'modpack' ? 'curseforge' : 'modrinth');
  const [query, setQuery] = useState('');
  const [categoryOptions,setCategoryOptions]=useState<Category[]>([]);
  const [categoryIds,setCategoryIds]=useState<string[]>([]);
  const [versionOptions,setVersionOptions]=useState<string[]>([]);
  const [versionSearch,setVersionSearch]=useState('');
  const [gameFilter,setGameFilter]=useState('');
  const [searchLoader,setSearchLoader]=useState('');
  const [environment,setEnvironment]=useState<''|'client_only'|'client_and_server'|'server_only'>('');
  const [openSource,setOpenSource]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [sort, setSort] = useState<'downloads'|'relevance'|'updated'>('downloads');
  const [onlyCompatible, setOnlyCompatible] = useState(type !== 'modpack');
  const effectiveVersion=onlyCompatible?profile.version:gameFilter || undefined;
  const effectiveLoader=searchLoader || (onlyCompatible && profile.loader!=='vanilla'?profile.loader:undefined);
  const [key, setKey] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Project>();
  const [description, setDescription] = useState('');
  const [versions, setVersions] = useState<Release[]>([]);
  const [versionId, setVersionId] = useState('');
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState('');
  const [installProgress,setInstallProgress]=useState<ProgressInfo>({title:'Preparing installation'});
  const [transferProgress,setTransferProgress]=useState<ProgressInfo>();
  const [completed,setCompleted]=useState(false);
  const lastRelease=useRef<Release | undefined>(undefined);
  const [manual, setManual] = useState<Manual>();
  const manualRef = useRef<Manual | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const detailRequest = useRef(0);
  const [tab,setTab]=useState<'description'|'gallery'|'changelog'|'versions'>('description');
  const [releaseFilter,setReleaseFilter]=useState('');
  const [loaderFilter,setLoaderFilter]=useState('');
  const [changes,setChanges]=useState('');
  const [olderOffset,setOlderOffset]=useState(50);
  const [moreVersions,setMoreVersions]=useState(false);
  const [olderBusy,setOlderBusy]=useState(false);
  const installed = useRef(false);
  useEffect(() => { setKey(curseKey()); return () => { controller.current?.abort(); manualRef.current?.reject(new Error('Installation cancelled')); }; }, []);
  useEffect(() => { if (initialQuery !== undefined) setQuery(initialQuery); }, [initialQuery]);
  useEffect(()=>{const abort=new AbortController();setCategoryIds([]);getCategories(provider,type,abort.signal).then(setCategoryOptions).catch(()=>setCategoryOptions([]));return()=>abort.abort();},[provider,type,key]);
  useEffect(()=>{fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/versions.json`).then(r=>r.json()).then(c=>setVersionOptions(c.versions.map((v:{id:string})=>v.id))).catch(()=>{});},[]);
  useEffect(() => { setOffset(0); }, [query, provider, type, sort, onlyCompatible, profile.version, profile.loader,gameFilter,searchLoader,categoryIds,environment,openSource]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setProjects([]); setTotal(0); setError('');
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        if (type === 'mod' && onlyCompatible && profile.loader === 'vanilla' && !searchLoader) { setProjects([]); setTotal(0); return; }
        const result = await searchProjects({ provider, type, query, sort, offset, version:effectiveVersion,loader:effectiveLoader,categories:categoryIds,environment:provider==='modrinth'?environment:undefined,openSource:provider==='modrinth'?openSource:undefined }, abort.signal);
        if (!abort.signal.aborted) { setProjects(result.projects); setTotal(result.total); }
      } catch (e) { if (!abort.signal.aborted) { setProjects([]); setError(String(e)); } }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }, 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, provider, type, sort, offset, onlyCompatible, profile.version, profile.loader, key, retry,gameFilter,searchLoader,categoryIds,environment,openSource]);
  async function open(project: Project) {
    const request = ++detailRequest.current;
    setSelected(project); setDescription(''); setVersions([]); setVersionId(''); setDetailsLoading(true); setError(''); setTab('description'); setReleaseFilter(''); setLoaderFilter('');
    try {
      const [body, page, full] = await Promise.all([getDescription(project), releasePage(project), getProject(project.provider,project.id)]);
      if (request !== detailRequest.current) return;
      const files=page.items; setOlderOffset(50);setMoreVersions(project.provider==='curseforge'&&page.total>50);setSelected({...full,author:full.author || project.author}); setDescription(body); setVersions(files); setVersionId((files.find(v=>type==='modpack' || (v.gameVersions.includes(profile.version) && (type!=='mod' || v.loaders.includes(profile.loader)))) || files[0])?.id || ''); window.scrollTo({top:0});
    } catch (e) { if (request === detailRequest.current) setError(String(e)); } finally { if (request === detailRequest.current) setDetailsLoading(false); }
  }
  useEffect(() => { if (initialProject) { setProvider(initialProject.provider); void open(initialProject); } }, [initialProject]);
  useEffect(()=>{let active=true;const release=versions.find(v=>v.id===versionId);setChanges('Loading changelog…');if(release)changelog(release).then(text=>{if(active)setChanges(text);}).catch(e=>{if(active)setChanges(String(e));});return()=>{active=false;};},[versions,versionId]);
  function cancelInstall() { controller.current?.abort(); manualRef.current?.reject(new Error('Installation cancelled')); setManual(undefined); manualRef.current = undefined; }
  function requestManual(file: CatalogFile): Promise<Blob> {
    setInstallProgress(current=>({...current,title:'Waiting for author download',detail:file.name}));
    return new Promise((resolve, reject) => { const value = { file, resolve, reject }; manualRef.current = value; setManual(value); });
  }
  async function perform(release?: Release, archive?: File) {
    if (locked || installing || controller.current) return;
    installed.current = false;lastRelease.current=release;setCompleted(false);setInstallProgress({title:'Resolving dependencies'});setTransferProgress(undefined);setInstalling(true); onWorking(true); setError(''); setProgress('Resolving dependencies…');
    const abort = new AbortController(); controller.current = abort;
    const helper = actionsToken?.trim() && downloadRepo ? new DownloadHelper(downloadRepo, actionsToken.trim(), setProgress) : undefined;
    try {
      const report=(value:ProgressInfo)=>{setInstallProgress(value);if(value.fileIndex!==undefined)setTransferProgress(undefined);};
      const fetchFile = fileFetcher(abort.signal, requestManual, hostedCatalog() ? file=>gatewayDownload(file,abort.signal,setTransferProgress) : helper ? file => helper.fetch(file,abort.signal) : undefined,setTransferProgress);
      if (type === 'modpack' || archive) {
        setInstallProgress({title:archive?'Reading uploaded pack':'Downloading pack archive'});
        const packProvider = archive ? (archive.name.endsWith('.mrpack') ? 'modrinth' : 'curseforge') : release!.provider;
        const file = archive || await fetchFile(await downloadable(release!));
        setInstallProgress({title:'Reading pack manifest'});setTransferProgress(undefined);
        const result = await installPack(file, packProvider, fetchFile, setProgress, abort.signal,report);
        const next: Profile = { ...profile, id: crypto.randomUUID(), name: result.name, ...result.settings, memory: Math.max(profile.memory, 6), pack: { provider: packProvider, projectId: release?.projectId || 'local-import', versionId: release?.id || 'local-import', title: result.name, icon: selected?.icon } };
        setInstallProgress({title:'Saving to this browser'});setTransferProgress(undefined);abort.signal.throwIfAborted(); await commitInstallation(next, result.mods, result.backup);
        await onInstalled(next, `${result.name} installed as a new local instance (${result.mods.length} mods).`);
      } else if (release && type === 'mod') {
        const mods = await installMod(release, profile, await getMods(profile.id), fetchFile, setProgress, abort.signal,report);
        setInstallProgress({title:'Saving to this browser'});setTransferProgress(undefined);abort.signal.throwIfAborted(); await commitInstallation(profile, mods);
        await onInstalled(profile, 'Mod and required dependencies installed in this browser.');
      } else if (release) {
        const backup = await installAsset(await downloadable(release), type, await getBackup(profile.id), fetchFile);
        setInstallProgress({title:'Saving to this browser'});setTransferProgress(undefined);abort.signal.throwIfAborted(); await commitInstallation(profile, await getMods(profile.id), backup);
        await onInstalled(profile, `${label[type]} installed in this browser.`);
      }
      installed.current = true;setCompleted(true);setInstallProgress({title:'Installation complete',detail:'Your instance is saved in this browser.',percent:100});setTransferProgress(undefined); setSelected(undefined);
    } catch (e) {setTransferProgress(undefined);setInstallProgress({title:abort.signal.aborted?'Installation cancelled':'Installation failed',detail:progress,stopped:true});setCompleted(true); setError(abort.signal.aborted ? 'Installation cancelled. Your existing files are unchanged.' : String(e)); }
    finally { await helper?.close(); setInstalling(false); onWorking(false); setManual(undefined); manualRef.current = undefined; controller.current = undefined; }
  }
  async function loadOlder() {if(!selected||olderBusy)return;setOlderBusy(true);try{const page=await releasePage(selected,undefined,undefined,olderOffset);setVersions(current=>[...current,...page.items.filter(v=>!current.some(c=>c.id===v.id))]);setOlderOffset(olderOffset+50);setMoreVersions(olderOffset+50<page.total);}catch(e){setError(String(e));}finally{setOlderBusy(false);}}
  const chosen=versions.find(v=>v.id===versionId);
  const canInstall=(v:Release)=>type==='modpack'||(v.gameVersions.includes(profile.version)&&(type!=='mod'||v.loaders.includes(profile.loader)));
  const feedback=<>{error&&<div className="notice error" role="alert">{error}<button onClick={()=>{setError('');if(lastRelease.current)void perform(lastRelease.current);else setRetry(retry+1);}}>Retry</button></div>}{(installing||completed)&&<><ProgressPanel value={{...installProgress,detail:installProgress.detail || (installing?progress:undefined)}}>{installing?<button onClick={cancelInstall}>Cancel</button>:<button onClick={()=>setCompleted(false)}>Dismiss</button>}</ProgressPanel>{transferProgress&&<ProgressPanel value={transferProgress}/>}</>}{manual&&<div className="manual-download"><strong>Author download required: {manual.file.name}</strong><p>The author has not made this file available through the API. Choose the official file to continue; its checksum is verified.</p><a href={manual.file.manualUrl||manual.file.url||selected?.url} target="_blank" rel="noreferrer">Official download page <ExternalLink size={16}/></a><label className="button-link"><Upload size={16}/> Choose file<input type="file" onChange={e=>{const file=e.target.files?.[0];if(file){manual.resolve(file);manualRef.current=undefined;setManual(undefined);}e.target.value='';}}/></label></div>}</>;
  if(selected)return <section className="project-page" id="content-catalog">
    <button className="back-link" disabled={installing} onClick={()=>{++detailRequest.current;setSelected(undefined);setError('');}}><ArrowLeft size={18}/> Back to {label[type].toLowerCase()}</button>
    <div className="project-header"><div className="project-icon">{selected.icon?<img src={selected.icon} alt=""/>:<Package/>}</div><div className="project-heading"><span className="eyebrow">{selected.provider} · {label[type]}</span><h1>{selected.title}</h1><p>{selected.description}</p><div className="project-meta"><span>By {selected.author||'the project team'}</span><span><Download size={16}/>{count(selected.downloads)}</span></div></div><button className="primary" disabled={detailsLoading||!chosen||!canInstall(chosen)||locked||installing} onClick={()=>void perform(chosen)}><Download size={18}/>{installing?'Installing…':'Install'}</button></div>
    <nav className="detail-tabs" aria-label="Project sections">{(['description','gallery','changelog','versions'] as const).map(t=><button key={t} className={tab===t?'selected':''} aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}{t==='versions'&&` (${versions.length})`}</button>)}</nav>{feedback}
    <div className="project-layout"><div className="project-body">{detailsLoading?<div className="catalog-empty">Loading project…</div>:<>
      {tab==='description'&&<ProjectText base={selected.url}>{description||selected.description}</ProjectText>}
      {tab==='gallery'&&<div className="gallery-grid">{selected.gallery?.length?selected.gallery.map((g,i)=><figure key={i}><a href={g.url} target="_blank" rel="noreferrer"><img loading="lazy" src={g.url} alt={g.title||`${selected.title} screenshot ${i+1}`}/></a>{g.title&&<figcaption>{g.title}</figcaption>}</figure>):<p>No gallery images provided.</p>}</div>}
      {tab==='changelog'&&<><label>Release<select value={versionId} onChange={e=>setVersionId(e.target.value)}>{versions.map(v=><option key={v.id} value={v.id}>{v.title}</option>)}</select></label><ProjectText base={selected.url}>{changes}</ProjectText></>}
      {tab==='versions'&&<><div className="versions-filters"><select aria-label="Filter Minecraft versions" value={releaseFilter} onChange={e=>setReleaseFilter(e.target.value)}><option value="">All Minecraft versions</option>{[...new Set(versions.flatMap(v=>v.gameVersions).filter(v=>/^\d/.test(v)))].map(v=><option key={v}>{v}</option>)}</select><select aria-label="Filter loaders" value={loaderFilter} onChange={e=>setLoaderFilter(e.target.value)}><option value="">All loaders</option>{[...new Set(versions.flatMap(v=>v.loaders))].map(v=><option key={v}>{v}</option>)}</select></div><div className="version-list">{versions.filter(v=>(!releaseFilter||v.gameVersions.includes(releaseFilter))&&(!loaderFilter||v.loaders.includes(loaderFilter))).map(v=><article key={v.id}><div><strong>{v.title}</strong><div className="project-tags">{v.gameVersions.filter(g=>/^\d/.test(g)).slice(0,5).map(g=><span key={g}>{g}</span>)}{v.loaders.map(l=><span key={l}>{l}</span>)}</div><small>{new Date(v.date).toLocaleDateString()} · {v.files[0]?.name}</small></div><button disabled={locked||installing||!canInstall(v)} title={canInstall(v)?'Install this release':'Change the instance version or loader first'} onClick={()=>{setVersionId(v.id);void perform(v);}}><Download size={16}/> Install</button></article>)}</div>{moreVersions && <button disabled={olderBusy||installing} onClick={()=>void loadOlder()}>{olderBusy?'Loading…':'Load older releases'}</button>}</>}
    </>}</div><aside className="project-info"><section><h3>Install to</h3><p>{type==='modpack'?'A new instance':profile.name}</p><small>{type==='modpack'?'Uses the pack’s Minecraft version and loader.':`${profile.version} · ${profile.loader}`}</small><label>Selected release<select value={versionId} disabled={installing} onChange={e=>setVersionId(e.target.value)}>{versions.map(v=><option key={v.id} value={v.id}>{v.title}</option>)}</select></label>{chosen&&!canInstall(chosen)&&<p className="warning">Choose a compatible release or change your instance version and loader.</p>}</section><section><h3>Compatibility</h3><div className="project-tags">{[...new Set(versions.flatMap(v=>v.loaders))].map(l=><span key={l}>{l}</span>)}</div><div className="project-tags">{[...new Set(versions.flatMap(v=>v.gameVersions).filter(v=>/^\d/.test(v)))].slice(0,18).map(v=><span key={v}>{v}</span>)}</div></section><section><h3>Categories</h3><div className="project-tags">{selected.categories.map(c=><span key={c}>{c}</span>)}</div><a href={selected.url} target="_blank" rel="noreferrer">View on {selected.provider} <ExternalLink size={14}/></a></section></aside></div>
  </section>;
  return <section className="catalog" id="content-catalog"><div className="catalog-heading"><div><h1>{label[type]}</h1><p>{type==='modpack'?'Find your next adventure. Every pack gets its own instance.':`Discover content for ${profile.name}.`}</p></div>{type==='modpack'&&<label className="button-link"><Upload size={16}/> Import pack<input type="file" accept=".zip,.mrpack" disabled={locked||installing} onChange={e=>{const file=e.target.files?.[0];if(file)void perform(undefined,file);e.target.value='';}}/></label>}</div><div className="provider-tabs" role="group" aria-label="Content provider">{(['modrinth','curseforge'] as const).map(p=><button key={p} className={provider===p?'selected':''} disabled={installing} onClick={()=>setProvider(p)}>{p==='modrinth'?'Modrinth':'CurseForge'}</button>)}</div>
    {provider==='curseforge'&&!hostedCatalog()&&<details className="cf-credential"><summary>Configure local CurseForge access</summary><label>CurseForge API key<input type="password" autoComplete="off" value={key} onChange={e=>{setKey(e.target.value);sessionStorage.setItem('glide-curseforge-key',e.target.value.trim());clearCatalogCache();}}/></label></details>}
    <button className="filter-toggle" onClick={()=>setShowFilters(!showFilters)}><SlidersHorizontal size={16}/> Filters</button>
    <div className="catalog-columns"><aside className={`catalog-filters ${showFilters?'expanded':''}`}><div className="filter-heading"><strong>Filters</strong><button onClick={()=>{setCategoryIds([]);setGameFilter('');setSearchLoader('');setEnvironment('');setOpenSource(false);setOnlyCompatible(false);}}>Reset</button></div>
    <section><h3>Game version</h3><label className="checkbox"><input type="checkbox" checked={onlyCompatible} onChange={e=>setOnlyCompatible(e.target.checked)}/> Match my instance</label><input aria-label="Find game versions" placeholder="Find a version…" value={versionSearch} onChange={e=>setVersionSearch(e.target.value)}/><select aria-label="Filter game version" value={onlyCompatible?profile.version:gameFilter} onChange={e=>{setOnlyCompatible(false);setGameFilter(e.target.value);}}><option value="">All versions</option>{versionOptions.filter(v=>v.includes(versionSearch)).map(v=><option key={v}>{v}</option>)}</select></section>
    {(type==='mod'||type==='modpack')&&<section><h3>Loader</h3><select aria-label="Filter mod loader" value={effectiveLoader||''} disabled={provider==='curseforge'&&!effectiveVersion} onChange={e=>{setOnlyCompatible(false);setGameFilter(effectiveVersion||'');setSearchLoader(e.target.value);}}><option value="">All loaders</option>{['fabric','forge','neoforge','quilt'].map(l=><option key={l} value={l}>{l==='neoforge'?'NeoForge':l.charAt(0).toUpperCase()+l.slice(1)}</option>)}</select>{provider==='curseforge'&&!effectiveVersion&&<small>Select a game version to filter by loader.</small>}</section>}
    <section><h3>Categories</h3><div className="category-options">{categoryOptions.map(c=><label key={c.id} className="checkbox"><input type="checkbox" checked={categoryIds.includes(c.id)} disabled={!categoryIds.includes(c.id)&&categoryIds.length>=10} onChange={e=>setCategoryIds(e.target.checked?[...categoryIds,c.id]:categoryIds.filter(id=>id!==c.id))}/>{c.name}</label>)}</div>{!categoryOptions.length&&<small>No category filters available.</small>}</section>
    {provider==='modrinth'&&<section><h3>Environment</h3><select aria-label="Filter environment" value={environment} onChange={e=>setEnvironment(e.target.value as typeof environment)}><option value="">Any environment</option><option value="client_only">Client only</option><option value="client_and_server">Client and server</option><option value="server_only">Server only</option></select><label className="checkbox"><input type="checkbox" checked={openSource} onChange={e=>setOpenSource(e.target.checked)}/> Open source only</label></section>}
    </aside><div className="catalog-results">
    <div className="catalog-toolbar"><div className="search-field"><Search size={18}/><input aria-label={`Search ${label[type].toLowerCase()}`} placeholder={`Search ${label[type].toLowerCase()}…`} value={query} onChange={e=>setQuery(e.target.value)}/></div><select aria-label="Sort catalog" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="downloads">Most downloaded</option><option value="relevance">Relevance</option><option value="updated">Recently updated</option></select></div><div className="catalog-summary">{loading?'Searching…':`${count(total)} results`}</div>{feedback}
    {!loading&&!error&&!projects.length&&<div className="catalog-empty">{type==='mod'&&profile.loader==='vanilla'&&onlyCompatible?'Choose a mod loader in instance settings to install mods.':'No results. Try another search or remove the version filter.'}</div>}
    <div className="project-list" aria-busy={loading}>{projects.map(p=><button className="project-row" key={`${p.provider}:${p.id}`} disabled={installing} onClick={()=>void open(p)}><div className="project-icon">{p.icon?<img loading="lazy" src={p.icon} alt=""/>:<Package/>}</div><div className="project-row-text"><h3>{p.title}<small> by {p.author}</small></h3><p>{p.description}</p><div className="project-tags">{p.categories.slice(0,4).map(c=><span key={c}>{c}</span>)}</div></div><span className="project-downloads"><Download size={16}/>{count(p.downloads)}</span><ArrowRight size={18}/></button>)}</div><div className="catalog-pagination"><button disabled={offset===0||loading||installing} onClick={()=>setOffset(Math.max(0,offset-12))}><ArrowLeft size={16}/> Previous</button><span>Page {Math.floor(offset/12)+1}</span><button disabled={offset+12>=total||loading||installing} onClick={()=>setOffset(offset+12)}>Next <ArrowRight size={16}/></button></div>
    </div></div>
  </section>;
}
