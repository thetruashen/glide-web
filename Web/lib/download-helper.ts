import { connect, github, launchDownloadHelper, persistSession, runner, type Session } from './session';
import type { CatalogFile } from './catalog-api';
export class DownloadHelper {
  private session?: Session;
  constructor(private repo: string, private token: string, private progress: (message:string)=>void) {}
  async fetch(file: CatalogFile, signal: AbortSignal): Promise<Blob> {
    signal.throwIfAborted();
    if (!file.url) throw new Error('The author does not allow an automatic download for this file.');
    if (!this.session) {
      this.progress('Starting a private Actions download helper…');
      const saved = sessionStorage.getItem('glide-catalog-helper');
      if (saved) {
        try { const value=JSON.parse(saved); if(value.repo===this.repo) this.session=await connect(value,this.token); } catch {sessionStorage.removeItem('glide-catalog-helper');}
      }
      if (!this.session) this.session=await launchDownloadHelper(this.repo,this.token);
    }
    const deadline=Date.now()+180000;
    while (!this.session.url) {
      signal.throwIfAborted();
      if (Date.now()>deadline) throw new Error('Download helper took too long. Retry or download the file manually.');
      try {this.session=await connect(this.session,this.token);} catch(error) {if(error instanceof Error && (error.message.startsWith('Runner ended') || /GitHub (401|403|404)/.test(error.message)))throw error;}
      persistSession(this.session);
      if (!this.session.url) await new Promise(resolve=>setTimeout(resolve,3000));
    }
    signal.throwIfAborted();
    this.progress(`Downloading through the private helper: ${file.name}`);
    return (await runner(this.session,'catalog-file',JSON.stringify({url:file.url,size:file.size}))).blob();
  }
  async close() {
    if (!this.session) return;
    try { if(this.session.url)await runner(this.session,'stop','{}'); } catch {}
    try {
      if(!this.session.runId) this.session=await connect(this.session,this.token);
      if(this.session.runId) await github(this.repo,`actions/runs/${this.session.runId}/cancel`,this.token,{},'POST');
    } catch {}
    sessionStorage.removeItem('glide-catalog-helper'); this.session=undefined;
  }
}
