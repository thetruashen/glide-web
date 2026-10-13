'use client';
import {useEffect,useState} from 'react';
import {Package} from 'lucide-react';
import {getBackup} from '../lib/storage';
import {archiveEntries} from '../lib/instance-archive';
export default function InstanceAssets({id,type,revision}:{id:string;type:'resourcepack'|'shader';revision:string}){
 const [files,setFiles]=useState<{name:string;size:number}[]>([]);
 useEffect(()=>{let active=true;setFiles([]);(async()=>{const backup=await getBackup(id);if(!backup)return;const prefix=type==='shader'?'shaderpacks/':'resourcepacks/';const entries=await archiveEntries(backup);if(active)setFiles(entries.filter(e=>!e.directory&&e.filename.startsWith(prefix)).map(e=>({name:e.filename.slice(prefix.length),size:e.uncompressedSize})));})().catch(()=>{});return()=>{active=false;};},[id,type,revision]);
 return <section className="panel"><h3>Installed {type==='shader'?'shaders':'resource packs'}</h3>{files.length?files.map(f=><div className="mod" key={f.name}><Package size={20}/><div>{f.name}<small>{(f.size/1048576).toFixed(1)} MB</small></div></div>):<p>No {type==='shader'?'shaders':'resource packs'} installed in this instance yet.</p>}</section>;
}
