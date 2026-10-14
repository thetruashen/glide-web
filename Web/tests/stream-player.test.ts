import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../../Client/assets/player.js',import.meta.url),'utf8');
function player(promise=true){
 const events=new Map<string,Function>();let locks=0,focus=0;
 class Element{constructor(public stream=false){}closest(){return this.stream?this:null;}}
 const surface=new Element(true) as Element&{requestPointerLock:()=>Promise<void>|void;focus:()=>void};
 surface.requestPointerLock=()=>{locks++;return promise?Promise.resolve():undefined;};surface.focus=()=>{focus++;};
 const document={documentElement:{style:{setProperty:()=>{}}},pointerLockElement:null as unknown,addEventListener:(name:string,handler:Function)=>events.set(name,handler)};
 const input={inputAttached:true,element:surface};
 runInNewContext(code,{document,window:{webrtcInput:input},Element,URLSearchParams,location:{search:'?manual_width=1280&manual_height=720'}});
 return{click:(target=surface,button=0)=>events.get('pointerdown')!({target,button}),surface,input,document,Element,get locks(){return locks;},get focus(){return focus;}};
}
test('clicking the stream captures the existing input surface immediately',()=>{
 const p=player();p.click();assert.equal(p.locks,1);assert.equal(p.focus,1);
 p.document.pointerLockElement=p.surface;p.click();assert.equal(p.locks,1);
});
test('dashboard clicks, right clicks and an unready stream do not capture the pointer',()=>{
 const p=player();p.click(new p.Element(false) as typeof p.surface);p.click(p.surface,2);p.input.inputAttached=false;p.click();assert.equal(p.locks,0);
});
test('pointer capture supports browsers with a void requestPointerLock return',()=>{
 const p=player(false);assert.doesNotThrow(()=>p.click());assert.equal(p.locks,1);
});
