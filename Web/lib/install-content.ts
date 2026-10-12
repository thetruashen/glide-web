import JSZip from 'jszip';
import {MAX_FILE_BYTES,MAX_PROFILE_BYTES,MAX_EXPANDED_BYTES,MAX_ARCHIVE_FILES} from './limits';
import {readDownload,type ReportProgress} from './progress';
import { downloadable, primeCurseFiles, hostedCatalog, getProject, getRelease, releases, type CatalogFile, type ContentType, type Project, type Release } from './catalog-api';
import type { Mod, Profile } from './storage';
import { safePath } from './profile-paths';
export { safePath } from './profile-paths';

const MAX_FILES = MAX_ARCHIVE_FILES, MAX_DOWNLOAD = MAX_FILE_BYTES, MAX_EXPANDED = MAX_EXPANDED_BYTES;
export function packSettings(dependencies: Record<string, string>): { version: string; loader: string; loaderVersion?: string } {
  const version = dependencies.minecraft;
  if (typeof version !== 'string' || !/^[\w.+-]{1,80}$/.test(version)) throw new Error('The modpack does not declare a valid Minecraft version.');
  const map: Record<string, string> = { forge: 'forge', neoforge: 'neoforge', 'fabric-loader': 'fabric', 'quilt-loader': 'quilt' };
  const present = Object.keys(map).filter(key => dependencies[key]);
  if (present.length > 1) throw new Error('The modpack declares multiple loaders.');
  if (!present.length) return { version, loader: 'vanilla' };
  const loaderVersion = dependencies[present[0]];
  if (!/^[\w.+-]{1,80}$/.test(loaderVersion)) throw new Error('Invalid pinned loader version.');
  return { version, loader: map[present[0]], loaderVersion };
}
export function cfPackSettings(manifest: any) {
  if (manifest.manifestType !== 'minecraftModpack' || manifest.manifestVersion !== 1) throw new Error('Unsupported CurseForge modpack manifest.');
  const ids = manifest.minecraft?.modLoaders || [];
  const chosen = ids.find((v: any) => v.primary) || ids[0];
  const dependencies: Record<string, string> = { minecraft: manifest.minecraft?.version };
  if (chosen) {
    const match = /^(neoforge|forge|fabric|quilt)-(.+)$/.exec(chosen.id);
    if (!match) throw new Error(`Unsupported modpack loader: ${chosen.id}`);
    dependencies[match[1] === 'fabric' || match[1] === 'quilt' ? `${match[1]}-loader` : match[1]] = match[2];
  }
  return packSettings(dependencies);
}
export async function verified(blob: Blob, file: CatalogFile): Promise<Blob> {
  if (blob.size > MAX_DOWNLOAD || (file.size > 0 && blob.size !== file.size)) throw new Error(`File size mismatch: ${file.name}`);
  if (!file.hash || !/^[a-f0-9]+$/i.test(file.hash.value)) throw new Error(`No supported integrity hash is available for ${file.name}.`);
  const actual = [...new Uint8Array(await crypto.subtle.digest(file.hash.algorithm, await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2,'0')).join('');
  if (actual !== file.hash.value.toLowerCase()) throw new Error(`Integrity verification failed: ${file.name}`);
  return blob;
}
function trustedDownload(url: string) {
  const parsed = new URL(url);
  const allowed = ['cdn.modrinth.com','edge.forgecdn.net','mediafilez.forgecdn.net','media.forgecdn.net','github.com','raw.githubusercontent.com','gitlab.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowed.includes(parsed.hostname)) throw new Error(`The pack uses an unsupported download host: ${parsed.hostname}.`);
  return url;
}
export class ManualDownloadRequired extends Error {
  constructor(public file: CatalogFile) { super(`Download ${file.name} from its author, then choose that file below.`); }
}
type Progress = (message: string) => void;
export type RequestFile = (file: CatalogFile) => Promise<Blob>;
export function fileFetcher(signal: AbortSignal, supplied: RequestFile, relay?: RequestFile, report?:ReportProgress): RequestFile {
  return async file => {
    signal.throwIfAborted();
    report?.({title:'Resolving file',detail:file.name});
    if(file.size>MAX_DOWNLOAD)throw new Error(`${file.name}: File exceeds the 1 GiB download limit`);
    if (!file.url) return verified(await supplied(file), file);
    if(hostedCatalog() && relay && new URL(file.url).hostname.endsWith('.forgecdn.net')) {
      try {const blob=await relay(file);report?.({title:'Verifying checksum',detail:file.name,percent:100});return await verified(blob,file);}catch(e){signal.throwIfAborted();throw new Error(e instanceof Error && e.message.startsWith(file.name)?e.message:`${file.name}: ${e instanceof Error?e.message:String(e)}`);}
    }
    try {
      const response = await fetch(trustedDownload(file.url), { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
      if (!response.ok) throw new Error(`Download returned ${response.status}`);
      trustedDownload(response.url);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_DOWNLOAD) throw new Error('File exceeds the download limit');
      const blob = await readDownload(response,file.name,file.size,signal,report);
      report?.({title:'Verifying checksum',detail:file.name,percent:100});
      return await verified(blob, file);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && /Integrity|size mismatch|unsupported download host|supported integrity|limit/.test(error.message)) throw error;
      if (relay) {
        try { return await verified(await relay(file),file); }
        catch (error) {
          signal.throwIfAborted();
          if (hostedCatalog() || (error instanceof Error && /Integrity|size mismatch/.test(error.message))) throw error;
        }
      }
      for(const url of file.mirrors || []) { try {const r=await fetch(trustedDownload(url),{credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});if(r.ok)return await verified(await r.blob(),file);} catch(e){signal.throwIfAborted();if(e instanceof Error && /Integrity|size mismatch/.test(e.message))throw e;} }
      return verified(await supplied(file), file);
    }
  };
}
export function compatible(release: Release, profile: Pick<Profile, 'version' | 'loader'>) {
  return release.gameVersions.includes(profile.version) && release.loaders.includes(profile.loader);
}
export async function requiredReleases(root: Release, profile: Pick<Profile, 'version' | 'loader'>, signal: AbortSignal): Promise<Release[]> {
  const resolved = new Map<string, Release>();
  async function visit(release: Release) {
    signal.throwIfAborted();
    if (!compatible(release, profile)) throw new Error(`${release.title} does not support ${profile.version} / ${profile.loader}.`);
    const existing = resolved.get(release.projectId);
    if (existing) { if (existing.id !== release.id) throw new Error(`Conflicting dependency versions: ${release.title}`); return; }
    if (resolved.size >= 200) throw new Error('Dependency graph exceeds 200 mods.');
    resolved.set(release.projectId, release);
    for (const dep of release.dependencies.filter(d => d.type === 'required')) {
      if (dep.versionId) await visit(await getRelease(root.provider, dep.versionId, dep.projectId));
      else if (dep.projectId) {
        if (resolved.has(dep.projectId)) continue;
        const project = await getProject(root.provider, dep.projectId);
        const choices = await releases(project, profile.version, profile.loader);
        if (!choices.length) throw new Error(`No compatible required dependency: ${project.title}`);
        await visit(choices[0]);
      } else throw new Error('This release requires an external dependency without a downloadable version.');
    }
  }
  await visit(root);
  for (const release of resolved.values()) for (const dep of release.dependencies.filter(d => d.type === 'incompatible')) {
    if (dep.projectId && resolved.has(dep.projectId)) throw new Error(`${release.title} conflicts with another required mod.`);
  }
  return [...resolved.values()];
}
export async function installMod(release: Release, profile: Profile, existing: Mod[], fetchFile: RequestFile, progress: Progress, signal: AbortSignal, report?:ReportProgress): Promise<Mod[]> {
  const planned = await requiredReleases(release, profile, signal);
  const incoming: Mod[] = [];
  for (const [index, mod] of planned.entries()) {
    signal.throwIfAborted(); progress(`Downloading ${index + 1}/${planned.length}: ${mod.title}`);report?.({title:'Installing mods',fileIndex:index+1,fileCount:planned.length,percent:index/planned.length*100});
    for (const dep of mod.dependencies.filter(d => d.type === 'incompatible')) if (existing.some(m => m.provider === mod.provider && m.projectId === dep.projectId)) throw new Error(`${mod.title} conflicts with an installed mod. Remove the conflicting mod first.`);
    const file = await downloadable(mod);
    if (!/^[^/\\:]+\.jar$/i.test(file.name)) throw new Error('The chosen mod does not contain a Java .jar file.');
    const blob = await fetchFile({ ...file, manualUrl: file.manualUrl || `https://modrinth.com/mod/${mod.projectId}/version/${mod.id}` });
    incoming.push({ name: file.name, blob, provider: mod.provider, projectId: mod.projectId, versionId: mod.id, title: mod.title, gameVersion: profile.version, loader: profile.loader });
  }
  const next = existing.filter(m => !incoming.some(n => n.provider === m.provider && n.projectId === m.projectId));
  for (const mod of incoming) {
    if (next.some(m => m.name === mod.name)) throw new Error(`An installed file already uses ${mod.name}. Remove it before installing.`);
    next.push(mod);
  }
  signal.throwIfAborted();
  if (next.reduce((size, m) => size + m.blob.size, 0) > MAX_PROFILE_BYTES) throw new Error('Installed mods exceed the 4 GiB transfer limit.');
  return next;
}
export type PackInstall = { settings: ReturnType<typeof packSettings>; mods: Mod[]; backup: Blob; name: string };
export async function installPack(archive: Blob, provider: 'modrinth' | 'curseforge', fetchFile: RequestFile, progress: Progress, signal: AbortSignal, report?:ReportProgress): Promise<PackInstall> {
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  if (Object.keys(zip.files).length > MAX_FILES) throw new Error('Modpack contains too many files.');
  for (const entry of Object.values(zip.files)) {
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || entry.name;
    const permission = typeof entry.unixPermissions === 'string' ? parseInt(entry.unixPermissions,8) : entry.unixPermissions || 0;
    if (original.startsWith('/') || /[\\:\x00-\x1f]/.test(original) || original.split('/').includes('..') || (permission & 0o170000) === 0o120000) throw new Error('Unsafe modpack archive path or symbolic link.');
  }
  const expanded = Object.values(zip.files).reduce((sum, entry) => sum + ((entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0),0);
  if (expanded > MAX_EXPANDED) throw new Error('Modpack archive exceeds the expanded size limit.');
  const output = new JSZip();
  const mods: Mod[] = [];
  let total = 0;
  const paths = new Set<string>();
  function put(path: string, blob: Blob, meta: Partial<Mod> = {}, override = false) {
    path = safePath(path);
    if (output.file(path) && !override) throw new Error(`Duplicate pack file: ${path}`);
    total += blob.size;
    if (total > MAX_EXPANDED) throw new Error('Expanded modpack exceeds 8 GiB.');
    output.file(path, blob.arrayBuffer());
    if (path.startsWith('mods/') && path.endsWith('.jar')) {
      const name = path.slice(5);
      if (name.includes('/')) throw new Error('Nested mod JAR paths are not supported.');
      const i = mods.findIndex(m => m.name === name);
      const mod = { name, blob, ...meta };
      if (i >= 0) mods[i] = mod; else mods.push(mod);
    }
    paths.add(path);
  }
  let settings: ReturnType<typeof packSettings>, name: string;
  const tasks: (() => Promise<void>)[] = [];
  let overrideFolders: string[];
  if (provider === 'modrinth') {
    const entry = zip.file('modrinth.index.json');
    if (!entry) throw new Error('The archive does not contain modrinth.index.json.');
    const manifest = JSON.parse(await entry.async('string'));
    if (manifest.formatVersion !== 1 || manifest.game !== 'minecraft') throw new Error('Unsupported Modrinth modpack format.');
    settings = packSettings(manifest.dependencies); name = manifest.name || 'Modrinth pack';
    if (!Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) throw new Error('Invalid modpack file list.');
    for (const file of manifest.files) {
      if (file.env?.client === 'unsupported') continue;
      const path = safePath(file.path);
      if (paths.has(path)) throw new Error('Duplicate modpack file path.');
      paths.add(path);
      if (!Array.isArray(file.downloads) || !file.downloads.length) throw new Error(`No download supplied for ${path}`);
      const hash = file.hashes?.sha512 ? { algorithm: 'SHA-512' as const, value: file.hashes.sha512 } : { algorithm: 'SHA-1' as const, value: file.hashes?.sha1 || '' };
      tasks.push(async () => put(path, await fetchFile({ name: path.split('/').pop()!, url: file.downloads[0], mirrors:file.downloads.slice(1), size: file.fileSize, hash }), { provider: 'modrinth', gameVersion: settings.version, loader: settings.loader }));
    }
    overrideFolders = ['overrides/', 'client-overrides/'];
  } else {
    const entry = zip.file('manifest.json');
    if (!entry) throw new Error('The archive does not contain CurseForge manifest.json.');
    const manifest = JSON.parse(await entry.async('string'));
    progress('Resolving pack file metadata…');
    if(Array.isArray(manifest.files)){const ids=manifest.files.filter((f:any)=>f.required!==false).map((f:any)=>f.fileID);for(let i=0;i<ids.length;i+=1000)await primeCurseFiles(ids.slice(i,i+1000),signal);}
    settings = cfPackSettings(manifest); name = manifest.name || 'CurseForge pack';
    if (!Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) throw new Error('Invalid modpack file list.');
    for (const file of manifest.files) {
      if (file.required === false) continue;
      if (!Number.isSafeInteger(file.projectID) || !Number.isSafeInteger(file.fileID)) throw new Error('Invalid CurseForge file ID.');
      tasks.push(async () => {
        const release = await getRelease('curseforge', String(file.fileID), String(file.projectID));
        const downloadableFile = await downloadable(release);
        const project = downloadableFile.name.endsWith('.jar') ? undefined : await getProject('curseforge', release.projectId);
        const folder = downloadableFile.name.endsWith('.jar') ? 'mods' : project?.type === 'resourcepack' ? 'resourcepacks' : project?.type === 'shader' ? 'shaderpacks' : undefined;
        if (!folder) throw new Error(`Unsupported pack file: ${downloadableFile.name}`);
        put(`${folder}/${downloadableFile.name}`, await fetchFile(downloadableFile), { provider: 'curseforge', projectId: release.projectId, versionId: release.id, title: release.title, gameVersion: settings.version, loader: settings.loader });
      });
    }
    const folder = manifest.overrides || 'overrides';
    if (!/^[\w-]+$/.test(folder)) throw new Error('Unsafe modpack overrides folder.');
    overrideFolders = [folder + '/'];
  }
  // Sequential installation makes manual-file handoffs deterministic; nothing
  // is committed until every required download and override has passed validation.
  for (const [i, task] of tasks.entries()) {
    signal.throwIfAborted(); progress(`Installing pack files ${i + 1}/${tasks.length}`);report?.({title:'Installing pack files',fileIndex:i+1,fileCount:tasks.length,percent:i/tasks.length*100});await task();report?.({title:'Installing pack files',fileIndex:i+1,fileCount:tasks.length,percent:(i+1)/tasks.length*100});
  }
  for (const folder of overrideFolders) for (const entry of Object.values(zip.files)) {
    signal.throwIfAborted();
    if (entry.dir || !entry.name.startsWith(folder)) continue;
    const path = entry.name.slice(folder.length);
    if (/^(README|LICENSE|CHANGELOG)(\.[\w]+)?$/i.test(path)) continue;
    // Pack authors include read-me/server instructions alongside overrides.
    // They are documentation, not Minecraft settings; never install them into
    // shared game caches. Full archive traversal validation already ran above.
    if(!path.includes('/') && !['options.txt','optionsof.txt','servers.dat'].includes(path.toLowerCase()) && /\.(txt|md|pdf)$/i.test(path))continue;
    // JSZip tracks the original name even when it normalizes a malicious path.
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || entry.name;
    if (original.split('/').includes('..') || original.includes('\\')) throw new Error('Unsafe modpack override path.');
    safePath(path);
    put(path, new Blob([await entry.async('arraybuffer')]), {}, true);
  }
  progress('Preparing local instance…');
  const backup = await output.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } },meta=>report?.({title:'Preparing local instance',detail:meta.currentFile || 'Compressing instance files',percent:meta.percent}));
  if (backup.size > MAX_PROFILE_BYTES) throw new Error('This modpack exceeds the 4 GiB session transfer limit.');
  signal.throwIfAborted();
  return { settings, mods, backup, name };
}
export async function installAsset(file: CatalogFile, type: ContentType, existing: Blob | undefined, fetchFile: RequestFile): Promise<Blob> {
  const zip = existing ? await JSZip.loadAsync(await existing.arrayBuffer()) : new JSZip();
  const name = safePath(`${type === 'shader' ? 'shaderpacks' : 'resourcepacks'}/${file.name}`);
  zip.file(name, await (await fetchFile(file)).arrayBuffer());
  const result = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  if (result.size > MAX_PROFILE_BYTES) throw new Error('Profile exceeds the session transfer limit.');
  return result;
}
