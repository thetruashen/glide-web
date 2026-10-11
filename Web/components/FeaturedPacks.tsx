'use client';
import { useEffect, useState } from 'react';
import { curseKey, searchProjects, type Project } from '../lib/catalog-api';
export default function FeaturedPacks({ onOpen, onBrowse }: { onOpen(project: Project): void; onBrowse(): void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    searchProjects({ provider: curseKey() ? 'curseforge' : 'modrinth', type: 'modpack', query: '', sort: 'downloads' },abort.signal).then(result => setProjects(result.projects.slice(0,4))).catch(e => { if (!abort.signal.aborted) setError(String(e)); });
    return () => abort.abort();
  }, []);
  return <section className="panel featured-packs"><div className="panel-title"><h3>★ Featured modpacks</h3><button onClick={onBrowse}>View all →</button></div>{error ? <p>Pack previews are unavailable. Open the catalog to retry.</p> : <div className="featured-grid">{projects.length ? projects.map(p => <button className="featured-card" key={p.id} onClick={() => onOpen(p)}><img src={p.image || p.icon} alt="" loading="lazy"/><strong>{p.title}</strong><small>{p.provider === 'curseforge' ? 'CurseForge' : 'Modrinth'}</small></button>) : <p>Loading modpacks…</p>}</div>}</section>;
}
