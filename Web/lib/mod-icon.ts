import {BlobReader,BlobWriter,TextWriter,ZipReader} from '@zip.js/zip.js';
export async function embeddedModIcon(blob:Blob):Promise<Blob|undefined>{
 const reader=new ZipReader(new BlobReader(blob),{useWebWorkers:false});
 try{
  const entries=await reader.getEntries();let path:string|undefined;
  const metadata=entries.find(e=>e.filename==='fabric.mod.json')||entries.find(e=>['META-INF/neoforge.mods.toml','META-INF/mods.toml','mcmod.info'].includes(e.filename));
  if(metadata&&!metadata.directory&&metadata.uncompressedSize<262144){const text=await metadata.getData(new TextWriter(),{useWebWorkers:false});try{const data=JSON.parse(text);const icon=data.icon||data[0]?.logoFile;path=typeof icon==='string'?icon:icon&&Object.values(icon).find(v=>typeof v==='string') as string|undefined;}catch{path=text.match(/logoFile\s*=\s*["']([^"']+)["']/)?.[1];}}
  const entry=entries.find(e=>e.filename===path)||entries.find(e=>/^(logo|icon)\.(png|webp|jpe?g)$/i.test(e.filename));
  if(!entry||entry.directory||entry.uncompressedSize>524288||!/(png|webp|jpe?g)$/i.test(entry.filename))return;
  return entry.getData(new BlobWriter('image/'+(entry.filename.endsWith('webp')?'webp':/jpe?g$/i.test(entry.filename)?'jpeg':'png')),{useWebWorkers:false,checkSignature:true});
 }finally{await reader.close();}
}
