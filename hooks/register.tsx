import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Reading, Unit } from '../types'
import { findStart, nextSpoken, splitUnits } from './text'

const reading = atom({ plugin: 'lazyreader', key: 'reading' } as const, null, {
  shape: 'reading-1',
})
const active = atom({ plugin: 'lazyreader', key: 'active' } as const, null)

type Options = {
  engine: 'edge-tts' | 'system'
  voice: string
  rate: string
  player: string
  autoRead: boolean
  speakerButton: boolean
}

const DEFAULTS: Options = {
  engine: 'edge-tts',
  voice: 'es-AR-TomasNeural',
  rate: '+10%',
  player: 'mpv --no-video --really-quiet',
  autoRead: false,
  speakerButton: true,
}

type Target = { requestId: string | null; text: string }
type Started = { index: number; isFromFragment: boolean; units: Unit[] }

/** What the session.start hook builds: the player, as closures over its `$`. */
type Player = {
  start: (requestId: string | null, text: string, fragment?: string) => Promise<Started | null>
  toggle: () => Promise<void>
  stop: () => Promise<void>
  step: (delta: 1 | -1) => Promise<void>
  pick: (fragment: string, selectedRow?: string) => Promise<Target | null>
  later: (ms: number, fn: () => Promise<void>) => void
}

