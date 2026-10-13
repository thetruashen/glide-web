import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import ProjectText from '../components/ProjectText';
test('project descriptions preserve Markdown, images and tables while removing executable HTML',()=>{
 const html=renderToStaticMarkup(<ProjectText>{'## Hello\n\n![Screenshot](https://cdn.modrinth.com/image.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script><img src="x" onerror="alert(2)"><iframe src="https://evil.example"></iframe>[bad](javascript:alert)'}</ProjectText>);
 assert.match(html,/<h2>Hello/);assert.match(html,/<table>/);assert.match(html,/api\/image\?url=https%3A%2F%2Fcdn.modrinth.com%2Fimage.png/);assert.doesNotMatch(html,/src="https:\/\/cdn.modrinth.com/);assert.doesNotMatch(html,/<script|<iframe|onerror|(?:href|src)="javascript:/);
});
test('CurseForge redirect links resolve to their official external destination',()=>{
 const html=renderToStaticMarkup(<ProjectText base="https://www.curseforge.com/minecraft/modpacks/example">{'<a href="/linkout?remoteUrl=https%253a%252f%252fdownload.fo%252finstall">Install</a>'}</ProjectText>);
 assert.match(html,/href="https:\/\/download.fo\/install"/);
});
