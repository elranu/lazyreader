/**
 * One piece of a reply as the reader shows and speaks it.
 */
export type Unit = {
  /** The text drawn, markdown marks removed. */
  display: string
  /** What is said; empty for a piece that is shown and skipped (a code block). */
  speech: string
  /** The whitespace drawn after the piece: a space, a line break, a blank line. */
  sep: string
}

export type ReadingStatus = 'loading' | 'playing' | 'paused' | 'done'

/**
 * The reply being read: which transcript row, its pieces, and where the voice is.
 */
export type Reading = {
  /** The AssistantMessage row it was read from; null when no row matched. */
  requestId: string | null
  units: Unit[]
  index: number
  status: ReadingStatus
}

declare module 'claude-code' {
  interface PluginState {
    lazyreader: {
      /** The reading in progress; null when nothing is being read. */
      reading: Shaped<Reading | null>
      /** The row being read, apart from `reading` so other rows redraw only when it moves. */
      active: string | null
    }
  }
}
