export type Provider = 'modrinth' | 'curseforge';
export type ContentType = 'mod' | 'modpack' | 'resourcepack' | 'shader';
export type Project = { id: string; provider: Provider; slug: string; title: string; author: string; description: string; icon?: string; image?: string; downloads: number; categories: string[]; updated: string; type: ContentType; url: string; body?: string };
export type Dependency = { projectId?: string; versionId?: string; type: 'required' | 'incompatible' | 'optional' };
export type CatalogFile = { name: string; url?: string; size: number; hash?: { algorithm: 'SHA-1' | 'SHA-512'; value: string }; manualUrl?: string };
export type Release = { id: string; projectId: string; provider: Provider; title: string; version: string; gameVersions: string[]; loaders: string[]; date: string; files: CatalogFile[]; dependencies: Dependency[] };
export type Search = { provider: Provider; type: ContentType; query: string; sort: 'downloads' | 'relevance' | 'updated'; version?: string; loader?: string; offset?: number };
const classes: Record<ContentType, number> = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const loaders: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const clientCache = new Map<string, { expires: number; value: unknown }>();

export function curseKey() { return typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('glide-curseforge-key') || ''; }
async function api(provider: Provider, path: string, signal?: AbortSignal): Promise<any> {
  const key = provider === 'curseforge' ? curseKey() : '';
  if (provider === 'curseforge' && !key) throw new Error('Enter your CurseForge API key to browse CurseForge. It stays in this tab.');
  const cacheId = `${provider}:${path}`;
  const cached = clientCache.get(cacheId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetch(`${provider === 'modrinth' ? 'https://api.modrinth.com/v2' : 'https://api.curseforge.com/v1'}${path}`, { headers: provider === 'curseforge' ? { 'x-api-key': key } : {}, credentials: 'omit', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'The catalog is busy. Wait a minute and retry.' : `${provider === 'curseforge' ? 'CurseForge' : 'Modrinth'} returned ${response.status}${response.status === 401 || response.status === 403 ? '. Check your API key or the author’s distribution restrictions.' : '.'}`);
  const value = await response.json();
  if (clientCache.size > 300) clientCache.clear();
  clientCache.set(cacheId, { value, expires: Date.now() + 120000 });
  return value;
}
export function clearCatalogCache() { clientCache.clear(); }
function mrProject(p: any, type?: ContentType): Project {
  return { id: p.project_id || p.id, provider: 'modrinth', slug: p.slug, title: p.title, author: p.author || '', description: p.description, icon: p.icon_url, image: p.featured_gallery || p.gallery?.[0]?.url || p.gallery?.[0], downloads: p.downloads, categories: p.display_categories || p.categories || [], updated: p.date_modified || p.updated, type: type || p.project_type, url: `https://modrinth.com/${type || p.project_type}/${p.slug}`, body: p.body };
}
function cfProject(p: any, type?: ContentType): Project {
  return { id: String(p.id), provider: 'curseforge', slug: p.slug, title: p.name, author: p.authors?.map((a: any) => a.name).join(', ') || '', description: p.summary, icon: p.logo?.thumbnailUrl, image: p.screenshots?.[0]?.thumbnailUrl || p.logo?.url, downloads: p.downloadCount, categories: p.categories?.filter((c: any) => !c.isClass).map((c: any) => c.name) || [], updated: p.dateModified, type: type || (Object.keys(classes) as ContentType[]).find(t => classes[t] === p.classId) || 'mod', url: p.links.websiteUrl };
}
export async function searchProjects(search: Search, signal?: AbortSignal): Promise<{ projects: Project[]; total: number }> {
  const offset = search.offset || 0;
  if (search.provider === 'modrinth') {
    const facets = [[`project_type:${search.type}`]];
    if (search.version) facets.push([`versions:${search.version}`]);
    if (search.loader && search.type === 'mod') facets.push([`categories:${search.loader}`]);
    const p = new URLSearchParams({ query: search.query, index: search.sort, facets: JSON.stringify(facets), offset: String(offset), limit: '12' });
    const result = await api('modrinth', `/search?${p}`, signal);
    return { projects: result.hits.map((hit: any) => mrProject(hit, search.type)), total: result.total_hits };
  }
  const p = new URLSearchParams({ gameId: '432', classId: String(classes[search.type]), searchFilter: search.query, sortField: search.sort === 'updated' ? '3' : search.sort === 'downloads' ? '6' : '1', sortOrder: 'desc', index: String(offset), pageSize: '12' });
  if (search.version) p.set('gameVersion', search.version);
  if (search.loader && search.type === 'mod' && loaders[search.loader]) p.set('modLoaderType', String(loaders[search.loader]));
  const result = await api('curseforge', `/mods/search?${p}`, signal);
  return { projects: result.data.map((hit: any) => cfProject(hit, search.type)), total: result.pagination.totalCount };
}
export async function getProject(provider: Provider, id: string): Promise<Project> {
  return provider === 'modrinth' ? mrProject(await api(provider, `/project/${encodeURIComponent(id)}`)) : cfProject((await api(provider, `/mods/${encodeURIComponent(id)}`)).data);
}
export async function getDescription(project: Project): Promise<string> {
  if (project.provider === 'modrinth') return (await getProject('modrinth', project.id)).body || project.description;
  const html = (await api('curseforge', `/mods/${project.id}/description`)).data;
  // Render external descriptions as text, never execute author-provided HTML.
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,iframe').forEach(e => e.remove());
  document.querySelectorAll('p,li,h1,h2,h3,br').forEach(e => e.append('\n'));
  return document.body.textContent || project.description;
}
function mrRelease(v: any): Release {
  const files = [...v.files].sort((a, b) => Number(b.primary) - Number(a.primary));
  return { id: v.id, projectId: v.project_id, provider: 'modrinth', title: v.name, version: v.version_number, gameVersions: v.game_versions, loaders: v.loaders, date: v.date_published, files: files.map(f => ({ name: f.filename, url: f.url, size: f.size, hash: f.hashes.sha512 ? { algorithm: 'SHA-512', value: f.hashes.sha512 } : f.hashes.sha1 ? { algorithm: 'SHA-1', value: f.hashes.sha1 } : undefined })), dependencies: v.dependencies.map((d: any) => ({ projectId: d.project_id || undefined, versionId: d.version_id || undefined, type: d.dependency_type })) };
}
function cfRelease(f: any): Release {
  return { id: String(f.id), projectId: String(f.modId), provider: 'curseforge', title: f.displayName, version: f.displayName, gameVersions: f.gameVersions, loaders: f.gameVersions.map((v: string) => v.toLowerCase()).filter((v: string) => v in loaders), date: f.fileDate, files: [{ name: f.fileName, url: f.downloadUrl || undefined, size: f.fileLength, hash: f.hashes.find((h: any) => h.algo === 1) ? { algorithm: 'SHA-1', value: f.hashes.find((h: any) => h.algo === 1).value } : undefined }], dependencies: f.dependencies.filter((d: any) => d.relationType === 3 || d.relationType === 5).map((d: any) => ({ projectId: String(d.modId), type: d.relationType === 3 ? 'required' : 'incompatible' })) };
}
export async function releases(project: Project, version?: string, loader?: string): Promise<Release[]> {
  const p = new URLSearchParams();
  if (project.provider === 'modrinth') {
    p.set('include_changelog', 'false');
    if (version) p.set('game_versions', JSON.stringify([version]));
    if (loader && project.type === 'mod') p.set('loaders', JSON.stringify([loader]));
    return (await api(project.provider, `/project/${project.id}/version?${p}`)).map(mrRelease);
  }
  p.set('pageSize', '50');
  if (version) p.set('gameVersion', version);
  if (loader && project.type === 'mod' && loaders[loader]) p.set('modLoaderType', String(loaders[loader]));
  return (await api(project.provider, `/mods/${project.id}/files?${p}`)).data.filter((f: any) => !f.isServerPack).map(cfRelease).sort((a: Release, b: Release) => b.date.localeCompare(a.date));
}
export async function getRelease(provider: Provider, versionId: string, projectId?: string): Promise<Release> {
  if (provider === 'modrinth') return mrRelease(await api(provider, `/version/${encodeURIComponent(versionId)}`));
  if (!projectId) throw new Error('Missing CurseForge project ID');
  return cfRelease((await api(provider, `/mods/${projectId}/files/${versionId}`)).data);
}
export async function downloadable(release: Release): Promise<CatalogFile> {
  if (!release.files[0]) throw new Error('This release has no downloadable file');
  const file = { ...release.files[0] };
  if (release.provider === 'curseforge') {
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
