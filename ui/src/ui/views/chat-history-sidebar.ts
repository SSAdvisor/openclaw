/**
 * Chat History Sidebar — shows session list with new-chat, search, rename, switch.
 *
 * Renders on the LEFT side of the chat view (distinct from the existing right-side
 * markdown/tool-output sidebar).
 *
 * @see https://github.com/openclaw/openclaw/issues/19214
 * @see https://github.com/openclaw/openclaw/issues/29563
 */

import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { icons } from "../icons.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";
import { isCronSessionKey, resolveSessionDisplayName } from "../app-render.helpers.ts";

export type ChatHistorySidebarProps = {
  open: boolean;
  sessions: SessionsListResult | null;
  currentSessionKey: string;
  hideCron: boolean;
  searchQuery: string;
  renamingKey: string | null;
  renameValue: string;
  connected: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSessionSelect: (key: string) => void;
  onSearchChange: (query: string) => void;
  onRenameStart: (key: string, currentName: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
};

function formatRelativeTime(ts: number | null): string {
  if (!ts) {
    return "";
  }
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w ago`;
  }
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
}

function filterSessions(
  sessions: GatewaySessionRow[],
  hideCron: boolean,
  searchQuery: string,
): GatewaySessionRow[] {
  let filtered = sessions;

  if (hideCron) {
    filtered = filtered.filter((s) => !isCronSessionKey(s.key));
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter((s) => {
      const name = resolveSessionDisplayName(s.key, s).toLowerCase();
      return name.includes(q) || s.key.toLowerCase().includes(q);
    });
  }

  // Sort by updatedAt descending (most recent first)
  return [...filtered].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function renderSessionItem(
  row: GatewaySessionRow,
  isActive: boolean,
  isRenaming: boolean,
  renameValue: string,
  props: ChatHistorySidebarProps,
): TemplateResult {
  const displayName = resolveSessionDisplayName(row.key, row);
  const relTime = formatRelativeTime(row.updatedAt);

  if (isRenaming) {
    return html`
      <div class="history-session-item history-session-item--active" data-key=${row.key}>
        <div class="history-session-item__rename">
          <input
            class="history-session-item__rename-input"
            type="text"
            .value=${renameValue}
            @input=${(e: Event) => props.onRenameChange((e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                props.onRenameConfirm();
              } else if (e.key === "Escape") {
                props.onRenameCancel();
              }
            }}
            @blur=${() => props.onRenameConfirm()}
          />
        </div>
      </div>
    `;
  }

  return html`
    <div
      class="history-session-item ${isActive ? "history-session-item--active" : ""}"
      data-key=${row.key}
      @click=${() => {
        if (!isActive) {
          props.onSessionSelect(row.key);
        }
      }}
      @dblclick=${() => props.onRenameStart(row.key, displayName)}
    >
      <div class="history-session-item__content">
        <div class="history-session-item__name" title=${row.key}>${displayName}</div>
        ${relTime ? html`<div class="history-session-item__time">${relTime}</div>` : nothing}
      </div>
      <button
        class="history-session-item__rename-btn"
        title="Rename session"
        @click=${(e: Event) => {
          e.stopPropagation();
          props.onRenameStart(row.key, displayName);
        }}
      >
        ${icons.edit ?? html`<span style="font-size:12px">✏️</span>`}
      </button>
    </div>
  `;
}

export function renderChatHistorySidebar(props: ChatHistorySidebarProps): TemplateResult | typeof nothing {
  if (!props.open) {
    return nothing;
  }

  const rows = props.sessions?.sessions ?? [];
  const filtered = filterSessions(rows, props.hideCron, props.searchQuery);

  return html`
    <div class="chat-history-sidebar">
      <div class="chat-history-sidebar__header">
        <button
          class="btn btn--sm chat-history-sidebar__new-btn"
          title="New Chat"
          ?disabled=${!props.connected}
          @click=${props.onNewChat}
        >
          + New Chat
        </button>
        <button
          class="btn btn--icon chat-history-sidebar__close-btn"
          title="Close history"
          @click=${props.onToggle}
        >
          ${icons.x}
        </button>
      </div>

      <div class="chat-history-sidebar__search">
        <input
          class="chat-history-sidebar__search-input"
          type="text"
          placeholder="Search sessions..."
          .value=${props.searchQuery}
          @input=${(e: Event) => props.onSearchChange((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="chat-history-sidebar__list">
        ${
          filtered.length === 0
            ? html`<div class="chat-history-sidebar__empty">
                ${props.searchQuery.trim() ? "No matching sessions" : "No sessions yet"}
              </div>`
            : repeat(
                filtered,
                (row) => row.key,
                (row) =>
                  renderSessionItem(
                    row,
                    row.key === props.currentSessionKey,
                    props.renamingKey === row.key,
                    props.renameValue,
                    props,
                  ),
              )
        }
      </div>
    </div>
  `;
}

/**
 * Renders just the toggle button for the chat header area.
 */
export function renderHistorySidebarToggle(props: { open: boolean; onToggle: () => void }): TemplateResult {
  return html`
    <button
      class="btn btn--icon chat-history-toggle"
      title="${props.open ? "Hide chat history" : "Show chat history"}"
      @click=${props.onToggle}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="18" rx="1"></rect>
        <line x1="14" y1="6" x2="21" y2="6"></line>
        <line x1="14" y1="12" x2="21" y2="12"></line>
        <line x1="14" y1="18" x2="21" y2="18"></line>
      </svg>
    </button>
  `;
}
