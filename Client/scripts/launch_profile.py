"""Validate the prepared profile before either native or Prism launch."""
import json
import re
from pathlib import Path

UIDS={'forge':'net.minecraftforge','neoforge':'net.neoforged','fabric':'net.fabricmc.fabric-loader','quilt':'org.quiltmc.quilt-loader'}
PREFIXES={'forge':'net.minecraftforge:forge:','neoforge':'net.neoforged:neoforge:','fabric':'net.fabricmc:fabric-loader:','quilt':'org.quiltmc:quilt-loader:'}

def components_for(game,launch_id,version,loader,pin=''):
    data=json.loads((Path(game)/'versions'/launch_id/f'{launch_id}.json').read_text())
    inherited=data.get('inheritsFrom')
    if inherited and inherited!=version:raise ValueError(f'Prepared profile targets {inherited}, expected {version}.')
    components=[{'uid':'net.minecraft','version':version,'important':True}]
    if loader=='vanilla':
        if launch_id!=version:raise ValueError('Vanilla launch selected a different game profile.')
        return components
    if loader not in UIDS:raise ValueError(f'Unsupported loader: {loader}')
    found=[]
    for library in data.get('libraries',[]):
        name=library.get('name','')
        if name.startswith(PREFIXES[loader]):
            value=name[len(PREFIXES[loader]):].split(':')[0]
            if loader=='forge':value=value.removeprefix(version+'-')
            found.append(value)
    patterns={'forge':r'(?:^|-)forge-(.+)$','neoforge':r'^neoforge-(.+)$','fabric':r'^fabric-loader-(.+)-'+re.escape(version)+r'$','quilt':r'^quilt-loader-(.+)-'+re.escape(version)+r'$'}
    match=re.search(patterns[loader],launch_id)
    selected=found[0] if found else match.group(1) if match else ''
    if not selected:raise ValueError(f'{loader} is missing from prepared profile {launch_id}; refusing a vanilla fallback.')
    if pin and selected!=pin:raise ValueError(f'Prepared {loader} {selected}, expected pinned {pin}.')
    components.append({'uid':UIDS[loader],'version':selected})
    return components
