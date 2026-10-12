import test from 'node:test';
import assert from 'node:assert/strict';
import {readDownload,type ProgressInfo} from '../lib/progress';
test('streamed downloads report real byte counts and finish at 100 percent',async()=>{
 const events:ProgressInfo[]=[];
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));c.close();}});
 const blob=await readDownload(new Response(stream),'test.jar',4,new AbortController().signal,p=>events.push(p));
 assert.equal(blob.size,4);assert.equal(events[0].loaded,0);assert.equal(events.at(-1)?.loaded,4);assert.equal(events.at(-1)?.percent,100);
});
test('download errors identify the file and preserve the actual server reason',async()=>{
 await assert.rejects(readDownload(new Response(JSON.stringify({error:'Unsupported download host'}),{status:400}),'pack.zip',2,new AbortController().signal),/pack.zip: Unsupported download host/);
});
test('byte limits cancel streams before an oversized file can be installed',async()=>{
 const r=new Response(new Uint8Array([1,2,3]));await assert.rejects(readDownload(r,'mod.jar',2,new AbortController().signal),/exceeds expected size/);
});
