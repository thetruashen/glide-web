export type Provider = 'modrinth' | 'curseforge';
export type ContentType = 'mod' | 'modpack' | 'resourcepack' | 'shader';
export type Project = { id: string; provider: Provider; slug: string; title: string; author: string; description: string; icon?: string; image?: string; downloads: number; categories: string[]; updated: string; type: ContentType; url: string; body?: string; gallery?: {url:string; title:string}[]; gameVersions?:string[]; loaders?:string[] };
export type Dependency = { projectId?: string; versionId?: string; type: 'required' | 'incompatible' | 'optional' };
export type CatalogFile = { name: string; url?: string; mirrors?:string[]; size: number; hash?: { algorithm: 'SHA-1' | 'SHA-512'; value: string }; manualUrl?: string; provider?:Provider; projectId?:string; releaseId?:string };
export type Release = { id: string; projectId: string; provider: Provider; title: string; version: string; gameVersions: string[]; loaders: string[]; date: string; files: CatalogFile[]; dependencies: Dependency[] };
export type Search = { provider: Provider; type: ContentType; query: string; sort: 'downloads' | 'relevance' | 'updated'; version?: string; loader?: string; offset?: number; categories?:string[]; environment?:'client_only'|'client_and_server'|'server_only'|''; openSource?:boolean };
export type Category={id:string;name:string};
const classes: Record<ContentType, number> = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const loaders: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const clientCache = new Map<string, { expires: number; value: unknown }>();
let hosted = false;
export function configureCatalog(server:boolean) { hosted=server; clearCatalogCache(); }
export function hostedCatalog() { return hosted; }

