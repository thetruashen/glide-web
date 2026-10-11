import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { cfPackSettings, compatible, fileFetcher, installPack, packSettings, requiredReleases, safePath, verified } from '../lib/install-content';
import { clearCatalogCache, type Release } from '../lib/catalog-api';

const profile = { version: '1.21.1', loader: 'neoforge' };
const signal = () => new AbortController().signal;
async function zipBlob(files: Record<string,string>) {
  const zip = new JSZip(); for (const [name, value] of Object.entries(files)) zip.file(name,value);
  return new Blob([new Uint8Array(await zip.generateAsync({type:'uint8array'}))]);
}
test('pack paths preserve configs/scripts but reject game cache poisoning and traversal', () => {
  for (const path of ['mods/test.jar','kubejs/client_scripts/menu.js','defaultconfigs/server.toml','options.txt']) assert.equal(safePath(path),path);
  for (const path of ['mods','../secret','mods/../../versions/a.json','/etc/passwd','config\\evil','C:/tmp','versions/poison.json','.glide-install/poison.json','mods//test.jar']) assert.throws(() => safePath(path));
});
test('both manifests preserve the exact loader, not just the loader family', () => {
  assert.deepEqual(packSettings({ minecraft:'1.21.1', neoforge:'21.1.258' }), {version:'1.21.1',loader:'neoforge',loaderVersion:'21.1.258'});
  assert.deepEqual(cfPackSettings({manifestType:'minecraftModpack',manifestVersion:1,minecraft:{version:'1.20.1',modLoaders:[{id:'forge-47.4.4',primary:true}]}}), {version:'1.20.1',loader:'forge',loaderVersion:'47.4.4'});
  assert.throws(() => packSettings({minecraft:'1.21.1',forge:'x',neoforge:'y'}));
  assert.throws(() => cfPackSettings({manifestType:'minecraftModpack',manifestVersion:1,minecraft:{version:'1.20.1',modLoaders:[{id:'unknown-1'}]}}));
});
test('download integrity rejects altered files and incorrect lengths', async () => {
  const blob = new Blob(['abc']);
  const file = {name:'test.jar',size:3,hash:{algorithm:'SHA-1' as const,value:'a9993e364706816aba3e25717850c26c9cd0d89d'}};
  assert.equal(await verified(blob,file),blob);
  await assert.rejects(verified(new Blob(['abd']),file),/Integrity/);
  await assert.rejects(verified(blob,{...file,size:4}),/size mismatch/);
});
test('compatibility requires both Minecraft and loader matches', () => {
  const release = {gameVersions:['1.21.1'],loaders:['neoforge']} as Release;
  assert.equal(compatible(release,profile),true);
  assert.equal(compatible(release,{...profile,loader:'forge'}),false);
  assert.equal(compatible(release,{...profile,version:'1.21.4'}),false);
});
test('Modrinth pack applies client overrides last and skips server-only files', async () => {
  const archive = await zipBlob({
    'modrinth.index.json':JSON.stringify({formatVersion:1,game:'minecraft',name:'Test pack',dependencies:{minecraft:'1.21.1',neoforge:'21.1.258'},files:[{path:'mods/client.jar',fileSize:3,downloads:['https://cdn.modrinth.com/test.jar'],hashes:{sha1:'a9993e364706816aba3e25717850c26c9cd0d89d'}},{path:'mods/server.jar',env:{client:'unsupported'}}]}),
    'overrides/config/test.json':'shared','client-overrides/config/test.json':'client','overrides/kubejs/startup_scripts/start.js':'script'
  });
  let downloaded=0;
  const result = await installPack(archive,'modrinth',async () => {downloaded++;return new Blob(['abc']);},()=>{},signal());
  assert.equal(downloaded,1); assert.equal(result.mods.length,1);
  const saved=await JSZip.loadAsync(await result.backup.arrayBuffer());
  assert.equal(await saved.file('config/test.json')!.async('string'),'client');
  assert.equal(await saved.file('kubejs/startup_scripts/start.js')!.async('string'),'script');
  assert.equal(saved.file('mods/server.jar'),null);
});
test('CurseForge imported pack retains exact loader and custom overrides folder', async () => {
  const archive=await zipBlob({'manifest.json':JSON.stringify({manifestType:'minecraftModpack',manifestVersion:1,name:'CF test',minecraft:{version:'1.20.1',modLoaders:[{id:'forge-47.4.4',primary:true}]},files:[],overrides:'custom'}),'custom/defaultconfigs/test.toml':'value=1'});
  const result=await installPack(archive,'curseforge',async () => {throw new Error('Unexpected download');},()=>{},signal());
  assert.equal(result.settings.loaderVersion,'47.4.4');
  assert.equal(await (await JSZip.loadAsync(await result.backup.arrayBuffer())).file('defaultconfigs/test.toml')!.async('string'),'value=1');
});
test('malicious normalized ZIP paths are rejected before creating an installation', async () => {
  const archive=await zipBlob({'manifest.json':JSON.stringify({manifestType:'minecraftModpack',manifestVersion:1,minecraft:{version:'1.21.1',modLoaders:[]},files:[]}),'overrides/../../versions/poison.json':'bad'});
  await assert.rejects(installPack(archive,'curseforge',async () => new Blob(),()=>{},signal()),/Unsafe/);
});
test('cancelled installation does not process downloads or generate a profile', async () => {
  const abort=new AbortController();abort.abort();
  const archive=await zipBlob({'modrinth.index.json':JSON.stringify({formatVersion:1,game:'minecraft',dependencies:{minecraft:'1.21.1'},files:[{path:'mods/a.jar',downloads:['https://cdn.modrinth.com/a.jar']} ]})});
  await assert.rejects(installPack(archive,'modrinth',async () => {throw new Error('Download must not start');},()=>{},abort.signal));
});
test('download requests never carry catalog credentials and verify the actual bytes', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async (_url,options) => {assert.equal(options?.credentials,'omit');assert.equal(options?.headers,undefined);const response=new Response('abc');Object.defineProperty(response,'url',{value:'https://cdn.modrinth.com/test.jar'});return response;};
  try {
    const fetchFile=fileFetcher(signal(),async () => {throw new Error('Unexpected manual download');});
    assert.equal(await (await fetchFile({name:'test.jar',url:'https://cdn.modrinth.com/test.jar',size:3,hash:{algorithm:'SHA-1',value:'a9993e364706816aba3e25717850c26c9cd0d89d'}})).text(),'abc');
  } finally {globalThis.fetch=original;}
});
test('required dependency graph handles cycles without duplicate installation', async () => {
  clearCatalogCache();const original=globalThis.fetch;
  const version=(id:string,project:string,deps:any[])=>({id,project_id:project,name:project,version_number:'1',game_versions:['1.21.1'],loaders:['neoforge'],date_published:'2026-01-01',files:[],dependencies:deps});
  globalThis.fetch=async url=>{const path=String(url);if(path.endsWith('/version/dep'))return Response.json(version('dep','B',[{dependency_type:'required',version_id:'root',project_id:'A'}]));if(path.endsWith('/version/root'))return Response.json(version('root','A',[]));throw new Error(`Unexpected API request ${path}`);};
  try {const root:Release={id:'root',projectId:'A',provider:'modrinth',title:'A',version:'1',date:'',gameVersions:['1.21.1'],loaders:['neoforge'],files:[],dependencies:[{versionId:'dep',projectId:'B',type:'required'}]};assert.deepEqual((await requiredReleases(root,profile,signal())).map(r=>r.projectId),['A','B']);}
  finally {globalThis.fetch=original;clearCatalogCache();}
});
