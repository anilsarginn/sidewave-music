import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { generateContracts } from '../scripts/generate-models.mjs'

const document = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'))
const files = generateContracts(document)
const typescript = files.get('web/src/generated/models.ts')
const kotlin = files.get('android/app/src/main/java/com/sarginlabs/sidewave/api/Contracts.kt')

test('every published OpenAPI schema has a generated client model and checked-in output is current', () => {
  for (const schema of Object.keys(document.components.schemas)) {
    assert.match(typescript, new RegExp(`export type ${schema}Contract = \\{`))
    const source = schema === 'Parca' ? files.get('android/app/src/main/java/com/sarginlabs/sidewave/api/Parca.kt') : kotlin
    assert.match(source, new RegExp(`data class ${schema}\\(`))
  }
  for (const [path, output] of files) assert.equal(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), output, path)
})

test('references, nested arrays, required-nullable fields and optional properties retain their contract', () => {
  const fixture = structuredClone(document)
  fixture.components.schemas.Nested = { type: 'object', required: ['selected', 'groups'], properties: {
    selected: { anyOf: [{ $ref: '#/components/schemas/Parca' }, { type: 'null' }] },
    groups: { type: 'array', items: { type: 'array', items: { $ref: '#/components/schemas/ArchiveCandidate' } } },
    enabled: { type: 'boolean' },
  } }
  const output = generateContracts(fixture)
  const ts = output.get('web/src/generated/models.ts')
  const kt = output.get('android/app/src/main/java/com/sarginlabs/sidewave/api/Contracts.kt')
  assert.match(ts, /selected: ParcaContract \| null;/)
  assert.match(ts, /groups: Array<Array<ArchiveCandidateContract>>;/)
  assert.match(ts, /enabled\?: boolean;/)
  assert.match(kt, /val selected: Parca\?,\n/)
  assert.doesNotMatch(kt.split("data class Nested(")[1], /val selected: Parca\? =/)
  assert.match(kt, /val groups: List<List<ArchiveCandidate>>,/)
  assert.match(kt, /val enabled: Boolean\? = null,/)
  assert.match(kotlin, /val candidates: List<ArchiveCandidate>\? = null,/)
  assert.match(kotlin, /val queue: List<Parca>\? = null,/)
})

test('unknown references and unsupported unions fail generation instead of weakening types', () => {
  const unknown = structuredClone(document)
  unknown.components.schemas.ResolveRequest.properties.parca = { $ref: '#/components/schemas/Unknown' }
  assert.throws(() => generateContracts(unknown), /Unresolved reference.*Unknown/)
  const union = structuredClone(document)
  union.components.schemas.ImportRow.properties.selected = { anyOf: [{ type: 'string' }, { type: 'number' }] }
  assert.throws(() => generateContracts(union), /Only nullable anyOf unions/)
})

test('Kotlin Parca preserves legacy fields and defaults while allowing optional recommendation metadata', () => {
  // Includes constructor defaults used by the native app and its offline JSON adapter.
  const expected = readFileSync(new URL('../android/app/src/main/java/com/sarginlabs/sidewave/api/Parca.kt', import.meta.url), 'utf8')
  assert.equal(files.get('android/app/src/main/java/com/sarginlabs/sidewave/api/Parca.kt'), expected)
  assert.equal(createHash('sha256').update(expected.replace(/    val reason(?:Type)?: String\? = null,\n/g,'')).digest('hex'), 'fd32af3890487df53831523a9da0130d01862d3434f21ee9d785df5aea41e489')
  const legacyTypeScript = typescript.slice(0, typescript.indexOf('export type ApiErrorContract'))
  assert.equal(createHash('sha256').update(legacyTypeScript.replace(/  reason(?:Type)?\?: string \| null;\n/g,'')).digest('hex'), '1884bf0282dcc004c82e75d9d2e30f0ef040e7a3c8d15d38a361a0d569879153')
  assert.match(expected, /val sanatci: String = "",/)
  assert.match(expected, /val favori: Boolean = false,/)
  assert.match(typescript, /export type ParcaContract = \{\n  id: string;\n  baslik: string;\n  kaynak: "kutuphane" \| "youtube";/)
})
