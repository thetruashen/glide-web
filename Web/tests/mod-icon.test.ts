import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {embeddedModIcon} from '../lib/mod-icon';
import {imageURL} from '../lib/images';
test('uploaded mod logos come from declared metadata without executing jar contents',async()=>{
 const zip=new JSZip();zip.file('META-INF/mods.toml','logoFile="assets/mod/logo.png"');zip.file('assets/mod/logo.png',new Uint8Array([1,2,3]));zip.file('Other.class','unused');
 const icon=await embeddedModIcon(new Blob([await zip.generateAsync({type:'uint8array'})]));assert.ok(icon);assert.equal(icon.type,'image/png');assert.equal(icon.size,3);
});
test('oversized or executable uploaded logo files are excluded',async()=>{
 for(const [path,size] of [['logo.png',524289],['logo.svg',10]] as const){const zip=new JSZip();zip.file('fabric.mod.json',JSON.stringify({icon:path}));zip.file(path,new Uint8Array(size));assert.equal(await embeddedModIcon(new Blob([await zip.generateAsync({type:'uint8array'})])),undefined);}
});
test('remote images route through the gateway and local icons remain local',()=>{
 assert.equal(imageURL('/pigmc.png'),'/pigmc.png');assert.equal(imageURL('javascript:alert(1)'),undefined);assert.match(imageURL('https://cdn.modrinth.com/icon.png')!,/\/api\/image\?url=/);
});
