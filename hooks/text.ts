import type { Unit } from '../types'

const FENCE = /^\s*(```|~~~)/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const SENTENCE_END = /(?<=[.!?…])\s+(?=\S)/

/** Removes inline markdown marks, keeping the words. */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?=[^\w*]|$)/g, '$1$2')
    .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?=[^\w]|$)/g, '$1$2')
    .replace(/~~(\S(?:.*?\S)?)~~/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
}

/** What the voice says for a piece of shown text. */
export function toSpeech(display: string): string {
  return display
    .replace(/https?:\/\/\S+/g, 'enlace')
    .replace(/[•▸→]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}

function lineDisplay(line: string): string {
  const table = /^\s*\|(.*)\|\s*$/.exec(line)
  if (table) {
    return (table[1] ?? '')
      .split('|')
      .map(cell => stripInline(cell.trim()))
      .filter(Boolean)
      .join(' · ')
  }

  return stripInline(
    line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?/, '$1• ')
      .trimEnd(),
  )
}

/**
 * Splits a reply's markdown into the pieces the reader shows and speaks: one
 * per sentence, one per table row, one per code block (shown, not spoken).
 */
export function splitUnits(markdown: string): Unit[] {
  const units: Unit[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const endLine = (sep: string) => {
    const last = units[units.length - 1]
    if (last) last.sep = last.sep.includes('\n') && sep === '\n' ? last.sep : sep
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    if (FENCE.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) code.push(lines[i++] ?? '')
      units.push({ display: code.join('\n'), speech: '', sep: '\n' })
      continue
    }

    if (line.trim() === '') {
      endLine('\n\n')
      continue
    }

    if (TABLE_RULE.test(line) && line.includes('-')) continue

    const display = lineDisplay(line)
    if (display.trim() === '') continue

    const indent = /^\s*/.exec(display)?.[0] ?? ''
    const sentences = display.trim().split(SENTENCE_END)
    sentences.forEach((sentence, n) => {
      units.push({
        display: (n === 0 ? indent : '') + sentence,
        speech: toSpeech(sentence),
        sep: n === sentences.length - 1 ? '\n' : ' ',
      })
    })
  }

  const last = units[units.length - 1]
  if (last) last.sep = ''

  return units
}

function normalize(text: string): string {
  return stripInline(text)
    .toLowerCase()
    .replace(/[•·*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The index of the piece where `fragment` starts, or null when the reply
 * does not hold it. Tries the whole fragment, then its first words.
 */
export function findStart(units: Unit[], fragment: string): number | null {
  const parts = units.map(unit => normalize(unit.display))
  const joined = parts.join(' ')
  const wanted = normalize(fragment)
  if (wanted === '') return null

  const tries = [wanted, wanted.split(' ').slice(0, 6).join(' '), wanted.split(' ').slice(0, 3).join(' ')]
  for (const probe of tries) {
    const at = joined.indexOf(probe)
    if (at < 0) continue
    let offset = 0
    for (let i = 0; i < parts.length; i++) {
      const end = offset + (parts[i] ?? '').length
      if (at < end || i === parts.length - 1) return i
      offset = end + 1
    }
  }

  return null
}

/** The first piece at or after `index` that has something to say. */
export function nextSpoken(units: Unit[], index: number): number | null {
  for (let i = Math.max(0, index); i < units.length; i++) {
    if (units[i]?.speech) return i
  }

  return null
}
