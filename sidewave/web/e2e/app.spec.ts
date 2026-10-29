import {test, expect, type Page} from '@playwright/test';
const song = {id: 'online-1', baslik: 'Test Şarkısı', sanatci: 'Test Artist', kaynak: 'youtube', sure: 183};
async function mock(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const routes: Record<string, unknown> = {
      "/api/auth/me": {user:{id:"test-member",username:"Sidewave",owner:true}},
      "/api/v1/home/intro": {kind:"greeting",period:"test",greeting:"Good morning"},
      '/api/status': {navidrome: true, ytres: true},
      '/api/kesfet': {albumler: [], trendSanatcilar: [], trendParcalar: []},
      '/api/library/artists': {sanatcilar: []}, '/api/listeler': {listeler: [{id: 'list-1', ad: 'Yolculuk', parcaSayisi: 1}]},
      '/api/indirmeler': {indirmeler: []}, '/api/v1/archive/jobs': {jobs: []}, '/api/v1/history': {parcalar: [song]},
      '/api/v1/recommendations': {parcalar: [song]}, '/api/v1/devices': {devices: [], activeDeviceId: null},
      '/api/ara': {parcalar: [song], albumler: [], sanatcilar: []}, '/api/favoriler': {parcalar: [{...song, favori: true}], albumler: []},
      '/api/v1/import/preview': {rows: [{index: 0, baslik: song.baslik, sanatci: song.sanatci, status: 'matched', candidates: [song], selected: song}], duplicates: 0},
      '/api/v1/import/commit': {id: 'list-1'}, '/api/liste/list-1': {id: 'list-1', ad: 'Yolculuk', parcalar: [{...song, entryId: 'entry-1'}]},
    };
    if (path === '/api/v1/playback/resolve') return route.fulfill({status: 503, json: {code: 'SOURCE_UNAVAILABLE', message: 'Kaynak geçici olarak kullanılamıyor.', retryable: true}});
    return route.fulfill({json: routes[path] || {ok: true}});
  });
}
test('search, online favorites, and explicit playback error actions', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await mock(page); await page.goto('/');
  await expect(page.getByRole('heading',{name:'Welcome back, Sidewave'})).toBeVisible();
  await page.getByRole('combobox', {name: 'Search songs, albums or artists'}).fill('Test');
  await expect(page.getByRole('heading', {name: 'Search results'})).toBeVisible();
  const row = page.getByRole('group', {name: song.baslik}); await expect(row).toBeVisible();
  const favorite = page.waitForRequest(req => req.url().endsWith('/api/favori') && req.method() === 'POST');
  await row.getByTitle('like').click(); expect((await favorite).postDataJSON()).toMatchObject({parca: {id: song.id, kaynak: 'youtube'}, favori: true});
  await row.getByText(song.baslik, {exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Kaynak geçici olarak kullanılamıyor.');
  await expect(page.getByRole('button', {name: 'Try again'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Skip track'})).toBeVisible();
  expect(errors).toEqual([]);
});
test('import previews matches before committing a mixed-source playlist', async ({page, isMobile}) => {
  await mock(page); await page.goto('/');
  if (isMobile) await page.getByRole('button', {name: 'Open library', exact: true}).click();
  await page.getByRole('button', {name: 'Import playlist'}).click();
  const dialog = page.getByRole('dialog', {name: 'Import playlist'});
  await dialog.getByRole('textbox', {name: 'Songs to import'}).fill('Test Artist - Test Şarkısı');
  await dialog.getByRole('button', {name: 'Review matches'}).click();
  await expect(dialog.getByText('1 selected · 0 duplicates · 0 unselected')).toBeVisible();
  const committed = page.waitForRequest(req => req.url().endsWith('/api/v1/import/commit'));
  await dialog.getByRole('button', {name: 'Save playlist'}).click(); expect((await committed).postDataJSON().parcalar[0].kaynak).toBe('youtube');
  await expect(page.getByRole('heading', {name: 'Yolculuk'})).toBeVisible();
});
test('Spotify Free export upload reviews ambiguity, persists the job and commits favorites with playlists', async ({page,isMobile}) => {
  await mock(page);
  const selected={...song,album:'Test Album'};
  const job={id:'spotify-job',label:'My Spotify account',state:'ready',createdAt:Date.now(),warnings:[],hasLibrary:true,hasPlaylists:true,
    collections:[{id:'c1',name:'Akşam',kind:'playlist',total:2,pending:0,selected:1},{id:'c2',name:'Liked Songs',kind:'favorites',total:1,pending:0,selected:1}],
    counts:{total:3,pending:0,selected:2,unsupported:0,ambiguous:1,unmatched:0,errors:0},lastCommit:null as null|{added:number;favorites:number;playlists:unknown[];at:number}};
  let uploaded=false,chosen=false;
  await page.route('**/api/v1/import/spotify/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/upload')){uploaded=true;expect(route.request().headers()['content-type']).toBe('application/json');return route.fulfill({status:202,json:job})}
    if(path.endsWith('/jobs'))return route.fulfill({json:{jobs:uploaded?[job]:[]}});
    if(path.endsWith('/rows/row-2')){expect(route.request().postDataJSON()).toEqual({candidate:'youtube:online-1'});chosen=true;job.counts.selected=3;return route.fulfill({json:job})}
    if(path.endsWith('/rows'))return route.fulfill({json:{total:2,nextOffset:null,items:[{...selected,id:'row-1',collectionId:'c1',position:0,status:'matched',candidates:[selected],selected},{...selected,id:'row-2',collectionId:'c1',position:1,status:'ambiguous',candidates:[selected],selected:chosen?selected:null}]}});
    if(path.endsWith('/commit')){expect(chosen).toBe(true);job.state='committed';job.lastCommit={added:2,favorites:1,playlists:[{id:'list-1',name:'Akşam'}],at:Date.now()};return route.fulfill({json:job})}
    return route.fulfill({json:job});
  });
  await page.goto('/');if(isMobile)await page.getByRole('button',{name:'Open library',exact:true}).click();
  await page.getByRole('button',{name:'Import playlist'}).click();await page.getByRole('button',{name:'Import from Spotify'}).click();
  const dialog=page.getByRole('dialog',{name:'Import your Spotify library'});
  await expect(dialog.getByText('Works with Spotify Free')).toBeVisible();
  await dialog.getByLabel('Spotify data file').setInputFiles({name:'YourLibrary.json',mimeType:'application/json',buffer:Buffer.from('{"tracks":[]}')});
  await expect(dialog.getByText('2 liste', {exact:false})).not.toBeVisible();
  const choices=dialog.getByRole('combobox',{name:'Test Şarkısı Spotify match'});await expect(choices).toHaveCount(2);await choices.last().selectOption('youtube:online-1');
  await dialog.getByRole('button',{name:'Save selected'}).click();await expect(dialog.getByText('2 playlist entries added · 1 new likes')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Import playlist'}).click();await page.getByRole('button',{name:'Import from Spotify'}).click();
  await expect(page.getByRole('button',{name:/My Spotify account.*3 tracks/})).toBeVisible();
});
test('renders player and responsive navigation without horizontal overflow', async ({page, isMobile}) => {
  await mock(page); await page.goto('/'); await expect(page.getByRole('heading',{name:'Recently played',exact:true})).toBeVisible();
  if (isMobile) await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `test-results/${isMobile ? 'mobile' : 'desktop'}-home.png`, fullPage: true});
});
test('Exportify CSV is uploaded with its filename and liked songs require an explicit file choice',async({page,isMobile})=>{
 await mock(page);
 const job={id:'csv-job',label:'My Spotify account',state:'ready',createdAt:Date.now(),warnings:[],hasLibrary:false,hasPlaylists:true,
  collections:[{id:'csv-likes',name:'liked_songs',kind:'playlist',canBeFavorites:true,total:1,pending:0,selected:1}],counts:{total:1,pending:0,selected:1,unsupported:0,ambiguous:0,unmatched:0,errors:0},lastCommit:null};
 let selected=false;
 await page.route('**/api/v1/import/spotify/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/jobs'))return route.fulfill({json:{jobs:[]}});
  if(url.pathname.endsWith('/upload')){expect(route.request().headers()['content-type']).toBe('text/csv');expect(url.searchParams.get('fileName')).toBe('liked_songs.csv');return route.fulfill({status:202,json:job})}
  if(url.pathname.endsWith('/favorites-file')){expect(route.request().postDataJSON()).toEqual({collectionId:'csv-likes'});selected=true;job.collections[0].kind='favorites';job.hasLibrary=true;return route.fulfill({json:job})}
  if(url.pathname.endsWith('/rows'))return route.fulfill({json:{items:[{...song,id:'csv-row',collectionId:'csv-likes',position:0,status:'matched',candidates:[song],selected:song,applied:false}],total:1,nextOffset:null}});
  return route.fulfill({json:job});
 });
 await page.goto('/');if(isMobile)await page.getByRole('button',{name:'Open library',exact:true}).click();await page.getByRole('button',{name:'Import playlist'}).click();await page.getByRole('button',{name:'Import from Spotify'}).click();
 const dialog=page.getByRole('dialog',{name:'Import your Spotify library'});await expect(dialog.getByRole('link',{name:'Open Exportify'})).toHaveAttribute('href','https://exportify.app/');
 await dialog.getByLabel('Spotify data file').setInputFiles({name:'liked_songs.csv',mimeType:'text/csv',buffer:Buffer.from('Track URI,Track Name,Artist Name(s)\nspotify:track:1,Test Şarkısı,Test Artist')});
 const choice=dialog.getByRole('combobox',{name:'Liked songs CSV'});await expect(choice).toHaveValue('');await choice.selectOption('csv-likes');await expect(choice).toHaveValue('csv-likes');expect(selected).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a partial source failure retains results and explains the unavailable source', async ({page}) => {
  await mock(page);
  await page.route('**/api/ara?*', route => route.fulfill({json: {parcalar: [song], hata: {kutuphane: 'The library is unavailable.'}}}));
  await page.goto('/'); await page.getByRole('combobox', {name: 'Search songs, albums or artists'}).fill('test');
  await expect(page.getByRole('alert')).toContainText('The library is unavailable.');
  await expect(page.getByRole('group', {name: song.baslik})).toBeVisible();
  await expect(page.getByText('No results found.')).not.toBeVisible();
});
test('archive candidate selection never reports the download as ready', async ({page}) => {
  await mock(page);
  await page.route('**/api/v1/archive/jobs', route => route.fulfill({json: {jobs: [{id: 'job-1', durum: 'eslesme_bekliyor', parca: song, candidates: [{candidateId: 'candidate-1', dosyaAdi: 'Test Şarkısı.flac', bicim: 'flac', sure: 183}]}]}}));
  await page.goto('/'); await page.getByRole('button', {name:'Profile',exact:true}).click();await page.getByRole('menuitem', {name:'Downloads',exact:true}).click();
  await expect(page.getByText('Choose your match')).toBeVisible();
  const selection = page.waitForRequest(req => req.url().endsWith('/api/v1/archive/jobs/job-1/select'));
  await page.getByRole('button', {name: /Test Şarkısı.flac/}).click();
  expect((await selection).postDataJSON()).toEqual({candidateId: 'candidate-1'});
  await expect(page.getByText('Starting download')).toBeVisible();
  await expect(page.getByText('Ready in your library', {exact: true})).not.toBeVisible();
});

