import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseImport } from '../src/import.js'
test('CSV quoting, Turkish characters, duplication and M3U metadata',()=>{
 const csv='Track Name,Artist Name(s)\n"Şarkı, Bir",Sanatçı\n"Şarkı, Bir",Sanatçı\n';const p=parseImport(csv,'csv');assert.equal(p.rows[0].baslik,'Şarkı, Bir');assert.equal(p.duplicates,1)
 const m=parseImport('#EXTM3U\n#EXTINF:200,Sanatçı - Şarkı\nhttp://private/file.mp3','m3u');assert.equal(m.rows.length,1);assert.equal(m.rows[0].sanatci,'Sanatçı')
 assert.equal(parseImport('Sanatçı — Şarkı\nSanatçı — İkinci').rows.length,2)
 const plain=parseImport('C:\\Music\\Sanatçı - Şarkı.flac\nhttps://example.test/Other%20-%20Song.mp3','m3u');assert.equal(plain.rows.length,2);assert.equal(plain.rows[0].baslik,'Şarkı');assert.equal(plain.rows[1].sanatci,'Other')
})
test('invalid CSV and oversized imports fail explicitly',()=>{assert.throws(()=>parseImport('title,artist\n"unterminated','csv'));assert.throws(()=>parseImport('x'.repeat(200001)));assert.throws(()=>parseImport('a\n'.repeat(501)))})
