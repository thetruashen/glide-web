import {BlobReader,BlobWriter,TextReader,ZipReader,ZipWriter,type Entry} from '@zip.js/zip.js';
import {safePath} from './profile-paths';
import {MAX_PROFILE_BYTES,MAX_EXPANDED_BYTES,MAX_ARCHIVE_FILES} from './limits';
export async function archiveEntries(blob:Blob,metadata=false):Promise<Entry[]>{
 if(blob.size>MAX_PROFILE_BYTES)throw new Error('Instance exceeds the 4 GiB archive limit.');
 const reader=new ZipReader(new BlobReader(blob),{useWebWorkers:false});
 try{
  const entries=await reader.getEntries();if(entries.length>MAX_ARCHIVE_FILES)throw new Error('Instance has too many files.');
  let expanded=0;const names=new Set<string>();
  for(const entry of entries){
   const name=entry.filename;
   if(name.startsWith('/')||/[\\:\x00-\x1f]/.test(name)||name.split('/').includes('..')||names.has(name)||entry.symlink||entry.encrypted)throw new Error('Unsafe instance archive entry.');
   names.add(name);expanded+=entry.uncompressedSize;
   if(expanded>MAX_EXPANDED_BYTES)throw new Error('Expanded instance exceeds 8 GiB.');
   if(!entry.directory){if(metadata&&name==='glide-profile.json'){if(entry.uncompressedSize>2*1048576)throw new Error('Invalid instance metadata.');}else safePath(name);}
  }
  return entries;
 }finally{await reader.close();}
}
export async function rewriteArchive(backup:Blob|undefined,mods:{name:string;blob:Blob}[]|undefined,metadata:unknown,report?:(percent?:number,title?:string)=>void):Promise<Blob>{
 if(backup)await archiveEntries(backup,true);
 const writer=new ZipWriter(new BlobWriter('application/zip'),{useWebWorkers:false,zip64:true,level:0});
 if(backup){report?.(undefined,'Preparing saved instance files');await writer.appendZip(new BlobReader(backup),{filter:entry=>entry.filename!=='glide-profile.json' && (!mods||!entry.filename.startsWith('mods/'))});}
 if(mods){const total=mods.reduce((n,m)=>n+m.blob.size,0);let completed=0;for(const mod of mods){safePath(`mods/${mod.name}`);await writer.add(`mods/${mod.name}`,new BlobReader(mod.blob),{onprogress:loaded=>report?.(total?(completed+loaded)/total*100:100,'Preparing mod files')});completed+=mod.blob.size;}}
 if(metadata!==undefined)await writer.add('glide-profile.json',new TextReader(JSON.stringify(metadata)));
 const blob=await writer.close();if(blob.size>MAX_PROFILE_BYTES)throw new Error('Instance exceeds the 4 GiB transfer limit.');report?.(100,'Instance prepared');return blob;
}
export async function entryBlob(entry:Entry):Promise<Blob>{if(entry.directory)return new Blob();return entry.getData(new BlobWriter(),{useWebWorkers:false,checkSignature:true});}