test('asynchronous import shows progress and waits for matching before commit', async ({page, isMobile}) => {
  await mock(page);
  const row = {index: 0, baslik: song.baslik, sanatci: song.sanatci, status: 'pending', candidates: [], selected: null};
  await page.route('**/api/v1/import/preview', route => route.fulfill({status: 202, json: {jobId: 'preview-1', rows: [row], duplicates: 0, pending: true, completed: 0, total: 1}}));
  await page.route('**/api/v1/import/preview/preview-1', route => route.fulfill({json: {jobId: 'preview-1', rows: [{...row, status: 'matched', candidates: [song], selected: song}], duplicates: 0, pending: false, completed: 1, total: 1}}));
  await page.goto('/'); if (isMobile) await page.getByRole('button', {name: 'Open library', exact: true}).click();
  await page.getByRole('button', {name: 'Import playlist'}).click(); const dialog = page.getByRole('dialog', {name: 'Import playlist'});
  await dialog.getByRole('textbox', {name: 'Songs to import'}).fill('Test Artist - Test Şarkısı');
  await dialog.getByRole('button', {name: 'Review matches'}).click();
  await expect(dialog.getByRole('status')).toContainText('0/1');
  await expect(dialog.getByRole('button', {name: 'Save playlist'})).toBeDisabled();
  await expect(dialog.getByRole('button', {name: 'Save playlist'})).toBeEnabled();
  await expect(dialog.getByRole('combobox')).toHaveValue('youtube:online-1');
});

