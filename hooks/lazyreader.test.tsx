import { expect, test } from 'claude-code/testing'

import { findStart, nextSpoken, splitUnits } from './text'

const REPLY = [
  '## Resumen',
  '',
  'Se puede hacer. El **resaltado** va por frase.',
  '',
  '- Primer punto con `código`.',
  '- Segundo punto, ver [la doc](https://example.com).',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| uno | dos |',
].join('\n')

test('a reply splits into sentences, list items, a code block and table rows', () => {
  const units = splitUnits(REPLY)

  expect(units.map(u => u.display)).toEqual([
    'Resumen',
    'Se puede hacer.',
    'El resaltado va por frase.',
    '• Primer punto con código.',
    '• Segundo punto, ver la doc.',
    'const x = 1',
    'a · b',
    'uno · dos',
  ])
  expect(units[5]?.speech).toBe('')
  expect(units[3]?.speech).toBe(', Primer punto con código.')
  expect(units[1]?.sep).toBe(' ')
  expect(units[2]?.sep).toBe('\n\n')
})

test('the start is found from a fragment, markdown or not', () => {
  const units = splitUnits(REPLY)

  expect(findStart(units, 'el **resaltado** va')).toBe(2)
  expect(findStart(units, 'Segundo punto, ver la doc')).toBe(4)
  expect(findStart(units, 'nada de esto aparece')).toBeNull()
  expect(nextSpoken(units, 5)).toBe(6)
})

const block = (requestId: string, text: string) =>
  ({
    plugin: 'lazyreader',
    component: 'AssistantMessage',
    requestId,
    props: { text, isFirstOfReply: true },
  }) as const

test('each reply gets a speaker button; a failed voice says why and puts the reply back', async ($, on) => {
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'read' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'no audio here', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...block('m1', REPLY), surface })
    expect(await ui.find({ key: 'lr-speak' })).toBeDefined()

    await ui.press({ key: 'lr-speak' })
    expect(await ui.find({ key: 'lr-toggle' })).toBeUndefined()
    expect(await ui.find({ key: 'lr-speak' })).toBeDefined()
    await ui.unmount()
  }
  expect(toasts.some(text => text.includes('mktemp failed'))).toBe(true)
})

test('the row being read is drawn as the reader, the current sentence apart', async ($, on) => {
  const units = splitUnits(REPLY)
  on('state.get', (_, e) => {
    if (e.key === 'active') return { value: { value: 'm1', version: 1 } }
    if (e.key === 'reading') {
      return {
        value: {
          value: { shape: 'reading-1', value: { requestId: 'm1', units, index: 2, status: 'paused' } },
          version: 1,
        },
      }
    }
    return { value: { value: undefined, version: 0 } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...block('m1', REPLY), surface })
    expect(await ui.find({ key: 'lr-toggle' })).toBeDefined()
    expect(await ui.find({ key: 'lr-speak' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /paused 3\/7/ }))?.text).toContain("paused 3/7")
    await ui.unmount()

    const other = await $.ui.mount({ ...block('m2', 'Otra respuesta.'), surface })
    expect(await other.find({ key: 'lr-toggle' })).toBeUndefined()
    await other.unmount()
  }
})
