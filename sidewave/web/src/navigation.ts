export type Gorunum =
  | {tip: 'collections'} | {tip: 'weekly'} | {tip: 'collection'; id: string}
  | {tip: 'kesfet'} | {tip: 'album'; id: string}
  | {tip: 'sanatci'; id: string; kaynak: 'kutuphane' | 'youtube'}
  | {tip: 'arama'; q: string} | {tip: 'favoriler'} | {tip: 'liste'; id: string}
  | {tip: 'kutuphane'} | {tip: 'mix'; id: string} | {tip: 'paylasilan'; token: string} | {tip: 'istatistik'} | {tip: 'sarki'; token: string};
export function viewUrl(view: Gorunum) {
  if(view.tip === 'collections') return '#/collections';
  if(view.tip === 'weekly') return '#/weekly';
  if(view.tip === 'collection') return `#/collection/${encodeURIComponent(view.id)}`;
  if(view.tip === 'sanatci') return `#/artist/${view.kaynak==='kutuphane'?'library/':''}${encodeURIComponent(view.id)}`;
  if(view.tip === 'album') return view.id.startsWith('yt:')?`#/album/online/${encodeURIComponent(view.id.slice(3))}`:`#/album/library/${encodeURIComponent(view.id)}`;
  if(view.tip === 'liste') return `#/playlist/${encodeURIComponent(view.id)}`;
  if(view.tip === 'favoriler') return '#/favorites';
  if(view.tip === 'arama') return view.q ? `#/search/${encodeURIComponent(view.q)}` : '#/search';
  if(view.tip === 'kutuphane') return '#/library';
  if(view.tip === 'mix') return `#/mix/${encodeURIComponent(view.id)}`;
  if(view.tip === 'paylasilan') return `#/shared/${encodeURIComponent(view.token)}`;
  if(view.tip === 'istatistik') return '#/stats';
  if(view.tip === 'sarki') return `#/song/${encodeURIComponent(view.token)}`;
  return '#/';
}
export function parseView(hash: string): Gorunum {
  try {
    const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    if(parts[0] === 'collections') return {tip:'collections'};
    if(parts[0] === 'weekly') return {tip:'weekly'};
    if(parts[0] === 'collection' && parts[1]) return {tip:'collection',id:parts[1]};
    // Old bookmarks still resolve, then App replaces them with the clean URL.
    if(parts[0] === 'artist' && ['kutuphane','youtube','library'].includes(parts[1]) && parts[2]) return {tip:'sanatci',kaynak:parts[1]==='youtube'?'youtube':'kutuphane',id:parts[2]};
    if(parts[0] === 'artist' && parts[1] && parts.length===2 && !['youtube','kutuphane','library'].includes(parts[1])) return {tip:'sanatci',kaynak:'youtube',id:parts[1]};
    if(parts[0] === 'album' && ['online','library'].includes(parts[1]) && parts[2]) return {tip:'album',id:(parts[1]==='online'?'yt:':'')+parts[2]};
    if(parts[0] === 'album' && parts[1] && parts.length===2) return {tip:'album',id:parts[1]};
    if(parts[0] === 'playlist' && parts[1]) return {tip:'liste',id:parts[1]};
    if(parts[0] === 'favorites') return {tip:'favoriler'};
    if(parts[0] === 'search') return {tip:'arama',q:parts[1]||''};
    if(parts[0] === 'library') return {tip:'kutuphane'};
    if(parts[0] === 'mix' && parts[1]) return {tip:'mix',id:parts[1]};
    if(parts[0] === 'shared' && parts[1]) return {tip:'paylasilan',token:parts[1]};
    if(parts[0] === 'stats') return {tip:'istatistik'};
    if(parts[0] === 'song' && parts[1]) return {tip:'sarki',token:parts[1]};
  } catch { /* A malformed shared URL opens the home screen. */ }
  return {tip:'kesfet'};
}