test('search categories keep songs prominent and filter album and artist results', async ({page}) => {
  await mock(page);
  await page.route('**/api/ara?*', route => route.fulfill({json: {parcalar: [song], albumler: [{id: 'album-one', ad: 'Gece Album', sanatci: 'Test Artist', kaynak: 'youtube'}], sanatcilar: [{id: 'artist-one', ad: 'Deneme Artist', kaynak: 'youtube'}], hata: {}}}));
  await page.goto('/'); await page.getByRole('combobox', {name: 'Search songs, albums or artists'}).fill('Gece');
  const row = page.getByRole('group', {name: song.baslik}); await expect(row).toBeVisible();
  const categories = page.getByLabel('Search categories');
  await categories.getByRole('button', {name: 'Albums', exact: true}).click();
  await expect(row).not.toBeVisible(); await expect(page.getByRole('button', {name: /Gece Album/})).toBeVisible();
  await categories.getByRole('button', {name: 'Artists', exact: true}).click();
  await expect(page.getByRole('button', {name: /Deneme Artist/})).toBeVisible();
  await expect(page.getByRole('button', {name: /Gece Album/})).not.toBeVisible();
  await categories.getByRole('button', {name: 'Songs', exact: true}).click(); await expect(row).toBeVisible();
  await page.getByRole('button', {name: 'Clear search'}).click(); await expect(page.getByRole('heading',{name:'Browse all'})).toBeVisible();
});

