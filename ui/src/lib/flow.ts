/**
 * Client for the installation flow (RFID → action rules).
 *  - Persistence lives in the cloud library (KV) via `library.getFlow`/`saveFlow`.
 *  - The runtime engine lives on the Pi's control-server; `apply` pushes the rules there so they
 *    take effect immediately, and `state` reports whether the engine is connected to MQTT.
 */
import { library, FlowRule } from './library'
import { controlBase } from './mapping'
export type { FlowRule, FlowWhen, FlowThen, FlowBlob } from './library'

async function ctl<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${controlBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) },
    credentials: 'include',
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j as any).error || `${path} failed (${r.status})`)
  }
  return r.json() as Promise<T>
}

export const flowApi = {
  loadRules: (projectId: string) => library.getFlow(projectId),
  saveRules: (rules: FlowRule[], projectId: string) => library.saveFlow(rules, projectId),
  apply: (rules: FlowRule[]) =>
    ctl<{ ok: true; ruleCount: number }>(`/api/flow/apply`, { method: 'POST', body: JSON.stringify({ rules }) }),
  state: () => ctl<{ rules: FlowRule[]; connected: boolean; ruleCount: number }>(`/api/flow`),
}
