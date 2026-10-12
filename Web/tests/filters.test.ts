import test from 'node:test';
import assert from 'node:assert/strict';
import {searchProjects,clearCatalogCache,configureCatalog} from '../lib/catalog-api';
test('Modrinth filters combine independent facets and OR selected categories',async()=>{
 const original=globalThis.fetch;let url='';globalThis.fetch=async(input)=>{url=String(input);return new Response(JSON.stringify({hits:[],total_hits:0}),{status:200});};
 try{configureCatalog(false);await searchProjects({provider:'modrinth',type:'modpack',query:'',sort:'downloads',version:'1.21.1',loader:'neoforge',categories:['adventure','magic'],environment:'client_and_server',openSource:true});const facets=JSON.parse(new URL(url).searchParams.get('facets')!);assert.deepEqual(facets,[['project_type:modpack'],['versions:1.21.1'],['categories:neoforge'],['categories:adventure','categories:magic'],['environment:client_and_server'],['open_source:true']]);}finally{globalThis.fetch=original;clearCatalogCache();}
});
test('CurseForge category filters use JSON arrays and loader filters require a game version',async()=>{
 const original=globalThis.fetch;let url='';globalThis.fetch=async(input)=>{url=String(input);return new Response(JSON.stringify({data:[],pagination:{totalCount:0}}),{status:200});};
 try{configureCatalog(true);await searchProjects({provider:'curseforge',type:'modpack',query:'',sort:'downloads',loader:'fabric',categories:['4475','4481']});let params=new URL(url,'https://example.com').searchParams;assert.equal(params.get('categoryIds'),'[4475,4481]');assert.equal(params.has('modLoaderType'),false);await searchProjects({provider:'curseforge',type:'modpack',query:'',sort:'downloads',loader:'fabric',version:'1.21.1'});params=new URL(url,'https://example.com').searchParams;assert.equal(params.get('modLoaderType'),'4');}finally{globalThis.fetch=original;configureCatalog(false);}
});
