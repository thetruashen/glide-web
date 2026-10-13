const GATEWAY='https://glide-thetruashen.wasmer.app';
export function imageURL(url?:string):string|undefined{
 if(!url)return undefined;
 if(url.startsWith('/')||url.startsWith('data:')||url.startsWith('blob:'))return url;
 try{const parsed=new URL(url);if(parsed.protocol!=='https:')return undefined;if(parsed.pathname==='/api/image'&&parsed.origin===GATEWAY)return url;const base=typeof location!=='undefined'&&location.hostname.endsWith('.wasmer.app')?'':GATEWAY;return `${base}/api/image?url=${encodeURIComponent(parsed.href)}`;}catch{return undefined;}
}
