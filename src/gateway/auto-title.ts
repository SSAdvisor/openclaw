/**
 * Auto-title generation for webchat sessions.
 *
 * After the first user↔assistant exchange, generates a short LLM-based title
 * and persists it as `displayName` on the session entry.
 *
 * Design:
 * - Fire-and-forget: never blocks or delays chat responses
 * - Uses the configured model via the existing pi-embedded-runner infrastructure
 * - Graceful degradation: falls back silently on any error
 *
 * @see https://github.com/openclaw/openclaw/issues/22761
 */

import { resolveAgentDir, resolveSessionAgentId } from "../agents/agent-scope.js";
import { resolveApiKeyForProvider } from "../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { updateSessionStore } from "../config/sessions/store.js";
import { parseSessionDisplayName } from "../sessions/session-label.js";

const AUTO_TITLE_MAX_TOKENS = 30;
const AUTO_TITLE_TIMEOUT_MS = 15_000;

const AUTO_TITLE_SYSTEM_PROMPT = `You are a title generator. Given the first message exchange in a conversation, generate a concise 3-8 word title that captures the topic. Rules:
- Return ONLY the title text, nothing else
- No quotes, no punctuation at the end
- No prefixes like "Title:" or "Topic:"
- Use title case
- Be specific but brief`;

/**
 * Attempt to generate a short title from the first user↔assistant exchange
 * by calling the configured LLM provider directly.
 */
export async function generateSessionAutoTitle(params: {
  userMessage: string;
  assistantReply: string;
  cfg: OpenClawConfig;
  agentId?: string;
}): Promise<string | null> {
  const { userMessage, assistantReply, cfg, agentId } = params;

  // Truncate inputs to avoid sending huge payloads for title generation
  const maxInputLen = 500;
  const userSnippet = userMessage.slice(0, maxInputLen);
  const assistantSnippet = assistantReply.slice(0, maxInputLen);

  const resolvedAgentId = agentId ?? "main";
  const { provider, model } = resolveDefaultModelForAgent({ cfg, agentId: resolvedAgentId });
  const agentDir = resolveAgentDir(cfg, resolvedAgentId);

  const resolved = resolveModel(provider, model, agentDir, cfg);
  if (resolved.error || !resolved.model) {
    return null;
  }

  const baseUrl = (resolved.model.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    return null;
  }

  let apiKey: string;
  try {
    const auth = await resolveApiKeyForProvider({ provider, cfg, agentDir });
    if (!auth.apiKey) {
      return null;
    }
    apiKey = auth.apiKey;
  } catch {
    return null;
  }

  const api = resolved.model.api ?? "openai";
  const isAnthropic = api === "anthropic" || provider.toLowerCase().includes("anthropic");

  try {
    if (isAnthropic) {
      return await callAnthropicTitle({
        baseUrl,
        apiKey,
        model: resolved.model.id,
        userSnippet,
        assistantSnippet,
      });
    }
    return await callOpenAICompatTitle({
      baseUrl,
      apiKey,
      model: resolved.model.id,
      userSnippet,
      assistantSnippet,
    });
  } catch {
    return null;
  }
}

async function callOpenAICompatTitle(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  userSnippet: string;
  assistantSnippet: string;
}): Promise<string | null> {
  const { baseUrl, apiKey, model, userSnippet, assistantSnippet } = params;
  const endpoint = `${baseUrl}/chat/completions`;

  const body = {
    model,
    messages: [
      { role: "system", content: AUTO_TITLE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `User: ${userSnippet}\n\nAssistant: ${assistantSnippet}`,
      },
    ],
    max_tokens: AUTO_TITLE_MAX_TOKENS,
    temperature: 0.3,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AUTO_TITLE_TIMEOUT_MS),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return cleanTitle(data.choices?.[0]?.message?.content);
}

async function callAnthropicTitle(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  userSnippet: string;
  assistantSnippet: string;
}): Promise<string | null> {
  const { baseUrl, apiKey, model, userSnippet, assistantSnippet } = params;
  const endpoint = `${baseUrl}/v1/messages`;

  const body = {
    model,
    system: AUTO_TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `User: ${userSnippet}\n\nAssistant: ${assistantSnippet}`,
      },
    ],
    max_tokens: AUTO_TITLE_MAX_TOKENS,
    temperature: 0.3,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AUTO_TITLE_TIMEOUT_MS),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  return cleanTitle(text);
}

/**
 * Clean up the raw LLM output into a usable title.
 */
function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  let cleaned = raw
    .trim()
    .replace(/^["']|["']$/g, "") // strip surrounding quotes
    .replace(/^(Title|Topic|Subject):\s*/i, "") // strip common prefixes
    .replace(/[.!?]+$/, "") // strip trailing punctuation
    .trim();

  // Enforce reasonable length
  if (cleaned.length > 60) {
    cleaned = cleaned.slice(0, 57) + "...";
  }
  if (cleaned.length < 2) {
    return null;
  }
  return cleaned;
}

/**
 * Fire-and-forget auto-title for a session.
 * Called after the first user↔assistant exchange completes.
 */
export async function maybeAutoTitleSession(params: {
  sessionKey: string;
  storePath: string;
  entry: SessionEntry | undefined;
  userMessage: string;
  assistantReply: string;
  cfg: OpenClawConfig;
  agentId?: string;
  log?: { info?: (message: string, meta?: Record<string, unknown>) => void; warn?: (message: string, meta?: Record<string, unknown>) => void; [k: string]: unknown };
  onTitleSet?: (title: string) => void;
}): Promise<void> {
  const { sessionKey, storePath, entry, userMessage, assistantReply, cfg, agentId, log } = params;

  // Skip if session already has a displayName
  if (entry?.displayName?.trim()) {
    return;
  }

  // Skip if the user message or assistant reply is too short to generate a meaningful title
  if (!userMessage.trim() || !assistantReply.trim()) {
    return;
  }

  // Skip commands — titles for "/status" or "/help" aren't useful
  if (userMessage.trim().startsWith("/")) {
    return;
  }

  try {
    const title = await generateSessionAutoTitle({
      userMessage,
      assistantReply,
      cfg,
      agentId,
    });

    if (!title) {
      return;
    }

    // Validate the title format
    const parsed = parseSessionDisplayName(title);
    if (!parsed.ok) {
      log?.warn?.(`auto-title: generated title failed validation: ${parsed.error}`);
      return;
    }

    // Persist the title
    await updateSessionStore(storePath, (store) => {
      const storeEntry = store[sessionKey];
      if (!storeEntry) {
        return;
      }
      // Double-check: don't overwrite if someone set a displayName in the meantime
      if (storeEntry.displayName?.trim()) {
        return;
      }
      storeEntry.displayName = parsed.displayName;
      storeEntry.updatedAt = Date.now();
    });

    log?.info?.(`auto-title: set title for ${sessionKey}: "${title}"`);
    params.onTitleSet?.(title);
  } catch (err) {
    log?.warn?.(`auto-title: failed for ${sessionKey}: ${String(err)}`);
  }
}
