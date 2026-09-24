import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { RunHistory } from './run-history'

const request = vi.fn()
const stop = vi.fn()
vi.mock('@/api/client', () => ({
  hermesApi: (...args: unknown[]) => request(...args),
  profileScoped: () => ({}),
  getApiRequestProfile: () => 'default'
}))
vi.mock('@/store/gateway', () => ({ requestGatewayForProfile: (...args: unknown[]) => stop(...args) }))

afterEach(() => { request.mockReset(); stop.mockReset() })

it('shows a persisted run, its timeline, and stops the selected session', async () => {
  request.mockImplementation(({ path }: { path: string }) => path.includes('/run?')
    ? Promise.resolve({ spans: [{ id: 'span', kind: 'execute_tool', name: 'repl', status: 'complete', started_at_ms: 1000, ended_at_ms: 2000, input_tokens: 0, output_tokens: 0, cost_usd: 0, error: null, input: null, output: null }], content: null })
    : Promise.resolve({ capture_content: false, dropped_events: 0, runs: [{ id: 'run', session_id: 'session', parent_id: null, root_id: 'run', kind: 'invoke_agent', model: 'local', provider: 'Ollama', status: 'running', started_at_ms: 1000, ended_at_ms: null, input_tokens: 2, output_tokens: 3, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, error: null }] }))
  stop.mockResolvedValue({ interrupted: true })
  render(<RunHistory />)
  expect(await screen.findByText('repl')).toBeTruthy()
  expect(screen.getByText('5')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
  await waitFor(() => expect(stop).toHaveBeenCalledWith('default', 'session.interrupt', { session_id: 'session' }))
})
