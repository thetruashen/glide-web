'use client';
import {imageURL} from '../lib/images';
import ReactMarkdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

export default function ProjectText({children,base='https://modrinth.com'}:{children:string;base?:string}) {
  function url(value:string) {
    if(value.startsWith('/linkout?remoteUrl=')) {
      try { value=decodeURIComponent(new URL(value,'https://www.curseforge.com').searchParams.get('remoteUrl') || ''); } catch {return '';}
    }
    const safe=defaultUrlTransform(value);
    if(!safe || safe.startsWith('#'))return safe;
    try {const parsed=new URL(safe,base);return ['https:','http:','mailto:'].includes(parsed.protocol)?parsed.href:'';}catch{return '';}
  }
  return <div className="project-description"><ReactMarkdown urlTransform={url} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw,rehypeSanitize]} components={{a:({node,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>,img:({node,...props})=><img {...props} src={typeof props.src==='string'?imageURL(props.src):undefined} loading="lazy" referrerPolicy="no-referrer" alt={props.alt || ''}/>}}>{children}</ReactMarkdown></div>;
}
