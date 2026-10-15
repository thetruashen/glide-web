// Pack-owned data only: shared assets/libraries/versions and launcher credentials stay excluded.
export const CONTENT_ROOTS = new Set(['mods', 'saves', 'config', 'resourcepacks', 'shaderpacks', 'datapacks', 'kubejs', 'scripts', 'defaultconfigs', 'patchouli_books', 'fancymenu', 'openloader', 'paxi', 'global_packs', 'packmenu', 'journeymap', 'fontfiles', 'fonts', 'resources', 'customnpcs', 'schematics', 'structures', 'local', 'ftbquests', 'ftbteams', 'xaero', 'XaeroWaypoints', 'XaeroWorldMap', 'voxelmap', 'essential', 'fancymenu_data', 'customloadingscreen', 'loadingscreens', 'drippyloadingscreen', 'custommainmenu', 'craftpresence', 'tlm', 'emotes', 'figura', 'emi', 'rei', 'jei']);
export const SINGLE_FILES = new Set(['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'optionsvivecraft.txt', 'servers.dat', 'icon.png', 'pack.png']);
export function safePath(path: string): string {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || /[\\:\x00-\x1f]/.test(path) || parts.some(p => p === '..' || p === '.' || !p) || !((CONTENT_ROOTS.has(parts[0]) && parts.length > 1) || (parts.length === 1 && SINGLE_FILES.has(path)))) throw new Error(`Unsupported or unsafe pack path: ${path}`);
  return path;
}
