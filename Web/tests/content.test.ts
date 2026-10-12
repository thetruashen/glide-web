import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { cfPackSettings, compatible, fileFetcher, installPack, packSettings, requiredReleases, safePath, verified } from '../lib/install-content';
import { clearCatalogCache, downloadable, type Release } from '../lib/catalog-api';

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
test('restricted CF URLs are never invented; only an author-published identical Modrinth file is accepted', async () => {
  clearCatalogCache();const original=globalThis.fetch;
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=> 'unit-test-key'}});
  globalThis.fetch=async url=>{
    const path=String(url);
    if(path.endsWith('/mods/123'))return Response.json({data:{id:123,name:'Test',classId:6,links:{websiteUrl:'https://www.curseforge.com/minecraft/mc-mods/test'}}});
    if(path.endsWith('/download-url'))return new Response('',{status:403});
    if(path.includes('/version_file/'))return Response.json({files:[{size:3,url:'https://cdn.modrinth.com/author-published.jar',hashes:{sha1:'a9993e364706816aba3e25717850c26c9cd0d89d'}}]});
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    const release:Release={id:'456',projectId:'123',provider:'curseforge',title:'Test',version:'1',date:'',gameVersions:['1.21.1'],loaders:['neoforge'],dependencies:[],files:[{name:'original.jar',size:3,hash:{algorithm:'SHA-1',value:'a9993e364706816aba3e25717850c26c9cd0d89d'}}]};
    const file=await downloadable(release);
    assert.equal(file.url,'https://cdn.modrinth.com/author-published.jar');
    assert.equal(file.manualUrl,'https://www.curseforge.com/minecraft/mc-mods/test/files/456');
  }finally {globalThis.fetch=original;if(storageDescriptor)Object.defineProperty(globalThis,'sessionStorage',storageDescriptor);else Reflect.deleteProperty(globalThis,'sessionStorage');clearCatalogCache();}
});

test('pack documentation at override root is skipped while actual options are preserved',async()=>{
 const manifest={manifestType:'minecraftModpack',manifestVersion:1,name:'Docs pack',minecraft:{version:'1.21.1',modLoaders:[{id:'neoforge-21.1.258',primary:true}]},files:[],overrides:'overrides'};
 const archive=await zipBlob({'manifest.json':JSON.stringify(manifest),'overrides/FOR SERVERS ONLY - SET THESE IN SERVER.PROPERTIES.txt':'Instructions','overrides/options.txt':'music:0'});
 const result=await installPack(archive,'curseforge',async()=>{throw new Error('No downloads expected');},()=>{},signal());
 const files=await JSZip.loadAsync(await result.backup.arrayBuffer());assert.equal(await files.file('options.txt')!.async('string'),'music:0');assert.equal(files.file('FOR SERVERS ONLY - SET THESE IN SERVER.PROPERTIES.txt'),null);
});

test('large legitimate pack archives can exceed the former 10,000-file cap',async()=>{
 const zip=new JSZip();zip.file('manifest.json',JSON.stringify({manifestType:'minecraftModpack',manifestVersion:1,name:'Large pack',minecraft:{version:'1.19.2',modLoaders:[{id:'forge-43.5.0',primary:true}]},files:[]}));
 for(let i=0;i<10001;i++)zip.file(`overrides/config/data/${i}.txt`,'');
 const archive=new Blob([new Uint8Array(await zip.generateAsync({type:'uint8array'}))]);
 const result=await installPack(archive,'curseforge',async()=>{throw new Error('No downloads expected');},()=>{},signal());assert.equal(result.settings.loaderVersion,'43.5.0');const restored=await JSZip.loadAsync(await result.backup.arrayBuffer());assert.ok(restored.file('config/data/10000.txt'));
});
