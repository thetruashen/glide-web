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

def render_resolution(width,height,enabled=False):
    # Preserve the selected instance resolution; no performance render cap.
    return max(640,min(int(width),1920)),max(360,min(int(height),1080))
