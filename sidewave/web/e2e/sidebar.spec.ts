import { test, expect, type Page } from '@playwright/test';

const history = [
  {id:'video000001', baslik:'First song', album:'Evening Sessions', albumId:'same-id', sanatci:'Artist A', kaynak:'youtube'},
  {id:'video000002', baslik:'Second song', album:'Evening Sessions', albumId:'same-id', sanatci:'Artist A', kaynak:'youtube'},
  {id:'local-1', baslik:'Archive song', album:'Archive Album', albumId:'same-id', sanatci:'Artist B', kaynak:'kutuphane'},
  {id:'unknown', baslik:'No album metadata', sanatci:'Artist C', kaynak:'youtube'},
];
async function setup(page: Page, isMobile: boolean) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const routes: Record<string, unknown> = {
      "/api/auth/me": {user:{id:"test-member",username:"Sidewave"}},
      '/api/v1/history': {parcalar:history},
      '/api/listeler': {listeler:[{id:'playlist-1', ad:'Night Drive', parcaSayisi:12}]},
      '/api/liste/playlist-1': {id:'playlist-1', ad:'Night Drive', parcalar:[]},
      '/api/yt/album/same-id': {id:'same-id', ad:'Evening Sessions', parcalar:[]},
      '/api/library/album/same-id': {id:'same-id', ad:'Archive Album', parcalar:[]},
    };
    return route.fulfill({json:routes[path] || {albumler:[],sanatcilar:[],listeler:[],jobs:[],indirmeler:[],parcalar:[],devices:[],activeDeviceId:null}});
  });
  await page.goto('/');
  if (isMobile) await page.getByRole('button', {name:'Open library',exact:true}).click();
}

test('sidebar shows deduplicated recent albums and direct playlists with correct destinations', async ({page,isMobile}) => {
  await setup(page,isMobile);
  const sidebar = page.getByRole('complementary');
  await expect(sidebar.getByRole('heading',{name:'Recently played albums'})).toBeVisible();
  await expect(sidebar.getByRole('button',{name:/Evening Sessions/})).toHaveCount(1);
  await expect(sidebar.getByRole('button',{name:/Archive Album/})).toHaveCount(1);
  await expect(sidebar.getByText('No album metadata')).toHaveCount(0);
  await expect(sidebar.getByText('Your library',{exact:true})).toHaveCount(0);
  await expect(sidebar.getByRole('textbox')).toHaveCount(0);
  await sidebar.getByRole('button',{name:/Evening Sessions/}).click();
  await expect(page).toHaveURL(/#\/album\/online\/same-id$/);
  if (isMobile) await page.getByRole('button', {name:'Open library',exact:true}).click();
  await sidebar.getByRole('button',{name:/Archive Album/}).click();
  await expect(page).toHaveURL(/#\/album\/library\/same-id$/);
  if (isMobile) await page.getByRole('button', {name:'Open library',exact:true}).click();
  await sidebar.getByRole('button',{name:/Night Drive/}).click();
  await expect(page).toHaveURL(/#\/playlist\/playlist-1$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('sidebar keeps create and import reachable on a narrow screen', async ({page,isMobile}) => {
  await setup(page,isMobile);
  await page.setViewportSize({width:320,height:740});
  if (!isMobile) await page.getByRole('button',{name:'Open library',exact:true}).click();
  const sidebar = page.getByRole('complementary');
  await sidebar.getByRole('button',{name:'New playlist',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'New playlist'})).toBeVisible();
  await page.keyboard.press('Escape');
  await sidebar.getByRole('button',{name:'Import playlist',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await sidebar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('recent recordings load their own artwork when metadata has no cover URL', async ({page,isMobile}) => {
  await setup(page,isMobile);
  await page.route('**/api/yt/kapak?*', route => route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=','base64')}));
  await page.reload();
  const covers = page.locator('.home-recent-grid img[src*="yt/kapak"]');
  await expect(covers).toHaveCount(2);
  await expect.poll(()=>covers.evaluateAll(images=>images.every(img=>(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  if(isMobile)await page.getByRole('button',{name:'Open library',exact:true}).click();
  await expect(page.getByRole('complementary').getByRole('button',{name:'Sidewave home',exact:true})).toBeVisible();
});
