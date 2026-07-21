#!/usr/bin/env node
// Generates public/pinyin-dict.json — a compact toneless-pinyin → candidates
// dictionary for the embedded pinyin IME (src/utils/pinyinIme.ts).
//
// Data source (downloaded on first run, cached in the OS temp dir):
//   rawdict_utf16_65105_freq.txt — the open-source Google Pinyin IME dictionary
//   from AOSP (platform/packages/inputmethods/PinyinIME), Apache License 2.0.
//   It contains 65105 entries of "word frequency gbk_flag syllable..." covering
//   both single characters (with per-reading frequencies, e.g. 的 de / 的 di)
//   and multi-character words, so no separate frequency list is needed.
//   Fetched from GitHub mirrors of the AOSP repo (see MIRRORS below).
//
// Output format: { "ni": ["你","尼",...], "nihao": ["你好",...], ... }
//   - keys: toneless pinyin, syllables joined without separators (ü typed as v
//     for lv/nv, as ue for lue/nue — matching Google Pinyin conventions)
//   - values: candidates sorted by descending corpus frequency
//
// Usage: node scripts/gen-pinyin-dict.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIRRORS = [
  'https://raw.githubusercontent.com/yxl/Android-PinyinIME/master/jni/data/rawdict_utf16_65105_freq.txt',
  'https://raw.githubusercontent.com/ibaoger/PinyinIME/master/app/src/main/cpp/data/rawdict_utf16_65105_freq.txt',
]

// Top N distinct single characters to keep (ranked by best reading frequency).
const CHAR_LIMIT = 7000
// Top N multi-character words (1-4 syllables) to keep, ranked by frequency.
const WORD_LIMIT = 60000

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outFile = path.join(scriptDir, '..', 'public', 'assets', 'pinyin-dict.json')
const cacheFile = path.join(tmpdir(), 'dinotty-pinyin-dict', 'rawdict_utf16_65105_freq.txt')

async function downloadRawDict() {
  if (existsSync(cacheFile)) {
    console.log(`using cached ${cacheFile}`)
    return readFile(cacheFile)
  }
  for (const url of MIRRORS) {
    console.log(`downloading ${url}`)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // The canonical AOSP file is 3570346 bytes of UTF-16LE; reject anything
      // suspiciously small (error pages, git-lfs pointers).
      if (buf.length < 1_000_000) throw new Error(`too small (${buf.length} bytes)`)
      await mkdir(path.dirname(cacheFile), { recursive: true })
      await writeFile(cacheFile, buf)
      return buf
    } catch (err) {
      console.warn(`  failed: ${err.message}`)
    }
  }
  throw new Error('could not download rawdict from any mirror')
}

function parseRawDict(buf) {
  // "word freq gbk_flag syllable1 [syllable2 ...]" per line, UTF-16LE with BOM.
  const text = buf.toString('utf16le').replace(/^\uFEFF/, '')
  const entries = []
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4) continue
    const word = fields[0]
    const freq = Number.parseFloat(fields[1])
    const syllables = fields.slice(3)
    if (!Number.isFinite(freq)) continue
    if (!syllables.every((s) => /^[a-z]+$/.test(s))) continue
    entries.push({ word, chars: Array.from(word), freq, key: syllables.join('') })
  }
  return entries
}

function buildDict(entries) {
  const singles = entries.filter((e) => e.chars.length === 1)
  const words = entries.filter((e) => e.chars.length >= 2 && e.chars.length <= 4)

  // Rank distinct characters by their most frequent reading, keep the top
  // CHAR_LIMIT, then index every reading of each kept character.
  const bestFreq = new Map()
  for (const e of singles) {
    bestFreq.set(e.word, Math.max(bestFreq.get(e.word) ?? 0, e.freq))
  }
  const keptChars = new Set(
    [...bestFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CHAR_LIMIT)
      .map(([char]) => char)
  )

  const topWords = words.sort((a, b) => b.freq - a.freq).slice(0, WORD_LIMIT)

  // key -> Map(candidate -> freq), keeping the best frequency on duplicates.
  const index = new Map()
  const add = (key, text, freq) => {
    let cands = index.get(key)
    if (!cands) index.set(key, (cands = new Map()))
    cands.set(text, Math.max(cands.get(text) ?? 0, freq))
  }
  for (const e of singles) if (keptChars.has(e.word)) add(e.key, e.word, e.freq)
  for (const e of topWords) add(e.key, e.word, e.freq)

  const dict = {}
  for (const key of [...index.keys()].sort()) {
    dict[key] = [...index.get(key).entries()].sort((a, b) => b[1] - a[1]).map(([text]) => text)
  }
  return { dict, charCount: keptChars.size, wordCount: topWords.length }
}

const buf = await downloadRawDict()
const entries = parseRawDict(buf)
const { dict, charCount, wordCount } = buildDict(entries)

const json = JSON.stringify(dict)
await writeFile(outFile, json)

const bytes = Buffer.byteLength(json)
console.log(`parsed ${entries.length} raw entries`)
console.log(`kept ${charCount} chars + ${wordCount} words across ${Object.keys(dict).length} keys`)
console.log(`wrote ${outFile} (${bytes} bytes)`)

for (const [key, expected] of [
  ['nihao', '你好'],
  ['zhongguo', '中国'],
  ['de', '的'],
  ['shi', '是'],
]) {
  const top = dict[key]?.slice(0, 3) ?? []
  const mark = top[0] === expected ? 'ok' : 'UNEXPECTED'
  console.log(`sanity ${key}: [${top.join(', ')}] (${mark})`)
}
