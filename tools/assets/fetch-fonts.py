#!/usr/bin/env python3
"""Download the two webfonts used by poster.html and site.html, and write fonts.css pointing at local files.

Google Fonts serves CJK fonts as ~230 unicode-range subsets (woff2); all of them are fetched (~10 MB),
so the renders work offline and don't depend on the network at screenshot time.
"""
import concurrent.futures, os, re, urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
CSS_URL = ('https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700'
           '&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;0,7..72,700;1,7..72,400&display=block')

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs('fonts', exist_ok=True)
css = get(CSS_URL).decode()
urls = sorted(set(re.findall(r'url\((https://[^)]+)\)', css)))

def fetch(u):
    fn = 'fonts/' + re.sub(r'[^A-Za-z0-9._-]', '_', u.split('/s/')[-1])[-120:]
    if not os.path.exists(fn):
        open(fn, 'wb').write(get(u))
    return u, fn

with concurrent.futures.ThreadPoolExecutor(16) as ex:
    for u, fn in ex.map(fetch, urls):
        css = css.replace(u, fn)
open('fonts.css', 'w').write(css)
print(len(urls), 'font files')
