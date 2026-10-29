import {describe,it,expect} from 'vitest';
import {parseView,viewUrl,type Gorunum} from './navigation';
describe('shared page URLs',()=>{
 it('roundtrips source identities, Turkish names and playlist IDs',()=>{
  const cases:Gorunum[]=[{tip:'kesfet'},{tip:'sanatci',id:'same-name',kaynak:'youtube'},{tip:'sanatci',id:'same-name',kaynak:'kutuphane'},{tip:'album',id:'yt:MPRE_1'},{tip:'liste',id:'a/b'},{tip:'arama',q:'Şarkı & Sanatçı'},{tip:'favoriler'}];
  for(const g of cases)expect(parseView(viewUrl(g))).toEqual(g);
 });
 it('does not crash on malformed or unsupported external links',()=>{
  for(const hash of ['#/album/%E0%A4%A','#/artist/spotify/x','#/artist/youtube/','#/unknown'])expect(parseView(hash)).toEqual({tip:'kesfet'});
 });
 it('keeps source names out of artist links and accepts existing bookmarks',()=>{
  const id='UCorICUCLhU9Y2c1Z1QxPSPQ';
  expect(viewUrl({tip:'sanatci',id,kaynak:'youtube'})).toBe('#/artist/'+id);
  expect(viewUrl(parseView('#/artist/youtube/'+id))).toBe('#/artist/'+id);
  expect(viewUrl(parseView('#/album/yt%3AMPR1'))).toBe('#/album/online/MPR1');
 });
});
