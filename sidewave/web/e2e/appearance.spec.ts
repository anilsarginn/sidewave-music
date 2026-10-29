import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page){
 const sharedCalls:string[]=[];
 await page.route('**/api/**',route=>{if(new URL(route.request().url()).pathname==='/api/auth/me')return route.fulfill({json:{user:{id:'test-member',username:'Sidewave'}}});if(['/api/v1/appearance','/api/v1/appearance/wallpaper'].includes(new URL(route.request().url()).pathname))sharedCalls.push(route.request().method());return route.fulfill({json:{albumler:[],sanatcilar:[],listeler:[],indirmeler:[],jobs:[],parcalar:[],devices:[],activeDeviceId:null}})});
 await page.goto('/');await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('menuitem',{name:'Background & appearance',exact:true}).click();return sharedCalls;
}
async function upload(page:Page){
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const x=c.getContext('2d')!;x.fillStyle='#31728b';x.fillRect(0,0,800,500);return c.toDataURL().split(',')[1]});
 await page.getByLabel('Background image file').setInputFiles({name:'wallpaper.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.locator('.app-shell')).toHaveClass(/has-wallpaper/);
}
test('device appearance persists through reload and removal without shared API calls',async({page})=>{
 const calls=await setup(page);await upload(page);
 await page.getByRole('slider',{name:'Background dimming',exact:true}).fill('45');await page.getByRole('slider',{name:'Panel transparency',exact:true}).fill('80');
 await page.reload();await expect(page.locator('.app-shell')).toHaveClass(/has-wallpaper/);
 await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('menuitem',{name:'Background & appearance',exact:true}).click();await expect(page.getByRole('slider',{name:'Background dimming',exact:true})).toHaveValue('45');await expect(page.getByRole('slider',{name:'Panel transparency',exact:true})).toHaveValue('80');
 await page.getByRole('button',{name:'Remove',exact:true}).click();await expect(page.locator('.app-shell')).not.toHaveClass(/has-wallpaper/);
 await page.reload();await expect(page.locator('.app-shell')).not.toHaveClass(/has-wallpaper/);expect(calls).toEqual([]);
});
test('computer and phone contexts keep independent images, settings and removal',async({page,browser})=>{
 const calls=await setup(page);await upload(page);
 const context=await browser.newContext({viewport:{width:320,height:900}}),phone=await context.newPage();
 try{
  const phoneCalls=await setup(phone);await expect(phone.locator('.app-shell')).not.toHaveClass(/has-wallpaper/);await upload(phone);
  await phone.getByRole('slider',{name:'Panel transparency',exact:true}).fill('85');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('slider',{name:'Panel transparency',exact:true})).toHaveValue('70');
  await page.getByRole('button',{name:'Remove',exact:true}).click();await phone.reload();await expect(phone.locator('.app-shell')).toHaveClass(/has-wallpaper/);
  await phone.getByRole('button',{name:'Profile',exact:true}).click();await phone.getByRole('menuitem',{name:'Background & appearance',exact:true}).click();await expect(phone.getByRole('slider',{name:'Panel transparency',exact:true})).toHaveValue('85');
  expect(await phone.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(calls).toEqual([]);expect(phoneCalls).toEqual([]);
 }finally{await context.close()}
});
test('invalid images and unavailable browser storage keep the old choice',async({page})=>{
 await setup(page);await upload(page);const original=await page.evaluate(()=>localStorage.getItem('sidewave-wallpaper'));
 await page.getByLabel('Background image file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await expect(page.getByRole('alert').first()).toContainText('Could not open this image');
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Full','QuotaExceededError')}});await upload(page);await expect(page.getByRole('alert').first()).toContainText('Could not save this image');expect(await page.evaluate(()=>localStorage.getItem('sidewave-wallpaper'))).toBe(original);
});
test('last displayed shared image is pinned locally and explicit removal stays removed',async({page})=>{
 const url='/api/v1/appearance/wallpaper/'+'a'.repeat(64)+'.jpg';
 await page.addInitScript(url=>{if(!localStorage.getItem('seeded')){localStorage.setItem('sidewave-appearance-server',JSON.stringify({wallpaperUrl:url,configured:true}));localStorage.setItem('seeded','1')}},url);
 const calls=await setup(page);await expect(page.locator('.app-shell')).toHaveClass(/has-wallpaper/);expect(await page.evaluate(()=>localStorage.getItem('sidewave-wallpaper'))).toBe(url);
 await page.getByRole('button',{name:'Remove',exact:true}).click();await page.reload();await expect(page.locator('.app-shell')).not.toHaveClass(/has-wallpaper/);expect(calls).toEqual([]);
});

test('signature backgrounds apply, persist and can be removed',async({page})=>{
 await setup(page);
 const gallery=page.getByRole('group',{name:'Signature backgrounds'});
 await expect(gallery.getByRole('button')).toHaveCount(4);
 await gallery.getByRole('button',{name:'Midnight Coast',exact:true}).click();
 await expect(page.locator('.app-shell')).toHaveClass(/has-wallpaper/);
 expect(await page.evaluate(()=>localStorage.getItem('sidewave-wallpaper'))).toBe('/artwork/wallpapers/midnight-coast-v1.webp');
 await page.reload();await expect(page.locator('.app-shell')).toHaveClass(/has-wallpaper/);
 await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('menuitem',{name:'Background & appearance',exact:true}).click();
 await expect(page.getByRole('button',{name:'Midnight Coast',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Remove',exact:true}).click();await expect(page.locator('.app-shell')).not.toHaveClass(/has-wallpaper/);
 await page.reload();await expect(page.locator('.app-shell')).not.toHaveClass(/has-wallpaper/);
});