export const register: Register = (on, rawOptions) => {
  const options: Options = { ...DEFAULTS, ...(rawOptions as Partial<Options>) }
  const playerArgv = options.player.trim().split(/\s+/).filter(Boolean)

  let player: Player | null = null
  // Each start, pause or stop bumps it; a loop of an older one stops.
  let generation = 0
  let child: AsyncGenerator<unknown, unknown> | null = null
  let workDir: string | null = null
  // Every reply block drawn, by row, newest last: what /read looks in.
  const blocks = new Map<string, string>()

  const remember = (requestId: string, text: string) => {
    blocks.delete(requestId)
    blocks.set(requestId, text)
    if (blocks.size > 400) blocks.delete(blocks.keys().next().value as string)
  }

  const killChild = () => {
    const running = child
    child = null
    if (running) void running.return(undefined).catch(() => undefined)
  }

  on('session.start', async ($, e, next) => {
    const say = (text: string) => {
      void $.ui.toast(`lazyreader: ${text}`)
    }

    const ensureDir = async () => {
      if (workDir) return workDir
      const made = await $.process.run(['mktemp', '-d', '-t', 'lazyreader.XXXXXX'])
      if (made.exitCode !== 0) throw new Error('mktemp failed')
      workDir = made.stdout.trim()

      return workDir
    }

    const cleanUp = () => {
      const dir = workDir
      workDir = null
      if (dir) void $.process.run(['rm', '-rf', dir]).catch(() => undefined)
    }

    const synthesize = async (text: string, file: string) => {
      const argv = [
        'edge-tts',
        `--voice=${options.voice}`,
        `--rate=${options.rate}`,
        `--text=${text}`,
        `--write-media=${file}`,
      ]
      const made = await $.process.run(argv, { timeoutMs: 60_000 })
      if (made.exitCode !== 0) {
        const why = made.stderr.trim().split('\n').pop() ?? ''
        throw new Error(`edge-tts failed${why ? `: ${why}` : ''}`)
      }

      return file
    }

    const playFile = async (file: string) => {
      const stream = $.process.spawn({ argv: [...playerArgv, file] })
      child = stream
      try {
        for await (const _piece of stream) {
          // The player's output is not needed; the loop is its life.
        }
      } finally {
        if (child === stream) child = null
      }
    }

    const setStatus = (gen: number, patch: Partial<Reading>) =>
      update($, reading, r => (r && gen === generation ? { ...r, ...patch } : r))

    const finish = async (gen: number) => {
      if (gen !== generation) return
      await update($, reading, () => null)
      await update($, active, () => null)
      cleanUp()
    }

    // Speaks from the reading's index to its end, one sentence at a time,
    // while the next one is already being synthesized.
    const run = async (gen: number) => {
      const begin = await read($, reading)
      if (!begin) return
      const { units } = begin
      const files = new Map<number, Promise<string>>()
      const fileFor = async (i: number) => {
        let made = files.get(i)
        if (!made) {
          const dir = await ensureDir()
          made = synthesize(units[i]?.speech ?? '', `${dir}/s-${gen}-${i}.mp3`)
          made.catch(() => undefined)
          files.set(i, made)
        }

        return made
      }

      try {
        let i = nextSpoken(units, begin.index)
        while (i !== null && gen === generation) {
          const after = nextSpoken(units, i + 1)
          await setStatus(gen, { index: i })

          if (options.engine === 'system') {
            await setStatus(gen, { status: 'playing' })
            await $.audio.speak(units[i]?.speech ?? '', options.voice ? { voice: options.voice } : undefined)
          } else {
            const file = await fileFor(i)
            if (after !== null) void fileFor(after).catch(() => undefined)
            if (gen !== generation) return
            await setStatus(gen, { status: 'playing' })
            await playFile(file)
            void $.process.run(['rm', '-f', file]).catch(() => undefined)
          }

          i = after
        }
        await finish(gen)
      } catch (error) {
        if (gen !== generation) return
        say(error instanceof Error ? error.message : String(error))
        await finish(gen)
      }
    }

    const play = () => {
      killChild()
      const gen = ++generation
      void run(gen)
    }

    const start = async (requestId: string | null, text: string, fragment?: string) => {
      const units = splitUnits(text)
      const at = fragment ? findStart(units, fragment) : 0
      const index = nextSpoken(units, at ?? 0)
      if (index === null) {
        say('nothing to read there')
        return null
      }
      killChild()
      generation++
      await update($, reading, () => ({ requestId, units, index, status: 'loading' as const }))
      await update($, active, () => requestId)
      play()

      return { index, isFromFragment: Boolean(fragment) && at !== null, units }
    }

    const toggle = async () => {
      const r = await read($, reading)
      if (!r) return
      killChild()
      generation++
      if (r.status === 'paused') {
        await update($, reading, now => now && { ...now, status: 'loading' as const })
        play()
      } else {
        await update($, reading, now => now && { ...now, status: 'paused' as const })
      }
    }

    const stop = async () => {
      killChild()
      generation++
      await update($, reading, () => null)
      await update($, active, () => null)
      cleanUp()
    }

    const step = async (delta: 1 | -1) => {
      const r = await read($, reading)
      if (!r) return
      let i = r.index + delta
      while (i >= 0 && i < r.units.length && r.units[i]?.speech === '') i += delta
      if (i < 0 || i >= r.units.length) return
      const wasPaused = r.status === 'paused'
      killChild()
      generation++
      await update($, reading, now => now && { ...now, index: i, status: wasPaused ? ('paused' as const) : ('loading' as const) })
      if (!wasPaused) play()
    }

    // Which reply to read: the selected row, the row holding the words
    // given, or the last reply.
    const pick = async (fragment: string, selectedRow?: string): Promise<Target | null> => {
      const selected = selectedRow ? blocks.get(selectedRow) : undefined
      if (selectedRow && selected !== undefined) return { requestId: selectedRow, text: selected }
      const newestFirst = [...blocks.entries()].reverse()
      if (fragment) {
        for (const [requestId, text] of newestFirst) {
          if (findStart(splitUnits(text), fragment) !== null) return { requestId, text }
        }
      }
      const messages = await $.session.messages()
      const last = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')
      if (!last) return null
      for (const [requestId, text] of newestFirst) {
        if (last.text.includes(text.trim())) return { requestId, text }
      }

      return { requestId: null, text: last.text }
    }

    const later = (ms: number, fn: () => Promise<void>) => {
      $.clock.after(ms, () => {
        void fn().catch(error => say(String(error)))
      })
    }

    player = { start, toggle, stop, step, pick, later }

    await $.command.register({
      name: 'read',
      description: 'Read aloud the last reply, or from the selected text or the words you type after it',
      argumentHint: '[words to start from]',
    })
    await $.command.register({ name: 'read-pause', description: 'Pause or resume the reading' })
    await $.command.register({ name: 'read-stop', description: 'Stop the reading' })

    return next(e)
  })

  on('command.run', { command: 'read' }, async ($, e) => {
    if (!player) return { text: 'lazyreader: not ready yet.' }
    let selected: { text: string; requestId?: string } | undefined
    try {
      selected = await $.ui.selection()
    } catch {
      selected = undefined
    }
    const typed = e.args.trim()
    const fragment = typed || selected?.text.trim() || ''
    const target = await player.pick(fragment, typed ? undefined : selected?.requestId)
    if (!target) return { text: 'lazyreader: there is no reply to read yet.' }

    const started = await player.start(target.requestId, target.text, fragment || undefined)
    if (!started) return { text: 'lazyreader: nothing to read there.' }
    const opening = (started.units[started.index]?.display ?? '').trim().slice(0, 60)
    const where = started.isFromFragment ? `from “${opening}”` : 'from the start'

    return { text: `lazyreader: reading ${where}. /read-pause pauses, /read-stop stops.` }
  })

  on('command.run', { command: 'read-pause' }, async $ => {
    await player?.toggle()
    const r = await read($, reading)

    return { text: r ? `lazyreader: ${r.status === 'paused' ? 'paused' : 'reading'}.` : 'lazyreader: nothing is being read.' }
  })

  on('command.run', { command: 'read-stop' }, async () => {
    await player?.stop()

    return { text: 'lazyreader: stopped.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const ready = player
    if (ready && options.autoRead && e.reason === 'answer' && !e.agentId && e.answer.trim() !== '') {
      // Let the transcript draw the reply first, so its row can be found.
      ready.later(600, async () => {
        const target = await ready.pick('')
        if (target) await ready.start(target.requestId, target.text)
      })
    }

    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const requestId = e.requestId
    const text = e.props.text
    if (!e.props.isSummary && text.trim() !== '') remember(requestId, text)

    const isActive = (await read($, active)) === requestId
    const current = isActive ? await read($, reading) : null
    const { Box, Button, Text } = $.ui.resolve(e)

    if (current && current.requestId === requestId) {
      const { units, index, status } = current
      const spoken = units.filter(u => u.speech !== '')
      const position = units.slice(0, index + 1).filter(u => u.speech !== '').length
      const label = status === 'paused' ? 'paused' : status === 'loading' ? 'loading…' : 'reading'

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="lr-prev" plain label="⏮" onPress={() => player?.step(-1)} />
            <Button key="lr-toggle" plain label={status === 'paused' ? '▶' : '⏸'} onPress={() => player?.toggle()} />
            <Button key="lr-next" plain label="⏭" onPress={() => player?.step(1)} />
            <Button key="lr-stop" plain label="⏹" onPress={() => player?.stop()} />
            <Text dimColor>
              {label} {position}/{spoken.length}
            </Text>
          </Box>
          <Text>
            {units.map((unit, i) => {
              if (unit.speech === '') {
                return (
                  <Text dimColor mono>
                    {unit.display}
                    {unit.sep}
                  </Text>
                )
              }
              if (i === index) {
                return (
                  <Text>
                    <Text color="claude" weight="bold" underline>
                      {unit.display}
                    </Text>
                    {unit.sep}
                  </Text>
                )
              }

              return (
                <Text dimColor={i < index}>
                  {unit.display}
                  {unit.sep}
                </Text>
              )
            })}
          </Text>
        </Box>
      )
    }

    if (!options.speakerButton || e.props.isSummary || text.trim() === '') return next(e)

    const drawn = await next(e)

    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Button key="lr-speak" plain dimColor label="🔊" onPress={() => player?.start(requestId, text)} />
        </Box>
      </Box>
    )
  })

  on('session.end', async ($, e, next) => {
    await player?.stop()

    return next(e)
  })
}
