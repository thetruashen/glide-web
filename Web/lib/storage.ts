import {MAX_PROFILE_BYTES,MAX_EXPANDED_BYTES} from './limits';
import { openDB } from 'idb';
import JSZip from 'jszip';
import { safePath } from './profile-paths';

export type Profile = { id: string; name: string; version: string; loader: string; loaderVersion?: string; memory: number; width: number; height: number; username: string; auth: string; clientId: string; updated?: number; pack?: { provider: string; projectId: string; versionId: string; title: string; icon?: string } };
export type Mod = { name: string; blob: Blob; provider?: string; projectId?: string; versionId?: string; title?: string; gameVersion?: string; loader?: string };
const db = () => openDB('glide-browser', 1, { upgrade(db) { db.createObjectStore('profiles', { keyPath: 'id' }); db.createObjectStore('files'); } });
export const newProfile = (): Profile => ({ id: crypto.randomUUID(), name: 'My instance', version: '1.21.1', loader: 'neoforge', memory: 4, width: 1280, height: 720, username: 'GlidePlayer', auth: 'offline', clientId: '' });
export async function profiles(): Promise<Profile[]> { return (await db()).getAll('profiles'); }
export async function saveProfile(profile: Profile) { await (await db()).put('profiles', profile); }
export async function getMods(id: string): Promise<Mod[]> { return await (await db()).get('files', `${id}:mods`) || []; }
export async function saveMods(id: string, mods: Mod[]) { await (await db()).put('files', mods, `${id}:mods`); }
export async function commitInstallation(profile: Profile, mods: Mod[], backup?: Blob) {
  const database = await db();
  const tx = database.transaction(['profiles', 'files'], 'readwrite');
  try {
    await tx.objectStore('profiles').put({ ...profile, updated: Date.now() });
    await tx.objectStore('files').put(mods, `${profile.id}:mods`);
    if (backup) {
      const previous = await tx.objectStore('files').get(`${profile.id}:backup`);
      if (previous) await tx.objectStore('files').put(previous, `${profile.id}:previous`);
      await tx.objectStore('files').put(backup, `${profile.id}:backup`);
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
export async function getBackup(id: string): Promise<Blob | undefined> { return (await db()).get('files', `${id}:backup`); }
export async function storeBackup(id: string, blob: Blob) {
  // Validate before replacing the last known local snapshot; preserve one previous copy.
  await JSZip.loadAsync(blob);
  const database = await db();
  const tx = database.transaction('files', 'readwrite');
  const previous = await tx.store.get(`${id}:backup`);
  if (previous) await tx.store.put(previous, `${id}:previous`);
  await tx.store.put(blob, `${id}:backup`);
  await tx.done;
}
export async function packProfile(id: string, exportSettings=false, progress?:(percent:number)=>void): Promise<Blob> {
  const backup = await getBackup(id);
  const zip = backup ? await JSZip.loadAsync(backup) : new JSZip();
  zip.remove('glide-profile.json');
  if(exportSettings){const profile=await (await db()).get('profiles',id);if(profile)zip.file('glide-profile.json',JSON.stringify({format:1,profile,mods:(await getMods(id)).map(({blob,...meta})=>meta)}));}
  Object.keys(zip.files).filter(name => name.startsWith('mods/')).forEach(name => zip.remove(name));
  for (const mod of await getMods(id)) zip.file(`mods/${mod.name}`, await mod.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } },meta=>progress?.(meta.percent));
}
export async function importProfile(id: string, blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  if(blob.size>MAX_PROFILE_BYTES || Object.keys(zip.files).length>10000)throw new Error('Backup exceeds the import limit.');
  if(Object.values(zip.files).reduce((n,e)=>n+((e as typeof e & {_data?:{uncompressedSize?:number}})._data?.uncompressedSize||0),0)>MAX_EXPANDED_BYTES)throw new Error('Expanded backup exceeds 4 GiB.');
  let profile:Profile=await (await db()).get('profiles',id);
  if(!profile)throw new Error('Instance no longer exists.');
  let metadata:Partial<Mod>[]=[];
  const entry=zip.file('glide-profile.json');
  if(entry){
    if((entry as typeof entry & {_data?:{uncompressedSize?:number}})._data?.uncompressedSize!>65536)throw new Error('Invalid backup metadata.');
    const data=JSON.parse(await entry.async('string')),p=data.profile;
    if(data.format!==1 || !p || !/^[\w.+-]{1,80}$/.test(p.version) || !['vanilla','fabric','forge','neoforge','quilt'].includes(p.loader) || typeof p.name!=='string' || p.name.length>80 || !/^[A-Za-z0-9_]{3,16}$/.test(p.username) || ![2,3,4,6,8].includes(p.memory) || !['854x480','1280x720','1600x900','1920x1080'].includes(`${p.width}x${p.height}`))throw new Error('Invalid instance settings in backup.');
    if(p.loaderVersion && !/^[\w.+-]{1,80}$/.test(p.loaderVersion))throw new Error('Invalid pinned loader.');
    profile={...profile,name:p.name,version:p.version,loader:p.loader,loaderVersion:p.loaderVersion,memory:p.memory,width:p.width,height:p.height,username:p.username,auth:p.auth==='microsoft'?'microsoft':'offline',clientId:typeof p.clientId==='string'?p.clientId:'',pack:p.pack};
    metadata=Array.isArray(data.mods)?data.mods:[];zip.remove('glide-profile.json');
  }
  const mods: Mod[] = [];
  for (const entry of Object.values(zip.files)) {
    const parts = entry.name.split('/');
    if (parts.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.includes(':')) throw new Error('Unsafe ZIP path');
    if (!entry.dir) safePath((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || entry.name);
    if (!entry.dir && parts[0] === 'mods' && parts.length === 2 && entry.name.endsWith('.jar')) {const meta=metadata.find(m=>m.name===parts[1]);mods.push({name:parts[1],blob:await entry.async('blob'),...(meta?{provider:meta.provider,projectId:meta.projectId,versionId:meta.versionId,title:meta.title,gameVersion:meta.gameVersion,loader:meta.loader}:{})});}
  }
  const clean=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:1}});
  await commitInstallation(profile,mods,clean);return profile;
}
export async function removeProfile(id: string) {
  const database = await db();
  await database.delete('profiles', id);
  for (const suffix of ['mods','backup','previous']) await database.delete('files', `${id}:${suffix}`);
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
