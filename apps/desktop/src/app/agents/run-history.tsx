import { useEffect, useState } from 'react'

import { getApiRequestProfile, hermesApi, profileScoped } from '@/api/client'
import { requestGatewayForProfile } from '@/store/gateway'

interface Run {
  id: string
  session_id: string
  parent_id: string | null
  root_id: string
  kind: string
  model: string
  provider: string
  status: string
  started_at_ms: number
  ended_at_ms: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number | null
  error: string | null
}

interface Span {
  id: string
  kind: string
  name: string
  status: string
  started_at_ms: number
  ended_at_ms: number | null
  input_tokens: number
  output_tokens: number
  cost_usd: number | null
  error: string | null
  input: string | null
  output: string | null
}

const money = (value: number | null) => value === null ? 'unpriced' : value === 0 ? '$0' : `$${value.toFixed(4)}`
const grokEstimate = (input: number, output: number) => `$${((input * 2 + output * 6) / 1_000_000).toFixed(6)}`
const duration = (start: number, end: number | null) => `${((Math.max(start, end ?? Date.now()) - start) / 1000).toFixed(1)}s`
const time = (value: number) => new Date(value).toLocaleString()

const bar = (span: Span, run: Run) => {
  const total = Math.max(1, (run.ended_at_ms ?? Date.now()) - run.started_at_ms)
  const left = Math.max(0, Math.min(99, (span.started_at_ms - run.started_at_ms) / total * 100))
  const width = Math.max(1, Math.min(100 - left, ((span.ended_at_ms ?? Date.now()) - span.started_at_ms) / total * 100))

  return { left: `${left}%`, width: `${width}%` }
}

