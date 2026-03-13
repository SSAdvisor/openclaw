export const SESSION_LABEL_MAX_LENGTH = 64;

export const SESSION_DISPLAY_NAME_MAX_LENGTH = 128;

export type ParsedSessionLabel = { ok: true; label: string } | { ok: false; error: string };

export type ParsedSessionDisplayName =
  | { ok: true; displayName: string }
  | { ok: false; error: string };

export function parseSessionLabel(raw: unknown): ParsedSessionLabel {
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid label: must be a string" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "invalid label: empty" };
  }
  if (trimmed.length > SESSION_LABEL_MAX_LENGTH) {
    return {
      ok: false,
      error: `invalid label: too long (max ${SESSION_LABEL_MAX_LENGTH})`,
    };
  }
  return { ok: true, label: trimmed };
}

export function parseSessionDisplayName(raw: unknown): ParsedSessionDisplayName {
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid displayName: must be a string" };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "invalid displayName: empty" };
  }
  if (trimmed.length > SESSION_DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `invalid displayName: too long (max ${SESSION_DISPLAY_NAME_MAX_LENGTH})`,
    };
  }
  return { ok: true, displayName: trimmed };
}
