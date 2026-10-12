import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {archiveEntries,entryBlob,rewriteArchive} from '../lib/instance-archive';
test('ZIP64 instance rewrites preserve saved files and replace mods without credentials',async()=>{
 const zip=new JSZip();zip.file('config/test.txt','settings');zip.file('mods/old.jar','old');const source=new Blob([new Uint8Array(await zip.generateAsync({type:'uint8array'}))]);
 const rewritten=await rewriteArchive(source,[{name:'new.jar',blob:new Blob(['new'])}],{format:1,profile:{name:'Example'}});
 const entries=await archiveEntries(rewritten,true);assert.ok(entries.some(e=>e.filename==='config/test.txt'));assert.ok(!entries.some(e=>e.filename==='mods/old.jar'));assert.equal(await (await entryBlob(entries.find(e=>e.filename==='mods/new.jar')!)).text(),'new');
});
test('archive readers handle central-directory offsets beyond 2 GiB without loading the whole file',async()=>{
 const zip=new JSZip();zip.file('config/test.txt','abc',{createFolders:false});const data=new Uint8Array(await zip.generateAsync({type:'uint8array'}));const view=new DataView(data.buffer);const end=data.length-22;const central=view.getUint32(end+16,true);const offset=2**31+1024;
 view.setUint32(central+42,offset,true);view.setUint32(end+16,central+offset,true);
 const small=new Blob([data]);class SparseBlob extends Blob{get size(){return offset+small.size;}slice(start=0,end=this.size){start=start<0?this.size+start:start;end=end<0?this.size+end:end;const padding=Math.max(0,Math.min(end,offset)-start);return new Blob([new Uint8Array(padding),small.slice(Math.max(0,start-offset),Math.max(0,end-offset))]);}}
 const entries=await archiveEntries(new SparseBlob());assert.equal(entries[0].filename,'config/test.txt');assert.equal(await (await entryBlob(entries[0])).text(),'abc');
});
