import { openDB } from 'idb';
import JSZip from 'jszip';

export type Profile = { id: string; name: string; version: string; loader: string; memory: number; width: number; height: number; username: string; auth: string; clientId: string; updated?: number };
export type Mod = { name: string; blob: Blob };
const db = () => openDB('glide-browser', 1, { upgrade(db) { db.createObjectStore('profiles', { keyPath: 'id' }); db.createObjectStore('files'); } });
export const newProfile = (): Profile => ({ id: crypto.randomUUID(), name: 'My world', version: '1.21.1', loader: 'neoforge', memory: 4, width: 1280, height: 720, username: 'GlidePlayer', auth: 'offline', clientId: '' });
export async function profiles(): Promise<Profile[]> { return (await db()).getAll('profiles'); }
export async function saveProfile(profile: Profile) { await (await db()).put('profiles', profile); }
export async function getMods(id: string): Promise<Mod[]> { return await (await db()).get('files', `${id}:mods`) || []; }
export async function saveMods(id: string, mods: Mod[]) { await (await db()).put('files', mods, `${id}:mods`); }
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
export async function packProfile(id: string): Promise<Blob> {
  const backup = await getBackup(id);
  const zip = backup ? await JSZip.loadAsync(backup) : new JSZip();
  Object.keys(zip.files).filter(name => name.startsWith('mods/')).forEach(name => zip.remove(name));
  for (const mod of await getMods(id)) zip.file(`mods/${mod.name}`, await mod.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}
export async function importProfile(id: string, blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  const mods: Mod[] = [];
  for (const entry of Object.values(zip.files)) {
    const parts = entry.name.split('/');
    if (parts.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.includes(':')) throw new Error('Unsafe ZIP path');
    if (!['saves','mods','config','resourcepacks','shaderpacks','datapacks','options.txt','optionsof.txt','servers.dat'].includes(parts[0])) throw new Error('Import a Glide profile ZIP containing saves/, mods/, or settings.');
    if (!entry.dir && parts[0] === 'mods' && parts.length === 2 && entry.name.endsWith('.jar')) mods.push({ name: parts[1], blob: await entry.async('blob') });
  }
  await storeBackup(id, blob);
  await saveMods(id, mods);
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