export function curseKey() { return typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('glide-curseforge-key') || ''; }
async function api(provider: Provider, path: string, signal?: AbortSignal, body?:unknown): Promise<any> {
  const key = provider === 'curseforge' ? curseKey() : '';
  if (provider === 'curseforge' && !key && !hosted) throw new Error('CurseForge requires the hosted launcher or a local API key.');
  const cacheId = `${provider}:${path}${body?JSON.stringify(body):''}`;
  const cached = clientCache.get(cacheId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetch(hosted ? `/api/catalog/${provider}${path}` : `${provider === 'modrinth' ? 'https://api.modrinth.com/v2' : 'https://api.curseforge.com/v1'}${path}`, { ...(body?{method:'POST',body:JSON.stringify(body)}:{}), headers: { ...(body?{'Content-Type':'application/json'}:{}), ...(!hosted && provider === 'curseforge' ? { 'x-api-key': key } : {}) }, credentials: 'omit', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'The catalog is busy. Wait a minute and retry.' : `${provider === 'curseforge' ? 'CurseForge' : 'Modrinth'} returned ${response.status}${response.status === 401 || response.status === 403 ? '. Check your API key or the author’s distribution restrictions.' : '.'}`);
  const value = await response.json();
  if (clientCache.size > 1024) clientCache.delete(clientCache.keys().next().value!);
  clientCache.set(cacheId, { value, expires: Date.now() + 120000 });
  return value;
}
export function clearCatalogCache() { clientCache.clear(); }
export async function categories(provider:Provider,type:ContentType,signal?:AbortSignal):Promise<Category[]> {
  if(provider==='modrinth')return (await api(provider,'/tag/category',signal)).filter((c:any)=>c.project_type===type).map((c:any)=>({id:c.name,name:c.name.replace(/-/g,' ')}));
  return (await api(provider,`/categories?gameId=432&classId=${classes[type]}`,signal)).data.filter((c:any)=>!c.isClass).map((c:any)=>({id:String(c.id),name:c.name}));
}
function mrProject(p: any, type?: ContentType): Project {
  return { id: p.project_id || p.id, provider: 'modrinth', slug: p.slug, title: p.title, author: p.author || '', description: p.description, icon: p.icon_url, image: p.featured_gallery || p.gallery?.[0]?.url || p.gallery?.[0], downloads: p.downloads, categories: p.display_categories || p.categories || [], updated: p.date_modified || p.updated, type: type || p.project_type, url: `https://modrinth.com/${type || p.project_type}/${p.slug}`, body: p.body, gallery:p.gallery?.map((g:any)=>({url:typeof g==='string'?g:g.url,title:g.title||''})),gameVersions:p.game_versions,loaders:p.loaders };
}
function cfProject(p: any, type?: ContentType): Project {
  return { id: String(p.id), provider: 'curseforge', slug: p.slug, title: p.name, author: p.authors?.map((a: any) => a.name).join(', ') || '', description: p.summary, icon: p.logo?.url || p.logo?.thumbnailUrl, image: p.screenshots?.[0]?.thumbnailUrl || p.logo?.url, downloads: p.downloadCount, categories: p.categories?.filter((c: any) => !c.isClass).map((c: any) => c.name) || [], updated: p.dateModified, type: type || (Object.keys(classes) as ContentType[]).find(t => classes[t] === p.classId) || 'mod', url: p.links.websiteUrl,gallery:p.screenshots?.map((g:any)=>({url:g.url,title:g.title||''})) };
}
export async function searchProjects(search: Search, signal?: AbortSignal): Promise<{ projects: Project[]; total: number }> {
  const offset = search.offset || 0;
  if (search.provider === 'modrinth') {
    const facets = [[`project_type:${search.type}`]];
    if (search.version) facets.push([`versions:${search.version}`]);
    if (search.loader && (search.type === 'mod' || search.type==='modpack')) facets.push([`categories:${search.loader}`]);
    if(search.categories?.length)facets.push(search.categories.map(c=>`categories:${c}`));
    if(search.environment)facets.push([`environment:${search.environment}`]);
    if(search.openSource)facets.push(['open_source:true']);
    const p = new URLSearchParams({ query: search.query, index: search.sort, facets: JSON.stringify(facets), offset: String(offset), limit: '12' });
    const result = await api('modrinth', `/search?${p}`, signal);
    return { projects: result.hits.map((hit: any) => mrProject(hit, search.type)), total: result.total_hits };
  }
  const p = new URLSearchParams({ gameId: '432', classId: String(classes[search.type]), searchFilter: search.query, sortField: search.sort === 'updated' ? '3' : search.sort === 'downloads' ? '6' : '1', sortOrder: 'desc', index: String(offset), pageSize: '12' });
  if (search.version) p.set('gameVersion', search.version);
  if (search.version && search.loader && (search.type === 'mod' || search.type==='modpack') && loaders[search.loader]) p.set('modLoaderType', String(loaders[search.loader]));
  if(search.categories?.length)p.set('categoryIds',JSON.stringify(search.categories.map(Number)));
  const result = await api('curseforge', `/mods/search?${p}`, signal);
  return { projects: result.data.map((hit: any) => cfProject(hit, search.type)), total: result.pagination.totalCount };
}
export async function getProject(provider: Provider, id: string): Promise<Project> {
  return provider === 'modrinth' ? mrProject(await api(provider, `/project/${encodeURIComponent(id)}`)) : cfProject((await api(provider, `/mods/${encodeURIComponent(id)}`)).data);
}
export async function projectIcons(provider:Provider,ids:string[],onBatch?:(icons:Record<string,string>)=>void):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 for(let offset=0;offset<ids.length;offset+=50){try{const batch=ids.slice(offset,offset+50);const data=provider==='modrinth'?await api(provider,`/projects?ids=${encodeURIComponent(JSON.stringify(batch))}`):(await api(provider,'/mods',undefined,{modIds:batch.map(Number)})).data;
 for(const raw of data){const icon=provider==='modrinth'?raw.icon_url:raw.logo?.url||raw.logo?.thumbnailUrl;if(icon)result[String(raw.id)]=icon;}onBatch?.({...result});}catch{}}
 return result;
}
export async function getDescription(project: Project): Promise<string> {
  if (project.provider === 'modrinth') return (await getProject('modrinth', project.id)).body || project.description;
  // ProjectText sanitizes HTML after parsing it, preserving author images and links.
  return (await api('curseforge', `/mods/${project.id}/description`)).data || project.description;
}
export async function changelog(release:Release):Promise<string> { return release.provider==='modrinth' ? (await api('modrinth',`/version/${release.id}`)).changelog || 'No changelog provided.' : (await api('curseforge',`/mods/${release.projectId}/files/${release.id}/changelog`)).data || 'No changelog provided.'; }
function mrRelease(v: any): Release {
  const files = [...v.files].sort((a, b) => Number(b.primary) - Number(a.primary));
  return { id: v.id, projectId: v.project_id, provider: 'modrinth', title: v.name, version: v.version_number, gameVersions: v.game_versions, loaders: v.loaders, date: v.date_published, files: files.map(f => ({ name: f.filename, url: f.url, size: f.size, hash: f.hashes.sha512 ? { algorithm: 'SHA-512', value: f.hashes.sha512 } : f.hashes.sha1 ? { algorithm: 'SHA-1', value: f.hashes.sha1 } : undefined })), dependencies: v.dependencies.map((d: any) => ({ projectId: d.project_id || undefined, versionId: d.version_id || undefined, type: d.dependency_type })) };
}
function cfRelease(f: any): Release {
  return { id: String(f.id), projectId: String(f.modId), provider: 'curseforge', title: f.displayName, version: f.displayName, gameVersions: f.gameVersions, loaders: f.gameVersions.map((v: string) => v.toLowerCase()).filter((v: string) => v in loaders), date: f.fileDate, files: [{ name: f.fileName, url: f.downloadUrl || undefined, size: f.fileLength, hash: f.hashes.find((h: any) => h.algo === 1) ? { algorithm: 'SHA-1', value: f.hashes.find((h: any) => h.algo === 1).value } : undefined }], dependencies: f.dependencies.filter((d: any) => d.relationType === 3 || d.relationType === 5).map((d: any) => ({ projectId: String(d.modId), type: d.relationType === 3 ? 'required' : 'incompatible' })) };
}
export async function releasePage(project: Project, version?: string, loader?: string, offset=0): Promise<{items:Release[];total:number}> {
  const p = new URLSearchParams();
  if (project.provider === 'modrinth') {
    p.set('include_changelog', 'false');
    if (version) p.set('game_versions', JSON.stringify([version]));
    if (loader && project.type === 'mod') p.set('loaders', JSON.stringify([loader]));
    const items=(await api(project.provider, `/project/${project.id}/version?${p}`)).map(mrRelease);
    return {items,total:items.length};
  }
  p.set('pageSize', '50');
  p.set('index',String(offset));
  if (version) p.set('gameVersion', version);
  if (loader && project.type === 'mod' && loaders[loader]) p.set('modLoaderType', String(loaders[loader]));
  const result=await api(project.provider, `/mods/${project.id}/files?${p}`);
  return {items:result.data.filter((f: any) => !f.isServerPack).map(cfRelease).sort((a: Release, b: Release) => b.date.localeCompare(a.date)),total:result.pagination.totalCount};
}
export async function releases(project:Project,version?:string,loader?:string):Promise<Release[]> {return (await releasePage(project,version,loader)).items;}
export async function getRelease(provider: Provider, versionId: string, projectId?: string): Promise<Release> {
  if (provider === 'modrinth') return mrRelease(await api(provider, `/version/${encodeURIComponent(versionId)}`));
  if (!projectId) throw new Error('Missing CurseForge project ID');
  return cfRelease((await api(provider, `/mods/${projectId}/files/${versionId}`)).data);
}
export async function primeCurseFiles(ids:number[],signal:AbortSignal){
 const result=await api('curseforge','/mods/files',signal,{fileIds:ids});
 for(const file of result.data)clientCache.set(`curseforge:/mods/${file.modId}/files/${file.id}`,{value:{data:file},expires:Date.now()+1800000});
}
export async function downloadable(release: Release): Promise<CatalogFile> {
  if (!release.files[0]) throw new Error('This release has no downloadable file');
  const file = { ...release.files[0] };
  if (release.provider === 'curseforge') {
    file.provider='curseforge';file.projectId=release.projectId;file.releaseId=release.id;
    if(file.url)return file;
    const project = await getProject('curseforge', release.projectId);
    file.manualUrl = `${project.url}/files/${release.id}`;
    if (!file.url) try { file.url = (await api('curseforge', `/mods/${release.projectId}/files/${release.id}/download-url`)).data || undefined; } catch { /* Author restrictions require a manual download, never a fabricated CDN URL. */ }
    if (!file.url && file.hash?.algorithm === 'SHA-1') {
      // An author may publish the same binary on Modrinth while disabling CF
      // third-party downloads. Use only an API-returned, identical hash/size
      // match from that public release; never reconstruct a restricted CF URL.
      try {
        const mirror = await api('modrinth', `/version_file/${file.hash.value}?algorithm=sha1`);
        const match = mirror.files.find((f: any) => f.hashes.sha1?.toLowerCase() === file.hash!.value.toLowerCase() && f.size === file.size);
        if (match) file.url = match.url;
      } catch { /* No author-published exact match: ask for the official manual download. */ }
    }
  }
  return file;
}
