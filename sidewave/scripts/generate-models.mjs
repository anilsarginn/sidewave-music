import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const header = '// Generated from openapi.json. Run npm run generate:models.'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kotlinKeywords = new Set(['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while'])
const kotlinName = name => kotlinKeywords.has(name) ? `\`${name}\`` : name

/** Optional Kotlin properties use null for absence; Parca keeps its established defaults. */
export function generateContracts(document) {
  const schemas = document.components?.schemas
  if (!schemas?.Parca) throw new Error('components.schemas.Parca is required')
  const names = Object.keys(schemas)
  for (const name of names) {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsupported schema name: ${name}`)
  }

  function type(schema, language, location) {
    if (!schema || typeof schema !== 'object') throw new Error(`Missing schema at ${location}`)
    if (schema.$ref) {
      const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(schema.$ref)
      if (!match || !schemas[match[1]]) throw new Error(`Unresolved reference at ${location}: ${schema.$ref}`)
      return language === 'ts' ? `${match[1]}Contract` : match[1]
    }
    if (schema.anyOf) {
      const nonNull = schema.anyOf.filter(item => item.type !== 'null')
      const nullable = nonNull.length !== schema.anyOf.length
      if (nonNull.length !== 1 || !nullable) throw new Error(`Only nullable anyOf unions are supported at ${location}`)
      const inner = type(nonNull[0], language, location)
      return language === 'ts' ? `${inner} | null` : `${inner}?`
    }
    if (Array.isArray(schema.type)) {
      return type({ anyOf: schema.type.map(value => ({ ...schema, type: value })) }, language, location)
    }
    if (schema.enum) {
      if (!schema.enum.length || schema.enum.some(value => !['string', 'number', 'boolean'].includes(typeof value))) throw new Error(`Unsupported enum at ${location}`)
      const kotlinType = ({ string: 'String', number: 'Double', integer: 'Int', boolean: 'Boolean' })[schema.type]
      if (!kotlinType) throw new Error(`Unsupported enum type at ${location}`)
      return language === 'ts' ? schema.enum.map(value => JSON.stringify(value)).join(' | ') : kotlinType
    }
    const scalar = language === 'ts'
      ? { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null' }
      : { string: 'String', number: 'Double', integer: 'Int', boolean: 'Boolean', null: 'Nothing?' }
    if (scalar[schema.type]) return scalar[schema.type]
    if (schema.type === 'array') {
      const element = type(schema.items, language, `${location}[]`)
      return language === 'ts' ? `Array<${element}>` : `List<${element}>`
    }
    if (schema.type === 'object' && schema.additionalProperties && !schema.properties) {
      const value = schema.additionalProperties === true ? (language === 'ts' ? 'unknown' : 'Any?') : type(schema.additionalProperties, language, `${location}{}`)
      return language === 'ts' ? `Record<string, ${value}>` : `Map<String, ${value}>`
    }
    throw new Error(`Unsupported property schema at ${location}: ${JSON.stringify(schema)}`)
  }

  function declarations(name, schema) {
    if (schema.type !== 'object' || !schema.properties) throw new Error(`Object properties required for ${name}`)
    const required = new Set(schema.required ?? [])
    for (const property of required) if (!(property in schema.properties)) throw new Error(`Required property missing at ${name}.${property}`)
    const ts = [`export type ${name}Contract = {`]
    const kt = [`data class ${name}(`]
    for (const [property, definition] of Object.entries(schema.properties)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(property)) throw new Error(`Unsupported property name: ${name}.${property}`)
      const optional = !required.has(property)
      const tsType = type(definition, 'ts', `${name}.${property}`)
      // Preserve the existing Parca contract, including its permissive optional nulls.
      ts.push(`  ${property}${optional ? '?' : ''}: ${tsType}${name === 'Parca' && optional && !tsType.includes(' | null') ? ' | null' : ''};`)
      let kotlinType = type(definition, 'kt', `${name}.${property}`)
      const legacyDefault = name === 'Parca' && optional && (property === 'sanatci' || property === 'favori')
      if (optional && !legacyDefault && !kotlinType.endsWith('?')) kotlinType += '?'
      const defaultValue = optional ? ` = ${legacyDefault ? (property === 'sanatci' ? '""' : 'false') : 'null'}` : ''
      kt.push(`    val ${kotlinName(property)}: ${kotlinType}${defaultValue},`)
    }
    ts.push('};')
    kt.push(')')
    return { ts: ts.join('\n'), kt: kt.join('\n') }
  }

  const rendered = names.map(name => ({ name, ...declarations(name, schemas[name]) }))
  return new Map([
    ['web/src/generated/models.ts', [header, ...rendered.map(item => item.ts), ''].join('\n')],
    ['android/app/src/main/java/com/sarginlabs/sidewave/api/Parca.kt', [header, 'package com.sarginlabs.sidewave.api', '', rendered.find(item => item.name === 'Parca').kt, ''].join('\n')],
    ['android/app/src/main/java/com/sarginlabs/sidewave/api/Contracts.kt', [header, 'package com.sarginlabs.sidewave.api', '', ...rendered.filter(item => item.name !== 'Parca').map(item => item.kt + '\n')].join('\n')],
  ])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const document = JSON.parse(readFileSync(resolve(root, 'openapi.json'), 'utf8'))
  const check = process.argv.includes('--check')
  for (const [path, data] of generateContracts(document)) {
    const file = resolve(root, path)
    if (check) {
      if (readFileSync(file, 'utf8') !== data) throw new Error(`Generated contract is stale: ${path}. Run npm run generate:models.`)
    } else {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, data)
    }
  }
}
