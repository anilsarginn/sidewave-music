#!/usr/bin/env python3
"""Capture the actual web UI with synthetic data and no external API requests.

Requires Python Playwright and a built Sidewave preview server. See docs/screenshots/README.md.
"""
from pathlib import Path
import os
from urllib.parse import urlparse
import json, io, wave
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/screenshots'
ART = ROOT / 'sidewave/web/public/artwork/sessions'
WORK = Path(os.environ.get('SIDEWAVE_CAPTURE_DIR', ROOT / 'artifacts/presentation'))
WORK.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('SIDEWAVE_PREVIEW_URL', 'http://127.0.0.1:14445')
NAMES = ['Afterglow', 'Slow Orbit', 'City Lights', 'Blue Hours', 'Analog Dreams', 'Velvet Morning', 'Into the Quiet', 'Golden Hour']
ART_IDS = ['electronic-horizons', 'disco-orbit', 'funk-roots', 'guitar-universe', 'jazz-after-hours', 'psychedelic-roots', 'slow-motion', 'soul-colors']
ARTISTS = ['North Avenue', 'Paper Satellites', 'Quiet Assembly', 'Coastline Echoes']
songs = [dict(id=f'demo-{i}', appId=f'demo-{i}', baslik=n, sanatci=ARTISTS[i % 4], kaynak='kutuphane', sure=216, album=ART_IDS[i].replace('-', ' ').title(), albumId=f'album-{i}', kapakId=f'cover-{i}', favori=i % 2 == 0) for i, n in enumerate(NAMES)]
playlists = [dict(id=f'list-{i}', ad=n, parcaSayisi=24 + i * 6, kapaklar=[songs[(i + k) % len(songs)] for k in range(4)], parcalar=songs) for i, n in enumerate(['Night Drive', 'Sunday Slowdown', 'Deep Focus', 'Morning Coffee'])]
mixes = [dict(id=f'mix-{i}', ad=f'Daily Mix {i + 1}', altyazi=songs[i]['sanatci'] + ' and more', renk=c, kapak=songs[i], parcaSayisi=30, parcalar=songs) for i, c in enumerate(['#a4dbc0', '#dfac8d', '#a5a9df', '#e0c382', '#c49ac0'])]
sessions = [dict(id=slug, ad=slug.replace('-', ' ').title(), tur=genre, renk=color, aciklama=desc, owner='Sidewave', editable=False, kapak=f'/artwork/sessions/{slug}-v1.webp', parcaSayisi=32, parcalar=songs) for slug, genre, color, desc in [
 ('electronic-horizons', 'Electronic', '#8b83b8', 'Warm synths, distant textures, and new places to get lost.'),
 ('jazz-after-hours', 'Jazz', '#619aaf', 'Late-night brass and unhurried conversations.'),
 ('psychedelic-roots', 'Psychedelic', '#bd9568', 'Winding guitars and hazy, sun-soaked grooves.'),
 ('soul-colors', 'Soul', '#c793a7', 'Voices that stay with you long after the last note.'),
 ('disco-orbit', 'Disco', '#a892b8', 'A little shimmer. A little motion. One more track.'),
 ('slow-motion', 'Ambient', '#7eaba1', 'Space to breathe, think, and drift away.'),
 ('guitar-universe', 'Rock', '#a07685', 'From quiet strings to wide-open soundscapes.'),
 ('funk-roots', 'Funk', '#c49356', 'Deep pockets, loose rhythms, and a warmer kind of energy.'),
]]
lyrics = ['Leave the city in the rearview', 'Let the evening find its way', 'There is colour in the quiet', 'There is light beyond the day', 'Every road becomes a rhythm', 'Every moment finds a place']
audio = io.BytesIO()
with wave.open(audio, 'wb') as w:
 w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(b'\0' * 216 * 8000 * 2)
SILENCE = audio.getvalue()
errors = []
network = []

