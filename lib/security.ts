const TOKEN_PATTERN = /(Bearer\s+)?[A-Za-z0-9\-._~+/=]{20,}/g;

export function redactToken(value: string): string {
  return value.replace(TOKEN_PATTERN, (match) => {
    const prefix = match.startsWith('Bearer ') ? 'Bearer ' : '';
    return `${prefix}[REDACTED_TOKEN]`;
  });
}

export function sanitizeFolderId(folderId: string): string {
  const trimmed = folderId.trim();
  if (!/^[A-Za-z0-9_-]{3,140}$/.test(trimmed)) {
    throw new Error('Folder ID format is invalid.');
  }
  return trimmed;
}

export function sanitizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Quip API base URL is invalid.');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Quip API base URL must start with http:// or https://');
  }

  url.pathname = '';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

export function sanitizeFilename(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return safe || 'export';
}

export function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactToken(message);
}

export function userFacingError(message: string): string {
  if (/verify_token|invalid token|unauthorized|401/i.test(message)) {
    return 'Token validation failed. Please check your bearer token.';
  }

  if (/folder/i.test(message) && /404|not found|invalid/i.test(message)) {
    return 'Folder not found. Please verify the folder ID and API base URL.';
  }

  if (/no exportable threads/i.test(message)) {
    return 'No exportable documents or spreadsheets were found in this folder.';
  }

  if (/429|rate/i.test(message)) {
    return 'Quip rate limit reached. Please wait a moment and retry.';
  }

  return 'Export failed. Please verify inputs and try again.';
}
