#!/usr/bin/env node
/**
 * Iterative test for heir-list extraction.
 *
 * The rebuilt extractor captured only the FIRST name after "to my Sons ..." —
 * "to my Sons A, B, C, D" yielded just A. These cases (lifted from real
 * Liberty County probate OCR) pin the expected full list so extractHeirs can
 * be debugged to convergence. Run after every change:
 *
 *   node scripts/test-heir-extraction.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { extractHeirs } = require('../src/services/probate/probate-entity-extractor.js');

// { ocr, expect: [names...] } — expected heir names, order-independent.
const CASES = [
  {
    label: 'doc197561 — 5 daughters, comma + "and" separated',
    ocr: 'to my daughters , Velma Ned , May Lee , Inez Roberts , Hertha Fabian and Willie Roberts shew and share alike , thirty acres of said tract',
    expect: ['Velma Ned', 'May Lee', 'Inez Roberts', 'Hertha Fabian', 'Willie Roberts'],
  },
  {
    label: 'doc197417 — wife + 3 children, "&" separated',
    ocr: 'I give & bequeath to my wife Mary Esther & my children Ella Matilda , Eva Killen & Samuel M',
    expect: ['Mary Esther', 'Ella Matilda', 'Eva Killen', 'Samuel M'],
  },
  {
    label: 'Sons list, trailing "and my Daughter in Law" clause',
    ocr: 'I do give and bequeath to my Sons S W Aum , John Winn , W. W. Munn , S S Winn the remainder',
    expect: ['S W Aum', 'John Winn', 'W W Munn', 'S S Winn'],
  },
  {
    label: 'single heir — must still work',
    ocr: 'I give devise and bequeath to my said daughter Cecile , Five Hundred Dollars',
    expect: ['Cecile'],
  },
  {
    label: 'no heir — witness page, must stay empty',
    ocr: 'in the presence of said testator W. W. Osborne H. M. Morgan signing in our presence',
    expect: [],
  },
];

let pass = 0;
for (const c of CASES) {
  const got = extractHeirs(c.ocr).map((h) => h.name);
  const gotSet = new Set(got.map((s) => s.toLowerCase()));
  const expSet = new Set(c.expect.map((s) => s.toLowerCase()));
  const missing = c.expect.filter((n) => !gotSet.has(n.toLowerCase()));
  const extra = got.filter((n) => !expSet.has(n.toLowerCase()));
  const ok = missing.length === 0 && extra.length === 0;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}`);
  if (!ok) {
    console.log(`      got     : [${got.join(', ')}]`);
    console.log(`      expected: [${c.expect.join(', ')}]`);
    if (missing.length) console.log(`      missing : [${missing.join(', ')}]`);
    if (extra.length) console.log(`      extra   : [${extra.join(', ')}]`);
  }
}
console.log(`\n${pass}/${CASES.length} cases pass`);
process.exit(pass === CASES.length ? 0 : 1);
