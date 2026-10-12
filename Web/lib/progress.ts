export type ProgressInfo={title:string;detail?:string;percent?:number;loaded?:number;total?:number;speed?:number;eta?:number;fileIndex?:number;fileCount?:number};
export type ReportProgress=(value:ProgressInfo)=>void;
export const formatBytes=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.round(bytes/1024)} KB`;
export async function readDownload(response:Response,name:string,expected:number,signal:AbortSignal,report?:ReportProgress):Promise<Blob>{
 if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(`${name}: ${error.error || `Download returned ${response.status}`}`);}
 const total=expected || Number(response.headers.get('X-File-Size') || response.headers.get('Content-Length') || 0);
 const started=performance.now();let loaded=0;const chunks:Uint8Array<ArrayBuffer>[]=[];
 const update=()=>{const speed=loaded/Math.max(.1,(performance.now()-started)/1000);report?.({title:'Downloading',detail:name,loaded,total:total||undefined,percent:total?Math.min(100,loaded/total*100):undefined,speed,eta:total&&speed?(total-loaded)/speed:undefined});};
 update();
 if(!response.body){const blob=await response.blob();loaded=blob.size;update();return blob;}
 const reader=response.body.getReader();let last=0;
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;loaded+=value.byteLength;if(loaded>512*1048576 || (expected>0&&loaded>expected))throw new Error(`${name}: Download exceeds expected size or the 512 MiB limit`);chunks.push(new Uint8Array(value));if(performance.now()-last>100){update();last=performance.now();}}update();return new Blob(chunks);}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