def route_api(route):
 path = urlparse(route.request.url).path
 if path.startswith('/api/cover/'):
  try: i = int(path.split('-')[-1]) % len(ART_IDS)
  except ValueError: i = 0
  return route.fulfill(content_type='image/webp', body=(ART / f'{ART_IDS[i]}-v1.webp').read_bytes())
 if path == '/api/v1/playback/resolve':
  track = route.request.post_data_json.get('parca', songs[0])
  return route.fulfill(json={'url': '/demo-silence.wav', 'delivery': 'archive', 'parca': track})
 if path.endswith('/lyrics'):
  return route.fulfill(json={'synced': [{'t': i * 12, 'text': line} for i, line in enumerate(lyrics)], 'plain': '\n'.join(lyrics), 'instrumental': False, 'source': 'demo'})
 if path.startswith('/api/v1/tracks/'):
  return route.fulfill(json={'parca': songs[0], 'delivery': 'archive', 'format': 'flac', 'bitrate': 960, 'lyrics': '\n'.join(lyrics), 'credits': []})
 if path.startswith('/api/v1/discovery/') and route.request.method == 'POST':
  body = route.request.post_data_json
  is_mix = path.endswith('/instant-mix')
  is_path = path.endswith('/path')
  tracks = [songs[0], *songs[1:5], songs[6]] if is_path else [songs[0], *songs[1:6]] if is_mix else songs[1:6]
  analysis = {'id': 'demo-session', 'state': 'ready', 'completed': 5, 'total': 5, 'failed': 0, 'message': 'Audio sample comparison complete'}
  matches = [{'parca': s, 'similarity': round(.94 - i * .045, 2) if i < 3 else None, 'method': 'audio_excerpt' if i < 3 else 'catalog'} for i, s in enumerate(tracks)]
  return route.fulfill(json={'state': 'ready', 'method': 'hybrid', 'parcalar': tracks, 'matches': matches, **({} if is_path else {'analysis': analysis})})
 routes = {
  '/api/auth/me': {'user': {'id': 'demo', 'username': 'Anıl', 'owner': True}},
  '/api/v1/home/intro': {'kind': 'greeting', 'period': 'demo', 'greeting': 'Good evening'},
  '/api/status': {'navidrome': True, 'ytres': True},
  '/api/v1/history': {'parcalar': songs[:6]},
  '/api/listeler': {'listeler': playlists},
  '/api/v1/mixes': {'day': 'demo', 'mixes': mixes},
  '/api/v1/home': {'sections': {'rediscover': {'state': 'ready', 'data': []}, 'forYou': {'state': 'ready', 'data': songs[2:]}}},
  '/api/favoriler': {'parcalar': songs[:4], 'albumler': []},
  '/api/ara': {'parcalar': songs, 'albumler': [], 'sanatcilar': []},
  '/api/v1/recommendations': {'parcalar': songs[2:]},
  '/api/v1/collections': {'listeler': sessions},
  '/api/v1/discovery/capabilities': {'available': True, 'message': 'Available for analyzed tracks in your library.'},
  '/api/v1/devices': {'devices': [], 'activeDeviceId': None},
  '/api/v1/events': {'id': 'demo-event'},
 }
 for m in mixes: routes['/api/v1/mixes/' + m['id']] = m
 for p in playlists: routes['/api/liste/' + p['id']] = p
 for s in sessions: routes['/api/v1/collections/' + s['id']] = s
 return route.fulfill(json=routes.get(path, {'parcalar': [], 'listeler': [], 'albumler': [], 'sanatcilar': [], 'devices': [], 'jobs': [], 'items': [], 'indirmeler': []}))

def prepare(context):
 context.route('**/api/**', route_api)
 context.route('**/demo-silence.wav', lambda route: route.fulfill(content_type='audio/wav', body=SILENCE))
 context.add_init_script('''window.__presentationAudio=[];
 const NativeAudio=window.Audio;
 window.Audio=function(...args){const a=new NativeAudio(...args);window.__presentationAudio.push(a);return a;};
 window.Audio.prototype=NativeAudio.prototype;
 if (!localStorage.getItem('presentation-seeded')) {
 localStorage.setItem('sidewave-wallpaper','/artwork/wallpapers/midnight-coast-v1.webp');
 localStorage.setItem('sidewave-appearance',JSON.stringify({dim:10,transparency:85}));
 localStorage.setItem('presentation-seeded','true'); }''')

def ready(page):
 page.wait_for_function('document.fonts.status === "loaded"')
 page.wait_for_function('Array.from(document.images).filter(i => i.offsetParent !== null).every(i => i.complete && i.naturalWidth > 0)')
 page.wait_for_timeout(450)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

def shot(page, name, locator=None):
 ready(page)
 if locator: locator.screenshot(path=str(OUT / name))
 else: page.screenshot(path=str(OUT / name))
 print('Captured', name, flush=True)

