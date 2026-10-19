import type { Deck, DeckIR, Job, Project } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8010';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function createProject(name: string): Promise<Project> {
  return request<Project>('/api/v1/projects', { method: 'POST', body: JSON.stringify({ name }) });
}

export function createDeck(projectId: string, title: string, ir: DeckIR): Promise<Deck> {
  return request<Deck>('/api/v1/decks', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, title, ir }),
  });
}

export type AgentSession = {
  id: string;
  project_id: string;
  deck_id: string;
  status: string;
};

export type AgentRun = {
  id: string;
  session_id: string;
  deck_id: string;
  status: string;
  current_step?: string | null;
  error?: string | null;
};

export type AgentEvent = {
  event_type: string;
  sequence: number;
  payload: Record<string, any>;
};

export function updateDeck(deckId: string, payload: { title?: string; ir?: DeckIR }): Promise<Deck> {
  return request<Deck>(`/api/v1/decks/${deckId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function createAgentSession(projectId: string, deckId: string): Promise<AgentSession> {
  return request<AgentSession>('/api/v1/agent/sessions', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, deck_id: deckId }),
  });
}

export function sendAgentMessage(
  sessionId: string,
  content: string,
  attachments: Array<{ name: string; size: number; content_type: string }> = [],
): Promise<AgentRun> {
  return request<AgentRun>(`/api/v1/agent/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, attachments }),
  });
}

export function getAgentRun(runId: string): Promise<AgentRun> {
  return request<AgentRun>(`/api/v1/agent/runs/${runId}`);
}

export async function streamAgentEvents(
  runId: string,
  onEvent: (event: AgentEvent) => void,
): Promise<AgentRun> {
  const response = await fetch(`${API_BASE}/api/v1/agent/runs/${runId}/events`, {
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) {
    throw new Error((await response.text()) || `SSE request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const eventType = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const sequence = Number(frame.match(/^id:\s*(\d+)$/m)?.[1] ?? 0);
      const dataLine = frame.match(/^data:\s*(.*)$/m)?.[1] ?? '{}';
      if (eventType) onEvent({ event_type: eventType, sequence, payload: JSON.parse(dataLine) });
    }
    if (chunk.done) break;
  }
  return getAgentRun(runId);
}

export function generateDeck(deckId: string): Promise<Job> {
  return request<Job>(`/api/v1/decks/${deckId}/generate`, { method: 'POST' });
}

export function getJob(jobId: string): Promise<Job> {
  return request<Job>(`/api/v1/jobs/${jobId}`);
}

export function docsUrl(): string {
  return `${API_BASE}/docs`;
}