test('native playlist creation focuses input, cancels cleanly, and submits the chosen name', async ({page, isMobile}) => {
  await mock(page); await page.route('**/api/liste', route => route.fulfill({status: 201, json: {id: 'list-1'}}));
  await page.goto('/'); if(isMobile) await page.getByRole('button', {name: 'Open library', exact: true}).click();
  const create = page.getByRole('button', {name: 'New playlist', exact: true}); await create.click();
  const dialog = page.getByRole('dialog', {name: 'New playlist', exact: true});
  await expect(dialog.getByLabel('Playlist name')).toBeFocused(); await expect(dialog.getByRole('button', {name: 'Create playlist', exact: true})).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(create).toBeFocused();
  await create.click(); await dialog.getByLabel('Playlist name').fill('Akşam yürüyüşü');
  const request = page.waitForRequest(r => new URL(r.url()).pathname === '/api/liste' && r.method() === 'POST');
  await dialog.getByRole('button', {name: 'Create playlist', exact: true}).click(); expect((await request).postDataJSON()).toEqual({ad: 'Akşam yürüyüşü'});
  await expect(page.getByRole('heading', {name: 'Yolculuk', exact: true})).toBeVisible();
});

test('exact artist names appear before songs and distinct channels remain separate', async ({page}) => {
  await mock(page);
  const artists = [
    {id: 'channel-one', ad: 'PeopleAround', kaynak: 'youtube'},
    {id: 'channel-two', ad: 'People Around', kaynak: 'youtube'},
    {id: 'channel-three', ad: 'People Around Trio', kaynak: 'youtube'},
  ];
  await page.route('**/api/ara?*', route => route.fulfill({json: {parcalar: Array.from({length: 12}, (_, i) => ({...song, id: 'song-' + i, baslik: 'Sonuç ' + i})), albumler: [], sanatcilar: artists, hata: {}}}));
  await page.route('**/api/yt/sanatci/channel-two', route => route.fulfill({json: {id: 'channel-two', ad: 'People Around', albumler: [], enCokDinlenen: []}}));
  await page.goto('/'); await page.getByRole('combobox', {name: 'Search songs, albums or artists'}).fill('peoplearound');
  const matches = page.getByRole('region', {name: 'Matching artists'});
  const first = matches.getByRole('button', {name: 'PeopleAround · Artist', exact: true});
  const second = matches.getByRole('button', {name: 'People Around · Artist', exact: true});
  await expect(first).toBeInViewport(); await expect(second).toBeVisible();
  await expect(page.getByText('PeopleAround', {exact: true})).toHaveCount(1);
  await expect(page.getByText('People Around', {exact: true})).toHaveCount(1);
  await expect(page.getByRole('button', {name: /People Around Trio/})).toBeVisible();
  const artistBox = await first.boundingBox(); const songBox = await page.getByRole('group', {name: 'Sonuç 0', exact: true}).boundingBox();
  expect(artistBox!.y).toBeLessThan(songBox!.y);
  const requested = page.waitForRequest(r => new URL(r.url()).pathname === '/api/yt/sanatci/channel-two');
  await second.click(); expect((await requested).url()).toContain('/channel-two');
  await expect(page.getByRole('heading', {name: 'People Around', exact: true})).toBeVisible();
});

