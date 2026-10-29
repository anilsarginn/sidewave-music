import {test, expect, type Page} from '@playwright/test';

const track = (id: string, artist = 'Mabel Matiz') => ({id, appId: 'app-' + id, baslik: 'Şarkı ' + id, sanatci: artist, kaynak: 'youtube', sure: 200, kapakUrl: 'https://i.ytimg.com/vi/x/hq.jpg'});
async function mock(page: Page) {
  const added: unknown[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const json = (body: unknown) => route.fulfill({json: body});
    if (path === '/api/auth/me') return json({user: {id: 'm', username: 'Anıl', owner: true}});
    if (path === '/api/listeler') return json({begeniSayisi: 42, listeler: [{id: 'road', ad: 'Road Trip', parcaSayisi: 12, kapaklar: [track('a'), track('b'), track('c'), track('d')]}, {id: 'calm', ad: 'Calm', parcaSayisi: 3, kapaklar: [track('e')]}]});
    if (path === '/api/v1/library') return json({albumler: [{id: 'alb', ad: 'Gece', sanatci: 'Mabel Matiz', kaynak: 'youtube'}], sanatcilar: [{id: 'art', ad: 'Teoman', kaynak: 'youtube'}]});
    if (path === '/api/v1/mixes') return json({day: '2026-10-26', mixes: [{id: 'mix-1', ad: 'Daily Mix 1', altyazi: 'Mabel Matiz, Teoman and more', renk: '#e8115b', kapak: track('a'), parcaSayisi: 3}]});
    if (path === '/api/v1/mixes/mix-1') return json({id: 'mix-1', ad: 'Daily Mix 1', altyazi: 'Mabel Matiz, Teoman and more', renk: '#e8115b', parcaSayisi: 3, parcalar: [track('a'), track('t', 'Teoman'), track('b')]});
    if (path === '/api/v1/collections') return json({listeler: [{id: 'jazz', ad: 'Late Jazz', tur: 'Jazz', renk: '#1e3264', owner: 'Sidewave', editable: false}]});
    if (path === '/api/liste/road') return json({id: 'road', ad: 'Road Trip', parcalar: [track('a'), track('b')].map((t, i) => ({...t, entryId: 'e' + i}))});
    if (path === '/api/v1/playlists/road/recommendations') return json({parcalar: [track('r1', 'Duman'), track('r2', 'Gripin')]});
    if (path === '/api/liste/road/ekle') { added.push(route.request().postDataJSON()); return json({ok: true}); }
    return json({parcalar: [], albumler: [], sanatcilar: [], listeler: [], jobs: [], indirmeler: [], devices: [], sections: {}});
  });
  return {added};
}

test('Your Library lists liked songs, playlists with mosaics, albums and artists, with filters and views', async ({page}) => {
  await mock(page); await page.goto('/#/library');
  const library = page.getByRole('region', {name: 'Your Library'});
  await expect(library.getByRole('button', {name: /^Liked Songs, Playlist · 42 songs/})).toBeVisible();
  await expect(library.getByRole('button', {name: /^Road Trip/}).locator('.playlist-mosaic')).toBeVisible();
  await expect(library.getByRole('button', {name: /^Teoman, Artist/})).toBeVisible();
  await library.getByRole('button', {name: 'Artists', exact: true}).click();
  await expect(library.getByRole('button', {name: /^Road Trip/})).toHaveCount(0);
  await expect(library.getByRole('button', {name: /^Teoman, Artist/})).toBeVisible();
  await library.getByRole('button', {name: 'All', exact: true}).click();
  await library.getByRole('textbox', {name: 'Search in Your Library'}).fill('calm');
  await expect(library.getByRole('button', {name: /^Calm/})).toBeVisible();
  await expect(library.getByRole('button', {name: /^Road Trip/})).toHaveCount(0);
  await library.getByRole('button', {name: 'Grid view'}).click();
  await expect(library.locator('.library-grid')).toBeVisible();
  await page.reload(); await expect(page.getByRole('region', {name: 'Your Library'}).locator('.library-grid')).toBeVisible();
});

test('Search with an empty box shows Browse; clearing a query returns to it', async ({page}) => {
  await mock(page); await page.goto('/#/search');
  await expect(page.getByRole('heading', {name: 'Browse all'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Daily Mix 1'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Jazz'})).toBeVisible();
  await page.getByRole('button', {name: 'Daily Mix 1'}).click();
  await expect(page).toHaveURL(/#\/mix\/mix-1$/);
  await expect(page.getByRole('heading', {name: 'Daily Mix 1', level: 1})).toBeVisible();
  await expect(page.getByRole('group', {name: 'Şarkı t', exact: true})).toBeVisible();
});

test('home shows daily mixes and a playlist offers one-tap recommended songs', async ({page}) => {
  const {added} = await mock(page); await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Your daily mixes'})).toBeVisible();
  await page.goto('/#/playlist/road');
  const recs = page.getByRole('region', {name: 'Recommended'});
  await expect(recs.getByRole('button', {name: 'Play Şarkı r1'})).toBeVisible();
  await recs.getByRole('listitem').filter({hasText: 'Şarkı r1'}).getByRole('button', {name: 'Add'}).click();
  await expect(page.getByText('Added “Şarkı r1”.')).toBeVisible();
  expect(added).toHaveLength(1);
  await expect(recs.getByRole('button', {name: 'Play Şarkı r1'})).toHaveCount(0);
});
