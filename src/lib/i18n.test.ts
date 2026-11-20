import { describe, expect, it } from 'vitest'
import { resources } from './i18n'

type Tree = { [k: string]: string | Tree }
function flat(o: Tree, p = ''): Record<string, string> {
  return Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === 'string') acc[p + k] = v
    else Object.assign(acc, flat(v, `${p}${k}.`))
    return acc
  }, {})
}
const placeholders = (s: string) => (s.match(/{{\s*\w+\s*}}/g) ?? []).sort().join(',')

describe('translation completeness', () => {
  for (const ns of Object.keys(resources.en) as (keyof typeof resources.en)[]) {
    const en = flat(resources.en[ns] as Tree)
    const bn = flat(resources.bn[ns] as Tree)
    it(`${ns}: Bangla has exactly the same keys as English`, () => {
      expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort())
    })
    it(`${ns}: no empty strings and matching {{placeholders}}`, () => {
      for (const k of Object.keys(en)) {
        expect(en[k].trim(), `en ${ns}.${k}`).not.toBe('')
        expect(bn[k].trim(), `bn ${ns}.${k}`).not.toBe('')
        expect(placeholders(bn[k]), `placeholders ${ns}.${k}`).toBe(placeholders(en[k]))
      }
    })
  }
})