/** The run ledger belongs to the active Sovereign backend; older Hermes backends show a clear error. */
export function RunHistory() {
  const [runs, setRuns] = useState<Run[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [spans, setSpans] = useState<Span[]>([])
  const [content, setContent] = useState<{ input: string | null; output: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [captureContent, setCaptureContent] = useState(false)
  const [droppedEvents, setDroppedEvents] = useState(0)

  useEffect(() => {
    let live = true

    const load = async () => {
      try {
        const result = await hermesApi<{ runs: Run[]; capture_content: boolean; dropped_events: number }>({ ...profileScoped(), path: '/api/sovereign/observability/runs?limit=200' })

        if (!live) {return}
        setRuns(result.runs)
        setCaptureContent(result.capture_content)
        setDroppedEvents(result.dropped_events)
        setSelected(current => current ?? result.runs[0]?.id ?? null)
        setError(null)
      } catch (cause) {
        if (live) {setError(cause instanceof Error ? cause.message : 'Run history is unavailable')}
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 2000)

    return () => { live = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!selected) {return}
    let live = true

    const load = async () => {
      try {
        const detail = await hermesApi<{ spans: Span[]; content: { input: string | null; output: string | null } | null }>({
          ...profileScoped(), path: `/api/sovereign/observability/run?id=${encodeURIComponent(selected)}`
        })

        if (live) { setSpans(detail.spans); setContent(detail.content) }
      } catch (cause) {
        if (live) {setError(cause instanceof Error ? cause.message : 'Could not load run')}
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 2000)

    return () => { live = false; window.clearInterval(timer) }
  }, [selected])

  const run = runs.find(item => item.id === selected)
  const root = run ? runs.find(item => item.id === run.root_id) : null

  const byId = new Map(runs.map(item => [item.id, item]))

  const groupedRuns = [...runs].sort((a, b) => {
    const groupTime = (item: Run) => byId.get(item.root_id)?.started_at_ms ?? item.started_at_ms

    return groupTime(b) - groupTime(a) || Number(Boolean(a.parent_id)) - Number(Boolean(b.parent_id)) || a.started_at_ms - b.started_at_ms
  })

  const stop = async () => {
    if (!run) {return}
    setStopping(true)

    try {
      await requestGatewayForProfile(getApiRequestProfile() ?? 'default', 'session.interrupt', { session_id: run.session_id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop run')
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-[#ffffff] text-[#0a0a0a] sm:flex-row">
      <div aria-label="Runs" className="flex max-h-[38%] min-h-0 w-full shrink-0 flex-col overflow-y-auto border-b border-[#d5d9e2] sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r">
        <div className="px-4 py-3 text-sm font-semibold">Run history</div>
        <div className="px-4 pb-2 text-xs text-[#545454]">{captureContent ? 'Content capture on' : 'Content capture off'}</div>
        {droppedEvents > 0 && <p className="px-4 py-2 text-sm" role="alert">{droppedEvents} events missed</p>}
        {error && <p className="px-4 py-2 text-sm text-[#545454]" role="alert">{error}</p>}
        {runs.length === 0 && !error && <p className="px-4 py-2 text-sm text-[#545454]">No runs yet.</p>}
        {groupedRuns.map(item => (
          <button
            aria-current={item.id === selected ? 'true' : undefined}
            className={`w-full py-3 pr-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0a0a0a] ${item.parent_id ? 'pl-7' : 'pl-4'} ${item.id === selected ? 'bg-[#f2ede5]' : 'hover:bg-[#f9f8f6]'}`}
            key={item.id}
            onClick={() => { setSelected(item.id); setSpans([]); setContent(null) }}
            type="button"
          >
            <span className="flex items-center justify-between gap-2 text-sm font-medium"><span className="truncate">{item.parent_id ? '↳ Agent' : 'Run'}</span><span className="shrink-0 text-xs text-[#545454]">{item.status}</span></span>
            <span className="mt-1 block truncate text-xs text-[#545454]">{time(item.started_at_ms)} · {item.model}</span>
          </button>
        ))}
      </div>
      {run ? <div aria-label="Run detail" className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-base font-semibold">{run.parent_id ? 'Agent' : 'Run'} · {run.status}</h3><p className="mt-1 text-xs text-[#545454]">{time(run.started_at_ms)} · {run.provider} / {run.model}</p></div>
          {(run.status === 'running' || run.status === 'queued' || run.status === 'spawned') && <button className="rounded-md bg-[#0a0a0a] px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={stopping} onClick={() => void stop()} type="button">{stopping ? 'Stopping…' : 'Stop run'}</button>}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4 bg-[#f9f8f6] p-4 text-sm">
          <div><div className="text-xs text-[#545454]">Duration</div><div className="mt-1 font-medium">{duration(run.started_at_ms, run.ended_at_ms)}</div></div>
          <div><div className="text-xs text-[#545454]">Tokens</div><div className="mt-1 font-medium">{(run.input_tokens + run.output_tokens).toLocaleString()}</div><div className="mt-1 text-xs text-[#545454]">{run.input_tokens.toLocaleString()} in · {run.output_tokens.toLocaleString()} out<br />{run.cache_read_tokens.toLocaleString()} cache read · {run.cache_write_tokens.toLocaleString()} write</div></div>
          <div>{run.provider.toLowerCase() === 'ollama' ? <><div className="text-xs text-[#545454]">Grok 4.7 xHigh estimate</div><div className="mt-1 font-medium">{grokEstimate(run.input_tokens, run.output_tokens)}</div><div className="mt-1 text-xs text-[#545454]">Actual API cost {money(run.cost_usd)}</div></> : <><div className="text-xs text-[#545454]">API cost</div><div className="mt-1 font-medium">{money(run.cost_usd)}</div></>}</div>
        </div>
        {root && root.id !== run.id && <button className="mt-4 text-sm text-[#3b3b3b] hover:text-[#0a0a0a]" onClick={() => { setSelected(root.id); setSpans([]); setContent(null) }} type="button">View parent run: {root.session_id}</button>}
        {run.error && <p className="mt-4 rounded-md bg-[#f2ede5] p-3 text-sm" role="alert">{run.error}</p>}
        <h4 className="mt-6 text-sm font-semibold">Timeline</h4>
        {spans.length === 0 && <p className="mt-2 text-sm text-[#545454]">No events recorded.</p>}
        <ol className="mt-2 space-y-1">
          {spans.map(span => <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 bg-[#f9f8f6] px-3 py-2" key={span.id}>
            <span className="min-w-0 truncate text-sm">{span.kind === 'chat' ? 'Model call' : span.name}</span><span className="text-xs text-[#545454]">{duration(span.started_at_ms, span.ended_at_ms)}</span>
            <span className="text-xs text-[#545454]">{span.status} · {(span.input_tokens + span.output_tokens).toLocaleString()} tokens · {span.kind === 'execute_tool' ? '$0' : money(span.cost_usd)}</span>
            <span aria-hidden className="col-span-2 mt-2 block h-1 rounded-sm bg-[#f2ede5]"><span className="relative block h-full rounded-sm bg-[#0a0a0a]" style={bar(span, run)} /></span>
            {span.error && <span className="col-span-2 mt-1 text-xs text-[#545454]">{span.error}</span>}
            {(span.input || span.output) && <details className="col-span-2 mt-1 text-xs"><summary className="cursor-pointer">Content</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{span.input}{span.output ? `\n${span.output}` : ''}</pre></details>}
          </li>) }
        </ol>
        {(content?.input || content?.output) && <details className="mt-5 text-sm"><summary className="cursor-pointer">Turn content</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words bg-[#f9f8f6] p-3 text-xs">{content.input}{content.output ? `\n${content.output}` : ''}</pre></details>}
      </div> : <div className="flex flex-1 items-center justify-center p-6 text-sm text-[#545454]">Select a run</div>}
    </div>
  )
}
