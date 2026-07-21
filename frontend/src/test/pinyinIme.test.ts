import { beforeEach, describe, expect, it, vi } from 'vitest'

type PinyinIme = typeof import('../utils/pinyinIme')

// Small inline dictionary so tests do not depend on the generated JSON.
const MOCK_DICT: Record<string, string[]> = {
  de: ['的', '得', '地'],
  ni: ['你', '尼', '泥'],
  hao: ['好', '号'],
  ma: ['吗', '马'],
  ren: ['人'],
  nihao: ['你好'],
  zhong: ['中'],
  guo: ['国'],
  zhongguo: ['中国'],
  zhonghua: ['中华'],
  shiji: ['世纪'],
  shijie: ['世界'],
  mama: ['妈妈', '马'],
  lue: ['略'],
}

function stubFetch(response: () => Promise<unknown>) {
  const fetchMock = vi.fn(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubFetchWithDict(dict: unknown) {
  return stubFetch(async () => ({ ok: true, json: async () => dict }))
}

// The engine caches the dictionary in module state, so each test gets a fresh
// module instance via resetModules + dynamic import.
async function loadIme(): Promise<PinyinIme> {
  vi.resetModules()
  return import('../utils/pinyinIme')
}

async function loadImeWithDict(dict: unknown = MOCK_DICT): Promise<PinyinIme> {
  stubFetchWithDict(dict)
  const ime = await loadIme()
  await ime.ensureDictLoaded()
  return ime
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('ensureDictLoaded', () => {
  it('loads the dictionary and reports ready', async () => {
    const fetchMock = stubFetchWithDict(MOCK_DICT)
    const ime = await loadIme()
    expect(ime.isDictReady()).toBe(false)
    await ime.ensureDictLoaded()
    expect(ime.isDictReady()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/assets/pinyin-dict.json')
  })

  it('is idempotent: repeated calls fetch only once', async () => {
    const fetchMock = stubFetchWithDict(MOCK_DICT)
    const ime = await loadIme()
    await Promise.all([ime.ensureDictLoaded(), ime.ensureDictLoaded()])
    await ime.ensureDictLoaded()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resolves on fetch failure and leaves the dict empty', async () => {
    stubFetch(async () => {
      throw new Error('offline')
    })
    const ime = await loadIme()
    await expect(ime.ensureDictLoaded()).resolves.toBeUndefined()
    expect(ime.isDictReady()).toBe(false)
    expect(ime.queryCandidates('nihao')).toEqual([])
  })

  it('treats a non-ok response as an empty dict', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }))
    const ime = await loadIme()
    await ime.ensureDictLoaded()
    expect(ime.isDictReady()).toBe(false)
    expect(ime.queryCandidates('de')).toEqual([])
  })
})

describe('queryCandidates: exact lookup', () => {
  it('returns word candidates for an exact multi-syllable key', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('nihao')[0]).toBe('你好')
    expect(ime.queryCandidates('zhongguo')[0]).toBe('中国')
  })

  it('preserves frequency order for single-syllable char candidates', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('de')).toEqual(['的', '得', '地'])
  })

  it('ignores apostrophe separators and case', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates("Ni'Hao")[0]).toBe('你好')
  })

  it('maps the lve spelling of ü to the lue key', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('lve')).toEqual(['略'])
  })
})

describe('queryCandidates: prefix lookup', () => {
  it('matches keys the buffer is a prefix of', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('nih')).toContain('你好')
  })

  it('lists exact matches before prefix completions', async () => {
    const ime = await loadImeWithDict()
    const result = ime.queryCandidates('zhong')
    expect(result[0]).toBe('中')
    expect(result).toContain('中国')
    expect(result).toContain('中华')
  })

  it('prefers shorter (more complete) keys among prefix matches', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('shij')).toEqual(['世纪', '世界'])
  })

  it('dedupes candidates that appear under several keys', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('ma')).toEqual(['吗', '马', '妈妈'])
  })
})

describe('queryCandidates: segmentation fallback', () => {
  it('falls back to the longest leading word when the whole buffer has no match', async () => {
    const ime = await loadImeWithDict()
    // "nihaoma" segments to ni/hao/ma; there is no nihaoma key.
    expect(ime.queryCandidates('nihaoma')).toEqual(['你好'])
  })

  it('segments greedily across several syllables', async () => {
    const ime = await loadImeWithDict()
    // zhong/guo/ren: no zhongguoren key, zhongguo is the longest leading match.
    expect(ime.queryCandidates('zhongguoren')).toEqual(['中国'])
  })

  it('falls back to single-char candidates when the tail is unparseable', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('nizzz')).toEqual(['你', '尼', '泥'])
  })
})

describe('queryCandidates: empty and garbage input', () => {
  it('returns [] for empty and non-letter input', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('')).toEqual([])
    expect(ime.queryCandidates("12!@' ")).toEqual([])
  })

  it('returns [] for input that is not valid pinyin', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('zzz')).toEqual([])
    expect(ime.queryCandidates('vvvv')).toEqual([])
  })

  it('is safe against Object.prototype key names', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('constructor')).toEqual([])
    expect(ime.queryCandidates('hasownproperty')).toEqual([])
  })

  it('returns [] before the dictionary has loaded', async () => {
    stubFetchWithDict(MOCK_DICT)
    const ime = await loadIme()
    expect(ime.queryCandidates('nihao')).toEqual([])
  })
})

describe('queryCandidates: limit', () => {
  it('honors a custom limit', async () => {
    const ime = await loadImeWithDict()
    expect(ime.queryCandidates('de', 2)).toEqual(['的', '得'])
    expect(ime.queryCandidates('ma', 1)).toEqual(['吗'])
  })

  it('defaults to at most 40 candidates', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`yi${'i'.repeat(i)}`, [`字${i}`]])
    )
    const ime = await loadImeWithDict({ ...many, yi: ['一'] })
    expect(ime.queryCandidates('yi').length).toBe(40)
  })
})
