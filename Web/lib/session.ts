import {MAX_PROFILE_BYTES} from './limits';
import type {ReportProgress} from './progress';
import type { Profile } from './storage';
export type Session = { id: string; profileId: string; repo: string; privateKey: JsonWebKey; runId?: number; url?: string; secret?: string; created: number; uploaded?: boolean; workflow?: string };
export class RunnerEnded extends Error {}
export type Status = { stage: string; started: boolean; finished: boolean; exitCode?: number; error?: string; MICROSOFT_LOGIN_URL?: string; MICROSOFT_LOGIN_CODE?: string; MINECRAFT_ACCOUNT_NAME?: string };
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const b64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));
export function persistSession(s: Session) { sessionStorage.setItem(s.workflow === 'catalog-download.yml' ? 'glide-catalog-helper' : 'glide-session', JSON.stringify(s)); }
export async function github(repo: string, path: string, token: string, body?: unknown, method?: string) {
  if(token==='@server') {
    const response=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo,path,body,method:method || (body?'POST':'GET')})});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(`Launcher ${response.status}: ${error.error || 'Request failed'}`);}
    return response.status===204 || response.status===202 ? null : response.json();
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must be owner/name');
  const response = await fetch(`https://api.github.com/repos/${repo}${path ? '/' + path : ''}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`GitHub ${response.status}: ${error.message || 'Request failed'}`);
  }
  return response.status === 204 || response.status === 202 ? null : response.json();
}
export async function launch(profile: Profile, repo: string, token: string): Promise<Session> {
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const session: Session = { id: crypto.randomUUID(), profileId: profile.id, repo, privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey), created: Date.now() };
  const info = await github(repo, '', token);
  const request = { ...profile, publicKey: b64(await crypto.subtle.exportKey('spki', keys.publicKey)), origin: location.origin };
  persistSession(session);
  try {
    await github(repo, 'actions/workflows/glide-session.yml/dispatches', token, { ref: info.default_branch, inputs: { session_id: session.id, request: JSON.stringify(request) } });
  } catch (e) { sessionStorage.removeItem('glide-session'); throw e; }
  return session;
}
export async function connect(session: Session, token: string, report?:ReportProgress): Promise<Session> {
  if (!session.runId) {
    const runs = await github(session.repo, `actions/workflows/${session.workflow || 'glide-session.yml'}/runs?event=workflow_dispatch&per_page=100`, token);
    const run = runs.workflow_runs.find((run: { display_title: string }) => run.display_title === `Glide · ${session.id}`);
    if (!run){report?.({title:'Waiting for an available runner'});return session;}
    session = { ...session, runId: run.id }; persistSession(session);
  }
  const run = await github(session.repo, `actions/runs/${session.runId}`, token);
  if (run.status === 'completed') throw new RunnerEnded(`Runner ended (${run.conclusion}). Your last browser backup is still available.`);
  const jobs = await github(session.repo, `actions/runs/${session.runId}/jobs`, token);
  const steps=jobs.jobs.flatMap((j:{steps:{name:string;status:string}[]})=>j.steps||[]);
  const connectionIndex=steps.findIndex((s:{name:string})=>s.name.startsWith('CONNECT::'));
  const preparation=connectionIndex>=0?steps.slice(0,connectionIndex+1):steps.filter((s:{name:string})=>!/^Post |Complete job|Wait for browser|Remove personal/.test(s.name));
  const done=preparation.filter((s:{status:string})=>s.status==='completed').length;
  const active=preparation.find((s:{status:string})=>s.status==='in_progress');
  const title=active?.name.includes('game cache')?'Restoring cached game files':active?.name.includes('game once')||active?.name.includes('modpack loader')?'Preparing Minecraft and its loader':active?.name.includes('desktop')||active?.name.includes('streaming')?'Starting the desktop and stream':'Preparing your private runner';
  report?.({title,detail:`${done} of ${preparation.length} preparation steps complete`,percent:preparation.length?done/preparation.length*100:undefined});
  const step = jobs.jobs.flatMap((job: { steps: { name: string; status: string }[] }) => job.steps || []).find((step: { name: string; status: string }) => step.status === 'completed' && /^CONNECT::[A-Za-z0-9+/]{512}$/.test(step.name));
  if (!step) return session;
  const key = await crypto.subtle.importKey('jwk', session.privateKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const decoded = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, bytes(step.name.slice('CONNECT::'.length)));
  const info = JSON.parse(new TextDecoder().decode(decoded));
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(info.url) || !/^[\w-]{40,}$/.test(info.secret)) throw new Error('Invalid connection response');
  session = { ...session, url: info.url, secret: info.secret };
  // Quick-tunnel DNS and HTTPS may lag behind its announcement.
  // Verify connectivity before mounting an iframe that could cache a DNS failure.
  await runner(session, 'status');
  persistSession(session); return session;
}
export async function runner(session: Session, path: string, body?: Blob | string): Promise<Response> {
  if (!session.url || !session.secret) throw new Error('Runner is not connected yet');
  const response = await fetch(`${session.url}/glide-api/${path}`, { method: body !== undefined ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.secret}`, ...(body !== undefined ? { 'Content-Type': body instanceof Blob ? 'application/zip' : 'application/json' } : {}) }, body });
  if (!response.ok) throw new Error(`Runner ${response.status}: ${await response.text()}`);
  return response;
}
export function streamURL(session: Session) { return `${session.url}/glide-api/login?ticket=${encodeURIComponent(session.secret || '')}`; }
export async function launchDownloadHelper(repo: string, token: string): Promise<Session> {
  const keys = await crypto.subtle.generateKey({ name:'RSA-OAEP', modulusLength:3072, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' },true,['encrypt','decrypt']);
  const session: Session = { id:crypto.randomUUID(), profileId:'catalog', repo, privateKey:await crypto.subtle.exportKey('jwk',keys.privateKey), created:Date.now(), workflow:'catalog-download.yml' };
  const info = await github(repo,'',token);
  await github(repo,'actions/workflows/catalog-download.yml/dispatches',token,{ref:info.default_branch,inputs:{session_id:session.id,request:JSON.stringify({publicKey:b64(await crypto.subtle.exportKey('spki',keys.publicKey)),origin:location.origin})}});
  persistSession(session); return session;
}
export async function uploadProfile(session: Session, blob: Blob, report?:ReportProgress) {
  if (blob.size > MAX_PROFILE_BYTES) throw new Error('Profile exceeds the 4 GiB transfer limit.');
  const id = crypto.randomUUID(), size = 8 * 1048576;
  const count = Math.ceil(blob.size / size);
  const started=Date.now();
  report?.({title:'Uploading your instance',loaded:0,total:blob.size,percent:0});
  for(let i=0;i<count;i++){await runner(session,`upload/${id}/${i}`,blob.slice(i*size,(i+1)*size));const loaded=Math.min(blob.size,(i+1)*size);report?.({title:'Uploading your instance',loaded,total:blob.size,percent:loaded/blob.size*100,speed:loaded/Math.max(.1,(Date.now()-started)/1000)});}
  report?.({title:'Restoring your instance on the runner'});
  await runner(session, `import/${id}/${count}`, '{}');
}
