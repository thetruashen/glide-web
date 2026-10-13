"""Bounded, credential-free proxy for trusted catalog image CDNs."""
from urllib.parse import urlsplit,urljoin
from functools import lru_cache
import requests

HOSTS={'cdn.modrinth.com','media.forgecdn.net','mediafilez.forgecdn.net','static.forgecdn.net','avatars.githubusercontent.com','raw.githubusercontent.com','user-images.githubusercontent.com','i.imgur.com','img.shields.io','cdn.discordapp.com','media.discordapp.net'}
LIMIT=8*1024*1024
TYPES={'image/png','image/jpeg','image/gif','image/webp','image/avif'}

def allowed(url):
    p=urlsplit(url)
    if p.scheme!='https' or p.hostname not in HOSTS or p.username or p.password or p.port not in (None,443):raise ValueError('Unsupported image host')
    return url

def load_image(url):
    for _ in range(5):
        allowed(url)
        response=requests.get(url,stream=True,allow_redirects=False,timeout=(5,20),headers={'User-Agent':'pigmc/1','Accept':'image/*','Accept-Encoding':'identity'})
        try:
            if response.is_redirect:
                url=urljoin(url,response.headers.get('Location',''));continue
            if not response.ok:raise ValueError('Image unavailable')
            mime=response.headers.get('Content-Type','').split(';')[0].lower()
            if mime not in TYPES:raise ValueError('Unsupported image type')
            if int(response.headers.get('Content-Length','0'))>LIMIT:raise ValueError('Image too large')
            body=bytearray()
            for chunk in response.iter_content(65536):
                body.extend(chunk)
                if len(body)>LIMIT:raise ValueError('Image too large')
            return bytes(body),mime
        finally:response.close()
    raise ValueError('Too many image redirects')

@lru_cache(maxsize=4)
def cached_image(url,bucket):
    body,mime=load_image(url)
    return body,mime