def main():
 with sync_playwright() as p:
  browser = p.chromium.launch()
  context = browser.new_context(viewport={'width': 1440, 'height': 1080}, device_scale_factor=1, record_video_dir=str(WORK / 'video'), record_video_size={'width': 1440, 'height': 1080})
  prepare(context)
  page = context.new_page()
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.on('request', lambda r: network.append(r.url) if not r.url.startswith(BASE) else None)
  page.goto(BASE)
  expect(page.get_by_role('heading', name='Welcome back, Anıl')).to_be_visible()
  expect(page.get_by_text('Alex', exact=True)).to_have_count(0)
  expect(page.locator('.app-shell')).to_have_class(__import__('re').compile('has-wallpaper'))
  shot(page, 'web.png')
  page.wait_for_timeout(900)
  page.get_by_role('button', name='Profile', exact=True).click()
  page.get_by_role('menuitem', name='Background & appearance', exact=True).click()
  expect(page.get_by_role('button', name='Midnight Coast', exact=True)).to_have_attribute('aria-pressed', 'true')
  shot(page, 'appearance.png')
  page.wait_for_timeout(600)
  page.get_by_role('button', name='Close appearance', exact=True).click()
  page.locator('.mix-card').first.click()
  expect(page.get_by_role('heading', name='Daily Mix 1', exact=True)).to_be_visible()
  shot(page, 'mix.png')
  page.wait_for_timeout(700)
  page.get_by_role('button', name='Home', exact=True).first.click()
  page.locator('.home-recent-grid article').first.get_by_role('button').first.click()
  expect(page.get_by_role('button', name='Show now playing')).to_be_enabled()
  page.wait_for_function('window.__presentationAudio.some(a=>a.duration > 100)')
  page.evaluate('window.__presentationAudio.forEach(a=>{if(a.duration>100){a.currentTime=39;a.pause()}})')
  shot(page, 'web.png')
  page.get_by_role('button', name='Show now playing').click()
  expect(page.get_by_role('region', name='Now playing')).to_be_visible()
  shot(page, 'now-playing.png')
  page.get_by_role('region', name='Now playing').get_by_role('button', name='Lyrics', exact=True).click()
  expect(page.get_by_role('list', name='Synced lyrics')).to_be_visible()
  shot(page, 'lyrics.png')
  page.get_by_role('button', name='Back to player', exact=True).click()
  page.get_by_role('button', name='Discover similar tracks', exact=True).click()
  dialog = page.get_by_role('dialog', name='Sound discovery')
  expect(dialog.get_by_text('Audio sample comparison complete', exact=False)).to_be_visible()
  expect(dialog.get_by_text('Audio similarity', exact=True).first).to_be_visible()
  shot(page, 'sound-discovery.png')
  page.wait_for_timeout(900)
  dialog.get_by_role('button', name='Instant mix', exact=True).click()
  expect(dialog.get_by_role('button', name='Play (6)', exact=True)).to_be_visible()
  page.wait_for_timeout(900)
  dialog.get_by_role('button', name='Sound journey', exact=True).click()
  dialog.get_by_role('textbox', name='Choose where your journey ends').fill('Into the Quiet')
  dialog.get_by_role('button', name='Into the Quiet', exact=False).click()
  expect(dialog.get_by_text('Destination: Into the Quiet', exact=False)).to_be_visible()
  shot(page, 'sound-journey.png')
  page.wait_for_timeout(900)
  page.get_by_role('button', name='Close sound discovery', exact=True).click()
  page.get_by_role('button', name='Close now playing', exact=True).click()
  page.get_by_role('button', name='Sidewave Sessions', exact=True).click()
  expect(page.get_by_role('heading', name='Sidewave Sessions', exact=True)).to_be_visible()
  shot(page, 'sessions.png')
  page.wait_for_timeout(1000)
  page.get_by_role('button', name='Home', exact=True).first.click()
  page.wait_for_timeout(1200)
  video_path = page.video.path()
  context.close()
  mobile = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
  prepare(mobile)
  page = mobile.new_page()
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.goto(BASE)
  expect(page.get_by_role('heading', name='Welcome back, Anıl')).to_be_visible()
  shot(page, 'mobile-web.png')
  page.locator('.home-recent-grid article').first.get_by_role('button').first.click()
  expect(page.get_by_role('button', name='Show now playing')).to_be_enabled()
  page.wait_for_function('window.__presentationAudio.some(a=>a.duration > 100)')
  page.evaluate('window.__presentationAudio.forEach(a=>{if(a.duration>100){a.currentTime=39;a.pause()}})')
  page.get_by_role('button', name='Show now playing').click()
  expect(page.get_by_role('region', name='Now playing')).to_be_visible()
  shot(page, 'mobile-player.png')
  mobile.close()
  login = browser.new_context(viewport={'width':1440,'height':1080},device_scale_factor=1)
  prepare(login)
  login.route('**/api/auth/me',lambda r:r.fulfill(json={'user':None,'firstAccount':False}))
  page=login.new_page();page.goto(BASE)
  expect(page.get_by_role('heading',name='Welcome back.',exact=True)).to_be_visible()
  page.get_by_role('textbox',name='Username',exact=True).fill('Anıl')
  page.get_by_role('heading',name='Welcome back.',exact=True).click()
  shot(page,'login.png')
  page.get_by_role('button',name='Sign up',exact=True).click()
  expect(page.get_by_role('heading',name='Find your rhythm.',exact=True)).to_be_visible()
  shot(page,'signup.png')
  page.set_viewport_size({'width':390,'height':844})
  page.get_by_role('button',name='Sign in',exact=True).first.click()
  expect(page.get_by_role('heading',name='Welcome back.',exact=True)).to_be_visible()
  shot(page,'mobile-login.png')
  login.close();browser.close()
  report={'video':str(video_path),'pageErrors':errors,'externalRequests':network,'profile':'Anıl','background':'Midnight Coast','screenshots':sorted(p.name for p in OUT.glob('*.png'))}
  (WORK/'capture-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps(report,ensure_ascii=False))
  assert not errors and not network


if __name__ == "__main__":
 main()
