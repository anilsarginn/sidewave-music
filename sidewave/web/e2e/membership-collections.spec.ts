import {test,expect} from '@playwright/test';

test('signup validates confirmation, enters the app and logout returns to login',async({page})=>{
 let authenticated=false;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:authenticated?{id:'one',username:'Anil'}:null}});
  if(path==='/api/auth/signup'){authenticated=true;return route.fulfill({status:201,json:{user:{id:'one',username:'Anil'}}})}
  if(path==='/api/auth/logout'){authenticated=false;return route.fulfill({json:{ok:true}})}
  return route.fulfill({json:{listeler:[],albumler:[],sanatcilar:[],parcalar:[],jobs:[],devices:[],indirmeler:[]}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Sign up',exact:true}).click();
 await page.getByLabel('Username',{exact:true}).fill('Anil');
 await page.getByLabel('Password',{exact:true}).fill('Testing123');
 await page.getByLabel('Confirm password').fill('Other123');
 await page.getByRole('button',{name:'Create account'}).click();
 await expect(page.getByRole('alert')).toHaveText('Your passwords do not match.');
 await page.getByLabel('Confirm password').fill('Testing123');
 await page.getByRole('button',{name:'Create account'}).click();
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('editorial collection and weekly discovery navigate as application-owned selections',async({page,isMobile})=>{
 const track={id:'abcdefghijk',baslik:'Yeni bir keşif',sanatci:'Portico Quartet',kaynak:'youtube',sure:200};
 const collection={id:'jazz',ad:'Geceye Jazz',tur:'Jazz',renk:'#ab7654',aciklama:'Modern jazz selectkisi.',owner:'Sidewave',editable:false,parcalar:[track]};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'one',username:'Anil'}}});
  if(path==='/api/v1/collections')return route.fulfill({json:{listeler:[collection]}});
  if(path==='/api/v1/collections/jazz')return route.fulfill({json:collection});
  if(path==='/api/v1/discovery/weekly')return route.fulfill({json:{...collection,id:'weekly',ad:'Discover Weekly',personalized:true,refreshAt:1792962000000}});
  return route.fulfill({json:{listeler:[],albumler:[],sanatcilar:[],parcalar:[],jobs:[],devices:[],indirmeler:[]}});
 });
 await page.goto('/#/collections');
 await page.getByRole('button',{name:/Geceye Jazz/}).click();
 await expect(page).toHaveURL(/#\/collection\/jazz/);
 await expect(page.getByRole('heading',{name:'Geceye Jazz'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Rename'})).toHaveCount(0);
 await expect(page.getByText('Yeni bir keşif',{exact:true})).toBeVisible();
 await page.goto('/#/weekly');
 await expect(page.getByRole('heading',{name:'Discover Weekly',exact:true})).toBeVisible();
 await expect(page.getByText(/Next mix:/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
