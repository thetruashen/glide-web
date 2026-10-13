"""Apply the requested baseline once per local instance; retain later changes."""
import json
from pathlib import Path

def apply_defaults(directory,version):
    root=Path(directory);marker=root/'config'/'pigmc-performance.json'
    if marker.exists():return
    try:minor=int(version.split('.')[1])
    except (ValueError,IndexError):minor=99
    values={'renderDistance':'4','simulationDistance':'6','entityDistanceScaling':'0.75','ao':'false' if minor>=17 else '0','entityShadows':'false','particles':'2','mipmapLevels':'0','graphicsMode':'0','fancyGraphics':'false','renderClouds':'false','biomeBlendRadius':'0','maxFps':'60'}
    path=root/'options.txt';existing={}
    if path.exists():
        for line in path.read_text().splitlines():
            if ':' in line:
                key,value=line.split(':',1);existing[key]=value
    existing.update(values);path.write_text(''.join(f'{key}:{value}\n' for key,value in existing.items()))
    marker.parent.mkdir(parents=True,exist_ok=True);marker.write_text(json.dumps({'applied':True,'preset':'performance'}))