test('new and cleared searches reset the category and return to the top', async ({page}) => {
  await mock(page);
  await page.route('**/api/ara?*', route => route.fulfill({json: {parcalar: Array.from({length: 20}, (_, i) => ({...song, id: 'song-' + i, baslik: 'Sonuç ' + i})), albumler: [], sanatcilar: [{id: 'channel-one', ad: 'People Around', kaynak: 'youtube'}], hata: {}}}));
  await page.goto('/'); const input = page.getByRole('combobox', {name: 'Search songs, albums or artists'});
  const categories = page.getByLabel('Search categories');
  await input.fill('eski arama'); await expect(page.getByRole('group', {name: 'Sonuç 0', exact: true})).toBeVisible();
  await categories.getByRole('button', {name: 'Songs', exact: true}).click();
  await page.locator('.content-scroll').evaluate(el => { el.scrollTop = 800; });
  await input.fill('peoplearound');
  await expect(categories.getByRole('button', {name: 'All', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'People Around · Artist', exact: true})).toBeInViewport();
  expect(await page.locator('.content-scroll').evaluate(el => el.scrollTop)).toBe(0);
  await categories.getByRole('button', {name: 'Albums', exact: true}).click();
  await page.getByRole('button', {name: 'Clear search'}).click();
  await input.fill('PeopleAround');
  await expect(categories.getByRole('button', {name: 'All', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'People Around · Artist', exact: true})).toBeVisible();
});

