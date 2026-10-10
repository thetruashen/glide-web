import type { Profile } from './storage';
export type Session = { id: string; profileId: string; repo: string; privateKey: JsonWebKey; runId?: number; url?: string; secret?: string; created: number; uploaded?: boolean };
export type Status = { stage: string; started: boolean; finished: boolean; MICROSOFT_LOGIN_URL?: string; MICROSOFT_LOGIN_CODE?: string; MINECRAFT_ACCOUNT_NAME?: string };
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const b64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));
export function persistSession(s: Session) { sessionStorage.setItem('glide-session', JSON.stringify(s)); }
export async function github(repo: string, path: string, token: string, body?: unknown, method?: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must be owner/name');
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
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
export async function connect(session: Session, token: string): Promise<Session> {
  if (!session.runId) {
    const runs = await github(session.repo, 'actions/workflows/glide-session.yml/runs?event=workflow_dispatch&per_page=100', token);
    const run = runs.workflow_runs.find((run: { display_title: string }) => run.display_title === `Glide · ${session.id}`);
    if (!run) return session;
    session = { ...session, runId: run.id }; persistSession(session);
  }
  const run = await github(session.repo, `actions/runs/${session.runId}`, token);
  if (run.status === 'completed') throw new Error(`Runner ended (${run.conclusion}). Your last browser backup is still available.`);
  const jobs = await github(session.repo, `actions/runs/${session.runId}/jobs`, token);
  const step = jobs.jobs.flatMap((job: { steps: { name: string }[] }) => job.steps || []).find((step: { name: string }) => step.name.startsWith('CONNECT::'));
  if (!step) return session;
  const key = await crypto.subtle.importKey('jwk', session.privateKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const decoded = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, bytes(step.name.slice('CONNECT::'.length)));
  const info = JSON.parse(new TextDecoder().decode(decoded));
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(info.url) || !/^[\w-]{40,}$/.test(info.secret)) throw new Error('Invalid connection response');
  session = { ...session, url: info.url, secret: info.secret }; persistSession(session); return session;
}
export async function runner(session: Session, path: string, body?: Blob | string): Promise<Response> {
  if (!session.url || !session.secret) throw new Error('Runner is not connected yet');
  const response = await fetch(`${session.url}/glide-api/${path}`, { method: body !== undefined ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.secret}`, ...(body !== undefined ? { 'Content-Type': body instanceof Blob ? 'application/zip' : 'application/json' } : {}) }, body });
  if (!response.ok) throw new Error(`Runner ${response.status}: ${await response.text()}`);
  return response;
}
export function streamURL(session: Session) { return `${session.url}/glide-api/login?ticket=${encodeURIComponent(session.secret || '')}`; }
