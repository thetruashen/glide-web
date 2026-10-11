'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { clearCatalogCache, curseKey, downloadable, getDescription, releases, searchProjects, type CatalogFile, type ContentType, type Project, type Provider, type Release } from '../lib/catalog-api';
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
  const [sort, setSort] = useState<'downloads'|'relevance'|'updated'>('downloads');
  const [onlyCompatible, setOnlyCompatible] = useState(type !== 'modpack');
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
  const [manual, setManual] = useState<Manual>();
  const manualRef = useRef<Manual | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const detailRequest = useRef(0);
  const modal = useRef<HTMLDialogElement>(null);
  const installed = useRef(false);
  useEffect(() => { setKey(curseKey()); return () => { controller.current?.abort(); manualRef.current?.reject(new Error('Installation cancelled')); }; }, []);
  useEffect(() => { if (initialQuery !== undefined) setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => { setOffset(0); }, [query, provider, type, sort, onlyCompatible, profile.version, profile.loader]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        if (type === 'mod' && onlyCompatible && profile.loader === 'vanilla') { setProjects([]); setTotal(0); return; }
        const result = await searchProjects({ provider, type, query, sort, offset, version: onlyCompatible ? profile.version : undefined, loader: onlyCompatible ? profile.loader : undefined }, abort.signal);
        if (!abort.signal.aborted) { setProjects(result.projects); setTotal(result.total); }
      } catch (e) { if (!abort.signal.aborted) { setProjects([]); setError(String(e)); } }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }, 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, provider, type, sort, offset, onlyCompatible, profile.version, profile.loader, key, retry]);
  async function open(project: Project) {
    const request = ++detailRequest.current;
    setSelected(project); setDescription(''); setVersions([]); setVersionId(''); setDetailsLoading(true); setError('');
    try {
      const [body, files] = await Promise.all([getDescription(project), releases(project, type === 'modpack' ? undefined : profile.version, type === 'mod' ? profile.loader : undefined)]);
      if (request !== detailRequest.current) return;
      setDescription(body); setVersions(files); setVersionId(files[0]?.id || '');
    } catch (e) { if (request === detailRequest.current) setError(String(e)); } finally { if (request === detailRequest.current) setDetailsLoading(false); }
  }
  useEffect(() => { if (initialProject) { setProvider(initialProject.provider); void open(initialProject); } }, [initialProject]);
  useEffect(() => {
    if (selected && !modal.current?.open) modal.current?.showModal();
    if (!selected && modal.current?.open) modal.current?.close();
  }, [selected]);
  function cancelInstall() { controller.current?.abort(); manualRef.current?.reject(new Error('Installation cancelled')); setManual(undefined); manualRef.current = undefined; }
  function requestManual(file: CatalogFile): Promise<Blob> {
    return new Promise((resolve, reject) => { const value = { file, resolve, reject }; manualRef.current = value; setManual(value); });
  }
  async function perform(release?: Release, archive?: File) {
    if (locked || installing || controller.current) return;
    installed.current = false; setInstalling(true); onWorking(true); setError(''); setProgress('Resolving dependencies…');
    const abort = new AbortController(); controller.current = abort;
    const helper = actionsToken?.trim() && downloadRepo ? new DownloadHelper(downloadRepo, actionsToken.trim(), setProgress) : undefined;
    try {
      const fetchFile = fileFetcher(abort.signal, requestManual, helper ? file => helper.fetch(file,abort.signal) : undefined);
      if (type === 'modpack' || archive) {
        const packProvider = archive ? (archive.name.endsWith('.mrpack') ? 'modrinth' : 'curseforge') : release!.provider;
        const file = archive || await fetchFile(await downloadable(release!));
        const result = await installPack(file, packProvider, fetchFile, setProgress, abort.signal);
        const next: Profile = { ...profile, id: crypto.randomUUID(), name: result.name, ...result.settings, memory: Math.max(profile.memory, 6), pack: { provider: packProvider, projectId: release?.projectId || 'local-import', versionId: release?.id || 'local-import', title: result.name, icon: selected?.icon } };
        abort.signal.throwIfAborted(); await commitInstallation(next, result.mods, result.backup);
        await onInstalled(next, `${result.name} installed as a new local instance (${result.mods.length} mods).`);
      } else if (release && type === 'mod') {
        const mods = await installMod(release, profile, await getMods(profile.id), fetchFile, setProgress, abort.signal);
        abort.signal.throwIfAborted(); await commitInstallation(profile, mods);
        await onInstalled(profile, 'Mod and required dependencies installed in this browser.');
      } else if (release) {
        const backup = await installAsset(await downloadable(release), type, await getBackup(profile.id), fetchFile);
        abort.signal.throwIfAborted(); await commitInstallation(profile, await getMods(profile.id), backup);
        await onInstalled(profile, `${label[type]} installed in this browser.`);
      }
      installed.current = true; setSelected(undefined);
    } catch (e) { setError(abort.signal.aborted ? 'Installation cancelled. Your existing files are unchanged.' : String(e)); }
    finally { await helper?.close(); setInstalling(false); onWorking(false); setManual(undefined); manualRef.current = undefined; controller.current = undefined; }
  }
  const chosen = versions.find(v => v.id === versionId);
  return <section className="catalog panel" id="content-catalog">
    <div className="catalog-heading"><div><span className="eyebrow">DISCOVER YOUR NEXT UPGRADE</span><h2>{label[type]}</h2><p>{type === 'modpack' ? 'Complete adventures, installed into a new local instance.' : `Make ${profile.name} your own. Files stay in your browser.`}</p></div>{type === 'modpack' && <label className="button-link import-pack">↑ Import pack<input type="file" accept=".zip,.mrpack" disabled={locked || installing} onChange={e => { const file = e.target.files?.[0]; if (file) void perform(undefined,file); e.target.value=''; }}/></label>}</div>
    <div className="provider-tabs" role="group" aria-label="Content provider"><button className={provider === 'modrinth' ? 'selected' : ''} disabled={installing} onClick={() => setProvider('modrinth')}><span className="provider-dot mr"/>Modrinth</button><button className={provider === 'curseforge' ? 'selected' : ''} disabled={installing} onClick={() => setProvider('curseforge')}><span className="provider-dot cf"/>CurseForge</button><span className="catalog-local">▣ Local installation</span></div>
    {provider === 'curseforge' && <div className="cf-credential"><label>CurseForge API key<input type="password" autoComplete="off" spellCheck={false} value={key} placeholder="Paste your CurseForge API key" onChange={e => { setKey(e.target.value); sessionStorage.setItem('glide-curseforge-key',e.target.value.trim()); clearCatalogCache(); }}/></label><small>Kept in this tab. Sent only to api.curseforge.com; never to GitHub or file download hosts.</small></div>}
    <div className="catalog-toolbar"><input aria-label={`Search ${label[type].toLowerCase()}`} placeholder={`Search ${label[type].toLowerCase()}…`} value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="Sort catalog" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="downloads">Most downloaded</option><option value="relevance">Relevance</option><option value="updated">Recently updated</option></select><label className="checkbox"><input type="checkbox" checked={onlyCompatible} onChange={e => setOnlyCompatible(e.target.checked)}/>{profile.version} {type === 'mod' ? `· ${profile.loader}` : ''} only</label></div>
    <div className="catalog-summary"><span>{loading ? 'Searching…' : `${count(total)} results`}</span><span>{profile.name} · {profile.version} · {profile.loader}</span></div>
    {provider === 'curseforge' && <p className="install-note">{actionsToken ? 'Automatic file downloads use a temporary private Actions helper when the CDN blocks browser requests.' : 'Connect GitHub in the launcher for automatic file downloads. Without it, blocked files can be supplied manually.'}</p>}
    {error && <div className="notice error" role="alert">{error}{!installing && <button onClick={() => setRetry(retry + 1)}>Retry</button>}</div>}
    {installing && !selected && <div className="install-progress"><span className="spinner"/>{progress}<button onClick={cancelInstall}>Cancel install</button></div>}
    {!loading && !error && !projects.length && <div className="catalog-empty">{type === 'mod' && profile.loader === 'vanilla' && onlyCompatible ? 'Choose Fabric, Forge, Quilt or NeoForge in your instance settings to install mods.' : 'No results. Try another search or disable the version filter.'}</div>}
    <div className="project-grid" aria-busy={loading}>{projects.map(project => <button className="project-card" key={`${project.provider}:${project.id}`} onClick={() => open(project)} disabled={installing}><div className="project-art">{project.image || project.icon ? <img loading="lazy" src={project.image || project.icon} alt=""/> : <span>▧</span>}<span className={`provider-badge ${project.provider}`}>{project.provider === 'curseforge' ? 'CF' : 'M'}</span></div><div className="project-card-body"><div className="project-title">{project.icon && <img loading="lazy" src={project.icon} alt=""/>}<h3>{project.title}</h3></div><p>{project.description}</p><div className="project-tags">{project.categories.slice(0,3).map(c => <span key={c}>{c}</span>)}</div><div className="project-card-footer"><span>↓ {count(project.downloads)}</span><span>View details →</span></div></div></button>)}</div>
    <div className="catalog-pagination"><button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0,offset-12))}>← Previous</button><span>Page {Math.floor(offset/12)+1}</span><button disabled={offset+12>=total || loading} onClick={() => setOffset(offset+12)}>Next →</button></div>
    <dialog className="project-dialog" ref={modal} onCancel={e => { if (installing) e.preventDefault(); else setSelected(undefined); }} onClose={() => { if (!installing) setSelected(undefined); }}>
      {selected && <><div className="dialog-top"><div>{selected.icon && <img src={selected.icon} alt=""/>}<div><span className="eyebrow">{selected.provider === 'curseforge' ? 'CURSEFORGE' : 'MODRINTH'} / {label[type]}</span><h2>{selected.title}</h2><small>By {selected.author || 'the project team'} · {count(selected.downloads)} downloads</small></div></div><button aria-label="Close project details" disabled={installing} onClick={() => setSelected(undefined)}>×</button></div><p>{selected.description}</p>
      {detailsLoading ? <div className="install-progress"><span className="spinner"/>Loading project and releases…</div> : <><div className="release-picker"><label>Release to install<select value={versionId} disabled={installing} onChange={e => setVersionId(e.target.value)}>{versions.map(v => <option key={v.id} value={v.id}>{v.title} · {v.gameVersions.filter(s => /^\d|^1\./.test(s)).slice(0,3).join(', ')}</option>)}</select></label><button className="primary" disabled={!chosen || locked || installing} onClick={() => void perform(chosen)}>{installing ? 'Installing…' : type === 'modpack' ? 'Install as new instance' : 'Install to instance'}</button></div>{!versions.length && <div className="notice">No compatible release for {profile.version} / {profile.loader}. Try a different instance or view the project on its website.</div>}<p className="install-note">{type === 'modpack' ? 'A new instance uses the pack’s declared Minecraft version and exact loader. Existing worlds are preserved.' : `Target: ${profile.name} (${profile.version} / ${profile.loader}). Required dependencies are included.`}</p></>}
      {installing && <div className="install-progress" role="status"><span className="spinner"/>{progress}<button onClick={cancelInstall}>Cancel install</button></div>}
      {manual && <div className="manual-download"><strong>Author download required</strong><p>{manual.file.name}</p><a href={manual.file.manualUrl || manual.file.url || selected.url} target="_blank" rel="noreferrer">Open official download page ↗</a><label className="button-link">Choose downloaded file<input type="file" onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.name !== manual.file.name) setError(`Choose ${manual.file.name}, not ${file.name}.`); else { manual.resolve(file); manualRef.current = undefined; setManual(undefined); setError(''); } } e.target.value=''; }}/></label><small>The downloaded file must match the provider’s checksum before installation.</small></div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="project-description">{selected.provider === 'modrinth' ? <ReactMarkdown skipHtml components={{ a: props => <a {...props} target="_blank" rel="noreferrer"/>, img: props => <img {...props} loading="lazy" alt={props.alt || ''}/> }}>{description || 'Loading description…'}</ReactMarkdown> : description || 'The project description will appear here.'}</div><a className="project-source" href={selected.url} target="_blank" rel="noreferrer">View full project on {selected.provider === 'curseforge' ? 'CurseForge' : 'Modrinth'} ↗</a></>}
    </dialog>
    {manual && !selected && <div className="manual-download"><strong>Manual download required: {manual.file.name}</strong><a href={manual.file.manualUrl || manual.file.url} target="_blank" rel="noreferrer">Official file page ↗</a><label className="button-link">Choose file<input type="file" onChange={e => { const file=e.target.files?.[0]; if (file) { manual.resolve(file); setManual(undefined); manualRef.current=undefined; } e.target.value=''; }}/></label></div>}
  </section>;
}