test('a filter chosen while results are loading remains selected', async ({page}) => {
  await mock(page);
  await page.route('**/api/ara?*', async route => { await new Promise(resolve => setTimeout(resolve, 600)); await route.fulfill({json: {parcalar: [song], albumler: [], sanatcilar: [{id: 'channel-one', ad: 'People Around', kaynak: 'youtube'}], hata: {}}}); });
  await page.goto('/'); await page.getByRole('combobox', {name: 'Search songs, albums or artists'}).fill('peoplearound');
  const artists = page.getByLabel('Search categories').getByRole('button', {name: 'Artists', exact: true});
  await expect(page.getByRole('status', {name: 'Loading search results'})).toBeVisible();
  await artists.click(); await expect(page.getByRole('button', {name: 'People Around Artist', exact: true})).toBeVisible();
  await expect(artists).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', {name: song.baslik})).not.toBeVisible();
});

test('an empty category points to available results in other categories', async ({page}) => {
  await mock(page);
  await page.route('**/api/ara?*', route => route.fulfill({json: {parcalar: [], albumler: [], sanatcilar: [{id: 'channel-one', ad: 'People Around', kaynak: 'youtube'}], hata: {}}}));
  await page.goto('/'); await page.getByRole('combobox', {name: 'Search songs, albums or artists'}).fill('peoplearound');
  await expect(page.getByRole('button', {name: 'People Around · Artist', exact: true})).toBeVisible();
  await page.getByLabel('Search categories').getByRole('button', {name: 'Songs', exact: true}).click();
  await expect(page.getByText('No results in this category.', {exact: true})).toBeVisible();
  await expect(page.getByText('Try a song, an artist or a different spelling.')).not.toBeVisible();
  await page.getByRole('button', {name: 'Show all results', exact: true}).click();
  await expect(page.getByRole('button', {name: 'People Around · Artist', exact: true})).toBeVisible();
});

