import {test, expect, type Page} from '@playwright/test';

const track = (id: string) => ({id, appId: 'app-' + id, baslik: 'Şarkı ' + id, sanatci: 'Sanatçı', kaynak: 'youtube', sure: 200});
async function mock(page: Page) {
  const calls: {path: string; method: string; body: unknown}[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, json = (b: unknown, status = 200) => route.fulfill({status, json: b});
    calls.push({path, method: req.method(), body: req.postDataJSON?.() ?? null});
    if (path === '/api/auth/me') return json({user: {id: 'g', username: 'Guest', owner: false}});
    if (path === '/api/v1/shared/tok_abcdefghijklmnopqrstu') return json({id: 'pl', ad: 'Yaz', parcalar: [track('a'), track('b')].map((t, i) => ({...t, entryId: 'e' + i})), token: 'tok_abcdefghijklmnopqrstu', mode: 'edit', owner: 'Anıl', mine: false, following: false});
    if (path.endsWith('/follow')) return json({following: true});
    if (path === '/api/v1/shared') return json({listeler: []});
    if (path === '/api/liste/mine') return json({id: 'mine', ad: 'Mine', parcalar: ['a', 'b', 'c'].map((id, i) => ({...track(id), entryId: 'm' + i}))});
    if (path === '/api/listeler') return json({listeler: [{id: 'mine', ad: 'Mine', parcaSayisi: 3}], begeniSayisi: 0});
    if (path === '/api/v1/playlists/mine/share' && req.method() === 'POST') return json({token: 'tok_new', mode: 'view', url: 'https://music.example.com/#/shared/tok_new'});
    if (path === '/api/v1/playlists/mine/share') return json({links: []});
    return json({parcalar: [], albumler: [], sanatcilar: [], listeler: [], jobs: [], indirmeler: [], devices: [], ok: true});
  });
  return calls;
}

test('a collaborative link opens the shared playlist, can be followed and lets collaborators remove songs', async ({page}) => {
  const calls = await mock(page); await page.goto('/#/shared/tok_abcdefghijklmnopqrstu');
  await expect(page.getByRole('heading', {name: 'Yaz', level: 1})).toBeVisible();
  await expect(page.getByText('by Anıl', {exact: false})).toBeVisible();
  await page.getByRole('button', {name: 'Add to Your Library'}).click();
  await expect(page.getByRole('button', {name: 'In Your Library'})).toBeVisible();
  await page.getByRole('button', {name: 'Remove Şarkı a from playlist'}).click();
  await expect.poll(() => calls.some(c => c.path.endsWith('/tracks') && c.method === 'DELETE')).toBe(true);
});

test('playlist rows reorder with the keyboard handle and the owner can create a share link', async ({page}) => {
  const calls = await mock(page); await page.goto('/#/playlist/mine');
  await page.getByRole('button', {name: 'Reorder Şarkı a'}).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => (calls.find(c => c.path === '/api/liste/mine' && c.method === 'PATCH')?.body as {entryIds?: string[]})?.entryIds).toEqual(['m1', 'm0', 'm2']);
  await page.getByRole('button', {name: 'Share', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Share playlist'});
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await dialog.getByRole('button', {name: 'Create link'}).first().click();
  await expect(dialog.getByText('https://music.example.com/#/shared/tok_new')).toBeVisible();
});
