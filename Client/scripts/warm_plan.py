"""Bounded prewarm jobs; any official selection can also cache on first launch."""
import json
import os
from catalog import catalog

data = catalog()
selection = os.environ.get('WARM_VERSIONS', '1.21.1,1.20.1,1.21.4')
offset = max(0, int(os.environ.get('WARM_OFFSET', '0')))
if selection == 'all':
    chosen = data['versions'][offset:offset + 20]
else:
    wanted = selection.split(',')
    chosen = [v for v in data['versions'] if v['id'] in wanted]
    if len(chosen) != len(set(wanted)):
        raise ValueError('Unknown Minecraft version in prewarm list')
jobs = [{'version': v['id'], 'loader': l} for v in chosen for l in v['loaders']]
if not jobs or len(jobs) > 100:
    raise ValueError('Choose at most 20 versions per batch')
with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
    output.write('matrix=' + json.dumps({'include': jobs}, separators=(',', ':')) + '\n')