test('artist deep links survive reload and browser history; follow stays in the library', async ({page, isMobile}) => {
  await mock(page);
  let followed=false;
  const artist=()=>({id:'channel-a',appId:'artist-canonical',ad:'People Around',kaynak:'youtube',takip:followed,biyografi:'Gerçek sanatçı biyografisi.',enCokDinlenen:[{...song,sanatciId:'channel-a',sanatci:'People Around'}],albumler:[{id:'single-a',appId:'release-a',ad:'Bliss',tur:'single',yil:2024,kaynak:'youtube'},{id:'album-a',appId:'release-b',ad:'Album',tur:'album',yil:2022,kaynak:'youtube'}]});
  await page.route('**/api/yt/sanatci/channel-a', route=>route.fulfill({json:artist()}));
  await page.route('**/api/v1/artists/artist-canonical/follow',route=>{followed=route.request().postDataJSON().takip;return route.fulfill({json:artist()});});
  await page.route('**/api/v1/library',route=>route.fulfill({json:{sanatcilar:followed?[artist()]:[],albumler:[]}}));
  await page.goto('/#/artist/youtube/channel-a');
  await expect(page.getByRole('heading',{name:'People Around',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Following',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('Discography filters').getByRole('button',{name:'Single / EP',exact:true}).click();
  await expect(page.getByRole('button',{name:/Bliss/})).toBeVisible();
  await expect(page.getByRole('button',{name:'Album 2022 · Album'})).not.toBeVisible();
  await page.reload(); await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
  if(isMobile) await page.getByRole('button',{name:'Open library',exact:true}).click();
  await page.getByRole('button',{name:'Home',exact:true}).first().click();
  await expect(page).toHaveURL(/#\/$/);
  await page.goBack(); await expect(page.getByRole('heading',{name:'People Around',exact:true})).toBeVisible();
  await page.goForward(); await expect(page.getByRole('heading',{name:'Welcome back, Sidewave'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('album saving uses canonical IDs and preserves the selected value after reload', async ({page})=>{
 await mock(page);let saved=false;
 const album=()=>({id:'release-one',appId:'album-canonical',ad:'Bliss',sanatci:'People Around',kaynak:'youtube',kayitli:saved,parcalar:[song]});
 await page.route('**/api/yt/album/release-one',route=>route.fulfill({json:album()}));
 await page.route('**/api/v1/albums/album-canonical/save',route=>{saved=route.request().postDataJSON().kayitli;return route.fulfill({json:album()});});
 await page.goto('/#/album/yt%3Arelease-one');
 await page.getByRole('button',{name:'Save album',exact:true}).click();
 await expect(page.getByRole('button',{name:'In your library',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();await expect(page.getByRole('button',{name:'In your library',exact:true})).toBeVisible();
});

test('sonic discovery previews results without starting playback, hides unsupported scores and preserves path anchors',async({page})=>{
 await mock(page);
 const a={...song,id:'a',appId:'a',kaynak:'kutuphane'},b={...song,id:'b',appId:'b',baslik:'Bitiş',kaynak:'kutuphane'};
 let playbackRequests=0;
 await page.route('**/api/v1/playback/resolve',route=>{playbackRequests++;return route.fulfill({status:503,json:{message:'test'}});});
 await page.route('**/api/ara?*',route=>route.fulfill({json:{parcalar:[a,b]}}));
 await page.route('**/api/v1/discovery/capabilities',route=>route.fulfill({json:{available:true,message:'Hazır',analysis:{count:2,total:2,model:'DCLAP'}}}));
 await page.route('**/api/v1/discovery/instant-mix',route=>route.fulfill({json:{state:'ready',parcalar:[a,b],matches:[{parca:b,similarity:null}]}}));
 await page.route('**/api/v1/discovery/similar-tracks',route=>route.fulfill({json:{state:'ready',parcalar:[b],matches:[{parca:b,similarity:null}]}}));
 await page.route('**/api/v1/discovery/path',route=>{expect(route.request().postDataJSON()).toMatchObject({start:{id:'a'},end:{id:'b'}});return route.fulfill({json:{state:'ready',parcalar:[a,b],matches:[{parca:a,similarity:null},{parca:b,similarity:null}]}});});
 await page.goto('/');await page.getByRole('combobox',{name:'Search songs, albums or artists'}).fill('Test');
 await page.getByRole('button',{name:'Test Şarkısı sound discovery',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sound discovery'});await expect(dialog.getByRole('button',{name:'Play (2)',exact:true})).toBeVisible();expect(playbackRequests).toBe(0);
 await dialog.getByRole('button',{name:'Similar tracks',exact:true}).click();await expect(dialog.getByRole('button',{name:'Play (1)',exact:true})).toBeVisible();await expect(dialog).not.toContainText('-1');
 await dialog.getByRole('button',{name:'Sound journey',exact:true}).click();await dialog.getByRole('textbox',{name:'Choose where your journey ends'}).fill('Bitiş');await dialog.getByRole('button',{name:/^Bitiş/}).click();await expect(dialog.getByRole('button',{name:'Play (2)',exact:true})).toBeVisible();
 expect(playbackRequests).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
});

for (const width of [320,390,1440]) test(`1.3 large lists paginate, filter with a clean player at ${width}px`,async({page})=>{
 await mock(page);await page.setViewportSize({width,height:900});
 await page.route('**/api/favoriler',route=>route.fulfill({json:{parcalar:Array.from({length:756},(_,i)=>({...song,id:'item-'+i,appId:'app-'+i,baslik:'Kayıt '+i})),albumler:[]}}));
 await page.route('**/api/v1/cache',route=>route.fulfill({json:{enabled:true,capacityBytes:10*1024**3,usedBytes:1024,entries:1,activeFills:0}}));
 await page.goto('/#/favoriler');
 // Navigation parser uses its established route format; use the actual library action.
 if(width<768)await page.getByRole('button',{name:'Open library',exact:true}).click();
 await page.getByRole('button',{name:'Liked Songs',exact:false}).first().click();
 await expect(page.getByLabel('Search this list')).toBeVisible();
 await expect(page.getByRole('group')).toHaveCount(50);
 await page.getByLabel('Search this list').fill('Kayıt 755');
 await expect(page.getByRole('group')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByRole('button',{name:'Ses önbelleği ayarları'})).toHaveCount(0);
});

test('online discovery works without archive analysis and polls real excerpt scores',async({page})=>{
 await mock(page);
 const seed={...song,id:'aaaaaaaaaaa',appId:'seed',kaynak:'youtube'},fresh={...song,id:'bbbbbbbbbbb',appId:'fresh',baslik:'Yeni Weekly',sanatci:'Yeni Artist',kaynak:'youtube'};
 await page.route('**/api/ara?*',route=>route.fulfill({json:{parcalar:[seed]}}));
 await page.route('**/api/v1/discovery/capabilities',route=>route.fulfill({json:{available:false,message:'Library analizi off'}}));
 await page.route('**/api/v1/discovery/instant-mix',route=>route.fulfill({json:{method:'catalog',parcalar:[seed,fresh],matches:[{parca:fresh,similarity:null,method:'catalog'}],analysis:{id:'session',state:'analyzing',completed:0,total:2,failed:0,message:'Ses örnekleri hazırlanıyor'}}}));
 await page.route('**/api/v1/discovery/sessions/session?mix=true',route=>route.fulfill({json:{method:'hybrid',parcalar:[seed,fresh],matches:[{parca:fresh,similarity:.88,method:'audio_excerpt'}],analysis:{id:'session',state:'ready',completed:2,total:2,failed:0,message:'Ses örneği karşılaştırması tamamlandı'}}}));
 await page.goto('/');await page.getByRole('combobox',{name:'Search songs, albums or artists'}).fill('Test');
 await page.getByRole('button',{name:'Test Şarkısı sound discovery',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sound discovery'});
 await expect(dialog.getByText('Yeni Weekly',{exact:true})).toBeVisible();await expect(dialog.getByText('Catalog recommendation',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Audio similarity',{exact:true})).toBeVisible({timeout:10000});
 await expect(dialog).not.toContainText('arşiv kopyası gerekir');
});

test('now-playing discovery uses the current track and keeps audio playing',async({page})=>{
 await mock(page);
 let resolves=0;
 const audio=Buffer.alloc(44+16000*2*30);
 audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
 await page.route('**/current-track.wav',route=>route.fulfill({contentType:'audio/wav',body:audio}));
 await page.route('**/api/v1/playback/resolve',route=>{resolves++;return route.fulfill({json:{url:'/current-track.wav',delivery:'online',parca:song}})});
 for(const mode of ['similar-tracks','instant-mix'])await page.route(`**/api/v1/discovery/${mode}`,route=>{
  expect(route.request().postDataJSON().parca).toMatchObject({id:song.id,kaynak:'youtube'});
  return route.fulfill({json:{method:'catalog',parcalar:[{...song,id:'new',baslik:'Yeni öneri'}],matches:[]}});
 });
 await page.route('**/api/v1/discovery/capabilities',route=>route.fulfill({json:{available:true}}));
 await page.goto('/');await page.getByRole('combobox',{name:'Search songs, albums or artists'}).fill('Test');
 await page.getByRole('group',{name:song.baslik}).getByText(song.baslik,{exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 for(const label of ['Discover similar tracks','Instant mix','Sound journey']){
  await page.getByRole('button',{name:'Show now playing'}).click();
  const player=page.getByRole('region',{name:'Now playing'});
  await player.getByRole('button',{name:label,exact:true}).click();
  const discovery=page.getByRole('dialog',{name:'Sound discovery'});await expect(discovery).toBeVisible();await expect(discovery.getByText(song.baslik,{exact:true})).toBeVisible();
  if(label==='Sound journey')await expect(discovery.getByLabel('Choose where your journey ends')).toBeVisible();
  else await expect(discovery.getByText('Yeni öneri',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(discovery).not.toBeVisible();
  await expect(player.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  expect(resolves).toBe(1);
  await page.getByRole('button',{name:'Close now playing'}).click();
 }
});
