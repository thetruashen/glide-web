// Modpacks may define their own folders. Reserve only launcher/cache/private roots.
export const RESERVED_ROOTS = new Set(['assets', 'libraries', 'versions', 'natives', 'runtime', 'runtimes', 'java', 'jre', 'jdk', 'logs', 'crash-reports', 'webcache', 'launcher_profiles.json', 'launcher_profiles_microsoft_store.json', 'launcher_accounts.json', 'accounts.json', 'usercache.json', 'usernamecache.json', 'authentication.json', 'credentials.json', 'access_tokens.json', 'glide-profile.json']);
export function contentRoot(name: string): boolean {
  return !!name && !name.startsWith('.') && !RESERVED_ROOTS.has(name.toLowerCase());
}
export function safePath(path: string): string {
  const parts = path.split('/');
  if (!path || /[\\:\x00-\x1f\x7f]/.test(path) || parts.some(p => p === '..' || p === '.' || !p) || !contentRoot(parts[0])) throw new Error(`Unsupported or unsafe pack path: ${path}`);
  return path;
}
