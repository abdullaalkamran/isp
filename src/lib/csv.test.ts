import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'
describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, null]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n1,'))
  it('neutralises spreadsheet formulas', () => expect(toCsv(['a'], [['=SUM(A1)'], ['+1'], ['-2'], ['@x']])).toBe("a\r\n'=SUM(A1)\r\n'+1\r\n'-2\r\n'@x"))
  it('keeps Bangla text intact', () => expect(toCsv(['নাম'], [['রহিম']])).toBe('নাম\r\nরহিম'))
})
