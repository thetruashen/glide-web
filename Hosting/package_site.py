from pathlib import Path
import shutil
source=Path(__file__).resolve().parents[1]/'Web'/'out'
if not (source/'index.html').exists(): raise SystemExit('Run npm --prefix Web ci and npm --prefix Web run build first (without NEXT_PUBLIC_BASE_PATH).')
root=Path(__file__).resolve().parent
target=root/'public'
if target.resolve().parent!=root or target.is_symlink():raise SystemExit('Refusing to replace a public directory outside Hosting.')
if target.exists(): shutil.rmtree(target)
shutil.copytree(source,target)
print('Packaged compiled Next.js export for the Wasmer gateway.')
