import { getSettings } from './settings';

/*
 * Optional AI tools. Off by default. Uses YOUR Anthropic API key, sent
 * directly from this device to api.anthropic.com — nothing goes through any
 * other server. Text is only sent when you press an AI button.
 */

export interface Msg { role: 'user' | 'assistant'; content: string }

export async function askClaude(system: string, messages: Msg[], maxTokens = 1500): Promise<string> {
  const s = getSettings();
  if (!s.aiKey) throw new Error('Add your Anthropic API key in Settings → AI tools first.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.aiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: s.aiModel || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j?.error?.message ?? msg; } catch { /* */ }
    if (res.status === 401) msg = 'The API key was rejected. Check it in Settings → AI tools.';
    throw new Error(msg);
  }
  const j = await res.json();
  return (j.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim();
}

export const AI_SYSTEM = `You are a thoughtful, honest writing companion inside a novelist's private writing app.
Give specific, actionable feedback with short quotes from the text as evidence. Be encouraging but candid.
Never rewrite whole passages unless asked; the author writes the book. Use short headings and bullet points. Keep it under 400 words unless asked for more.`;
