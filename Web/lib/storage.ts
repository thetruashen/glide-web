import {MAX_PROFILE_BYTES,MAX_EXPANDED_BYTES,MAX_ARCHIVE_FILES} from './limits';
import { openDB } from 'idb';
import {archiveEntries,entryBlob,rewriteArchive} from './instance-archive';
import { safePath } from './profile-paths';

export type Profile = { id: string; name: string; version: string; loader: string; loaderVersion?: string; memory: number; width: number; height: number; username: string; auth: string; clientId: string; updated?: number; pack?: { provider: string; projectId: string; versionId: string; title: string; icon?: string } };
export type Mod = { name: string; blob: Blob; provider?: string; projectId?: string; versionId?: string; title?: string; gameVersion?: string; loader?: string };
const db = () => openDB('glide-browser', 1, { upgrade(db) { db.createObjectStore('profiles', { keyPath: 'id' }); db.createObjectStore('files'); } });
export const newProfile = (): Profile => ({ id: crypto.randomUUID(), name: 'My instance', version: '1.21.1', loader: 'neoforge', memory: 4, width: 1280, height: 720, username: 'GlidePlayer', auth: 'offline', clientId: '' });
export async function profiles(): Promise<Profile[]> { return (await db()).getAll('profiles'); }
export async function saveProfile(profile: Profile) { await (await db()).put('profiles', profile); }
export async function getMods(id: string): Promise<Mod[]> { return await (await db()).get('files', `${id}:mods`) || []; }
export async function saveMods(id:string,mods:Mod[]){const database=await db();const tx=database.transaction('files','readwrite');await tx.store.put(mods,`${id}:mods`);await tx.store.put((await tx.store.get(`${id}:mods-revision`)||0)+1,`${id}:mods-revision`);await tx.done;}
export async function commitInstallation(profile: Profile, mods: Mod[], backup?: Blob) {
  const database = await db();
  const tx = database.transaction(['profiles', 'files'], 'readwrite');
  try {
    await tx.objectStore('profiles').put({ ...profile, updated: Date.now() });
    await tx.objectStore('files').put(mods, `${profile.id}:mods`);
    const revision=(await tx.objectStore('files').get(`${profile.id}:mods-revision`)||0)+1;await tx.objectStore('files').put(revision,`${profile.id}:mods-revision`);
    if (backup) {
      await tx.objectStore('files').put(revision,`${profile.id}:backup-revision`);
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
  await archiveEntries(blob);
  const database = await db();
  const tx = database.transaction('files', 'readwrite');
  const previous = await tx.store.get(`${id}:backup`);
  if (previous) await tx.store.put(previous, `${id}:previous`);
  await tx.store.put(blob, `${id}:backup`);
  await tx.store.put(await tx.store.get(`${id}:mods-revision`)||0,`${id}:backup-revision`);
  await tx.done;
}
export async function packProfile(id:string,exportSettings=false,progress?:(percent?:number,title?:string)=>void):Promise<Blob>{
 const database=await db();const backup=await getBackup(id);
 const revision=await database.get('files',`${id}:mods-revision`)||0;
 if(backup&&!exportSettings && await database.get('files',`${id}:backup-revision`)===revision){progress?.(100,'Using the saved instance');return backup;}
 const mods=await getMods(id);const profile=await database.get('profiles',id);
 const metadata=exportSettings&&profile?{format:1,profile,mods:mods.map(({blob,...m})=>m)}:undefined;
 return rewriteArchive(backup,mods,metadata,progress);
}
export async function importProfile(id: string, blob: Blob) {
  const entries=await archiveEntries(blob,true);
  let profile:Profile=await (await db()).get('profiles',id);
  if(!profile)throw new Error('Instance no longer exists.');
  let metadata:Partial<Mod>[]=[];
  const entry=entries.find(e=>e.filename==='glide-profile.json');
  if(entry){
    const data=JSON.parse(await (await entryBlob(entry)).text()),p=data.profile;
    if(data.format!==1 || !p || !/^[\w.+-]{1,80}$/.test(p.version) || !['vanilla','fabric','forge','neoforge','quilt'].includes(p.loader) || typeof p.name!=='string' || p.name.length>80 || !/^[A-Za-z0-9_]{3,16}$/.test(p.username) || ![2,3,4,6,8].includes(p.memory) || !['854x480','1280x720','1600x900','1920x1080'].includes(`${p.width}x${p.height}`))throw new Error('Invalid instance settings in backup.');
    if(p.loaderVersion && !/^[\w.+-]{1,80}$/.test(p.loaderVersion))throw new Error('Invalid pinned loader.');
    profile={...profile,name:p.name,version:p.version,loader:p.loader,loaderVersion:p.loaderVersion,memory:p.memory,width:p.width,height:p.height,username:p.username,auth:p.auth==='microsoft'?'microsoft':'offline',clientId:typeof p.clientId==='string'?p.clientId:'',pack:p.pack};
    metadata=Array.isArray(data.mods)?data.mods:[];
  }
  const mods: Mod[] = [];
  for(const entry of entries){
    const parts=entry.filename.split('/');
    if(!entry.directory&&parts[0]==='mods'&&parts.length===2&&entry.filename.endsWith('.jar')){const meta=metadata.find(m=>m.name===parts[1]);mods.push({name:parts[1],blob:await entryBlob(entry),...(meta?{provider:meta.provider,projectId:meta.projectId,versionId:meta.versionId,title:meta.title,gameVersion:meta.gameVersion,loader:meta.loader}:{})});}
  }
  const clean=await rewriteArchive(blob,undefined,undefined);
  await commitInstallation(profile,mods,clean);return profile;
}
export async function removeProfile(id: string) {
  const database = await db();
  await database.delete('profiles', id);
  for (const suffix of ['mods','backup','previous','mods-revision','backup-revision']) await database.delete('files', `${id}:${suffix}`);
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
