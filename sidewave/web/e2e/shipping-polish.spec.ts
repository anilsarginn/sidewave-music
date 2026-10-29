import {test,expect} from '@playwright/test';

test('profile owns appearance, downloads and sign out; desktop navigation stays quiet',async({page,isMobile})=>{
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'one',username:'Anıl',owner:true}}});
  if(path==='/api/v1/home/intro')return route.fulfill({json:{kind:'greeting',period:'test',greeting:'Good afternoon'}});
  return route.fulfill({json:{listeler:[],albumler:[],sanatcilar:[],parcalar:[],jobs:[],devices:[],indirmeler:[]}});
 });
 await page.goto('/');
 const topbar=page.locator('.app-topbar'),profile=page.getByRole('button',{name:'Profile',exact:true});
 await expect(profile).toBeVisible();await expect(topbar.getByText('Anıl',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Ses önbelleği ayarları'})).toHaveCount(0);
 await expect(page.getByText('Android uygulamasını indir',{exact:true})).toHaveCount(0);
 await expect(page.getByText(/Kendi sunucunda|Library bağlı|Online servis bağlı/)).toHaveCount(0);
 await expect(page.getByRole('menuitem')).toHaveCount(0);
 const box=await profile.boundingBox(),bar=await topbar.boundingBox();expect(bar!.x+bar!.width-box!.x-box!.width).toBeLessThan(35);
 await profile.click();await expect(page.getByRole('menu')).toBeVisible();
 await expect(page.getByRole('menuitem')).toHaveText(['Your stats','Background & appearance','Downloads','Keyboard shortcuts','Sign out']);
 await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await expect(profile).toBeFocused();
 await profile.click();await page.getByRole('menuitem',{name:'Downloads',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Downloads',exact:true})).toBeVisible();await expect(page.getByRole('menu')).toHaveCount(0);
 await page.getByRole('button',{name:'Close panel'}).click();
 if(isMobile)await page.getByRole('button',{name:'Open library',exact:true}).click();
 await expect(page.getByRole('complementary').getByRole('button',{name:'Search',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('revisits show a fresh sourced quote and account rerenders do not claim another greeting',async({page})=>{
 const visits=new Map<string,unknown>();let claims=0;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'one',username:'Anıl',owner:true}}});
  if(path==='/api/v1/home/intro'){
   const {visitId}=route.request().postDataJSON();
   if(!visits.has(visitId)){claims++;visits.set(visitId,claims===1?{kind:'greeting',period:'test',greeting:'Good morning'}:{kind:'quote',period:'test',quote:{id:'quote-'+claims,text:claims===2?'Without music life would be a mistake.':'Rhythm and harmony find their way into the inward places of the soul.',author:claims===2?'Friedrich Nietzsche':'Plato',work:claims===2?'Putların Alacakaranlığı':'Devlet',source:'https://www.gutenberg.org/ebooks/150'}});}
   return route.fulfill({json:visits.get(visitId)});
  }
  return route.fulfill({json:{listeler:[],albumler:[],sanatcilar:[],parcalar:[],jobs:[],devices:[],indirmeler:[]}});
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome back, Anıl'})).toBeVisible();expect(claims).toBe(1);
 await page.getByRole('button',{name:'Profile',exact:true}).click();await page.keyboard.press('Escape');expect(claims).toBe(1);
 await page.reload();await expect(page.locator('.home-quote')).toContainText('Friedrich Nietzsche');
 await expect(page.getByText('Welcome back,',{exact:false})).toHaveCount(0);
 await expect(page.locator('.home-quote a')).toHaveAttribute('href','https://www.gutenberg.org/ebooks/150');
 await page.reload();await expect(page.locator('.home-quote')).toContainText('Plato');expect(claims).toBe(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('members who do not own the library get no downloads or archive actions',async({page})=>{
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'two',username:'Guest',owner:false}}});
  if(['/api/indirmeler','/api/v1/archive/jobs'].includes(path))return route.fulfill({status:403,json:{code:'OWNER_ONLY'}});
  return route.fulfill({json:{listeler:[],albumler:[],sanatcilar:[],parcalar:[],jobs:[],devices:[],indirmeler:[]}});
 });
 const owned:string[]=[];page.on('request',r=>{const path=new URL(r.url()).pathname;if(['/api/indirmeler','/api/v1/archive/jobs'].includes(path))owned.push(path)});
 await page.goto('/');await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByRole('menuitem')).toHaveText(['Your stats','Background & appearance','Keyboard shortcuts','Sign out']);
 await page.waitForTimeout(500);expect(owned).toEqual([]);
});
