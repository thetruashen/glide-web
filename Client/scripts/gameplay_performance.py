"""Non-mod gameplay settings and legacy runtime snapshot ownership checks."""
import hashlib,json
from pathlib import Path

def owned_mods(runtime,root):
    # Legacy sessions may have injected files; never omit a user-edited JAR.
    try:items=json.loads((Path(runtime)/'performance-mods.json').read_text())
    except (OSError,ValueError):return set()
    result=set()
    for item in items:
        name=item.get('name','')
        if '/' in name or '\\' in name or not name.startswith('pigmc-') or not name.endswith('.jar'):continue
        path=Path(root)/'mods'/name
        if path.is_file() and not path.is_symlink():
            with path.open('rb') as file:
                if hashlib.file_digest(file,'sha256').hexdigest()==item.get('sha256'):result.add('mods/'+name)
    return result

def java_flags():
    # Balanced collector on CPU-constrained rendering hosts; no aggressive pause target.
    return ['-XX:+UseG1GC','-XX:+DisableExplicitGC']

def render_resolution(width,height,enabled=True):
    width=max(640,min(int(width),1920));height=max(360,min(int(height),1080))
    if enabled:
        scale=min(1,960/width,540/height)
        width=max(640,int(width*scale));height=max(360,int(height*scale))
    return width,height
