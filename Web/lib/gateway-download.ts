import type {CatalogFile} from './catalog-api';
import {readDownload,type ReportProgress} from './progress';
const CHUNK=8*1048576;
export async function gatewayDownload(file:CatalogFile,signal:AbortSignal,report?:ReportProgress):Promise<Blob>{
 if(file.size<=CHUNK){const response=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:file.url,size:file.size}),signal});return readDownload(response,file.name,file.size,signal,report);}
 const parts:Blob[]=[];const started=performance.now();
 for(let offset=0;offset<file.size;offset+=CHUNK){
  const length=Math.min(CHUNK,file.size-offset);let part:Blob|undefined;
  for(let attempt=0;attempt<3;attempt++){
   signal.throwIfAborted();
   try{
    const response=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:file.url,size:file.size,offset,length}),signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
    part=await readDownload(response,file.name,length,signal,value=>{const loaded=offset+(value.loaded||0);const elapsed=(performance.now()-started)/1000;const speed=elapsed>=1&&loaded>=65536?loaded/elapsed:undefined;report?.({...value,title:'Downloading',detail:file.name,loaded,total:file.size,percent:loaded/file.size*100,speed,eta:speed&&elapsed>=3?(file.size-loaded)/speed:undefined});});
    if(part.size!==length)throw new Error(`${file.name}: Incomplete download chunk`);
    break;
   }catch(error){signal.throwIfAborted();if(attempt===2)throw error;report?.({title:'Retrying download chunk',detail:`${file.name} · attempt ${attempt+2}/3`,loaded:offset,total:file.size,percent:offset/file.size*100});await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
  }
  parts.push(part!);
 }
 return new Blob(parts);
}
