import {test, expect, type Page} from '@playwright/test';

const songs = Array.from({length: 40}, (_, i) => ({id: `online-${i}`, baslik: `Şarkı ${i}`, sanatci: `Sanatçı ${i % 7}`, sanatciId: `artist-${i % 7}`, kaynak: 'youtube', sure: 200 + i, albumId: 'album-1', album: 'Albüm'}));
const album = {id: 'album-1', ad: 'Albüm', sanatci: 'Sanatçı 1', parcalar: songs.slice(0, 5), kaynak: 'youtube'};

async function mock(page: Page, {resolve = 503}: {resolve?: number} = {}) {
  const calls = {resolve: 0, events: [] as string[], search: [] as string[]};
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === '/api/auth/me') return route.fulfill({json: {user: {id: 'test-member', username: 'Sidewave', owner: true}}});
    if (path === '/api/ara') { calls.search.push(url.searchParams.get('q') || ''); return route.fulfill({json: {parcalar: songs, albumler: [], sanatcilar: []}}); }
    if (path === '/api/v1/playback/resolve') { calls.resolve++; return route.fulfill(resolve === 200 ? {json: {url: '/missing-audio.mp3', delivery: 'online'}} : {status: 503, json: {code: 'SOURCE_UNAVAILABLE', message: 'Kaynak geçici olarak kullanılamıyor.', retryable: true}}); }
    if (path === '/api/v1/events') { calls.events.push(route.request().postDataJSON()?.event); return route.fulfill({status: 201, json: {id: 'e'}}); }
    if (path.startsWith('/api/yt/album/')) return route.fulfill({json: album});
    if (path === '/api/v1/devices') return route.fulfill({json: {devices: [], activeDeviceId: null}});
    if (path === '/api/listeler') return route.fulfill({json: {listeler: [{id: 'list-1', ad: 'Yolculuk', parcaSayisi: 1}]}});
    return route.fulfill({json: {parcalar: [], albumler: [], sanatcilar: [], listeler: [], jobs: [], indirmeler: [], devices: []}});
  });
  return calls;
}
const search = (page: Page) => page.getByRole('combobox', {name: 'Search songs, albums or artists'});

test('a search is a history entry: Back from an opened artist returns to the same results and scroll position', async ({page}) => {
  const calls = await mock(page); await page.goto('/');
  await search(page).fill('gece');
  await expect(page).toHaveURL(/#\/search\/gece$/);
  await page.getByRole('button', {name: 'Songs', exact: true}).click();
  await expect(page.getByRole('group', {name: 'Şarkı 39', exact: true})).toBeAttached();
  await page.locator('.content-scroll').evaluate(el => { el.scrollTop = 900; });
  await page.waitForTimeout(100);
  await page.getByRole('group', {name: 'Şarkı 20', exact: true}).getByRole('button', {name: 'Sanatçı 6'}).click();
  await expect(page).toHaveURL(/#\/artist\/artist-6$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/search\/gece$/);
  await expect(search(page)).toHaveValue('gece');
  await expect(page.getByRole('group', {name: 'Şarkı 0', exact: true})).toBeAttached();
  await expect.poll(() => page.locator('.content-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(800);
  expect(calls.search.filter(q => q === 'gece')).toHaveLength(1);
  // Leaving the results through a result remembers the query; partial typing alone does not.
  await search(page).fill(''); await search(page).focus();
  await expect(page.getByRole('listbox', {name: 'Recent searches'}).getByRole('option')).toHaveText(['gece']);
});

test('Space on a focused track row starts that song instead of cancelling it', async ({page}) => {
  const calls = await mock(page, {resolve: 200}); await page.goto('/');
  await search(page).fill('gece');
  const row = page.getByRole('group', {name: 'Şarkı 0', exact: true}); await row.focus();
  await page.keyboard.press('Space'); await page.waitForTimeout(400);
  // One attempt was started and never paused (the player's single source retry may resolve again).
  expect(calls.events.filter(e => e === 'started')).toHaveLength(1);
  expect(calls.events).not.toContain('paused');
  expect(calls.events).not.toContain('cancelled');
  await expect(page.getByRole('button', {name: 'Show now playing'})).toBeEnabled();
});

test('every track menu offers Play next and Add to queue with a confirmation', async ({page}) => {
  await mock(page); await page.goto('/');
  await search(page).fill('gece');
  const row = page.getByRole('group', {name: 'Şarkı 1', exact: true});
  await row.getByRole('button', {name: 'More options for Şarkı 1'}).click();
  const menu = page.getByRole('menu', {name: 'Şarkı 1 options'});
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await menu.getByRole('menuitem', {name: 'Add to queue'}).click();
  await expect(page.getByRole('status').getByText('Added to queue.')).toBeVisible();
  await page.getByRole('button', {name: 'Queue'}).click();
  await expect(page.getByRole('region', {name: 'Play queue'}).getByRole('button', {name: /Play Şarkı 1/})).toBeVisible();
});

test('volume and mute are reachable on a laptop-width window; shortcuts are discoverable', async ({page, isMobile}) => {
  test.skip(isMobile, 'Desktop layout');
  await page.setViewportSize({width: 1100, height: 800}); await mock(page); await page.goto('/');
  await expect(page.getByRole('slider', {name: 'Volume'})).toBeVisible();
  await page.getByRole('button', {name: 'Mute'}).click();
  await expect(page.getByRole('button', {name: 'Unmute'})).toBeVisible();
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', {name: 'Keyboard shortcuts'})).toBeVisible();
});

test('closing Now Playing returns to the same page and scroll position', async ({page}) => {
  await mock(page); await page.goto('/');
  await search(page).fill('gece'); await page.getByRole('button', {name: 'Songs', exact: true}).click();
  await page.getByRole('group', {name: 'Şarkı 3', exact: true}).getByText('Şarkı 3', {exact: true}).click();
  await page.locator('.content-scroll').evaluate(el => { el.scrollTop = 700; });
  await page.getByRole('button', {name: 'Show now playing'}).click();
  await expect(page.getByRole('region', {name: 'Now playing'})).toBeVisible();
  await page.getByRole('button', {name: 'Close now playing'}).click();
  await expect(page.getByRole('region', {name: 'Now playing'})).toHaveCount(0);
  expect(await page.locator('.content-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(600);
});
