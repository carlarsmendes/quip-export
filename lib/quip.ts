import { redactedErrorMessage } from './security';
import { ExportResultItem, FailureItem } from './types';

const RETRIABLE = new Set([429, 500, 502, 503, 504]);
type JsonRecord = Record<string, unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
  retries = 4
): Promise<T> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const reason = bodyText.slice(0, 500);
        const message = `HTTP ${response.status} from ${url}: ${reason}`;

        if (RETRIABLE.has(response.status) && attempt < retries) {
          await sleep(Math.min(1000 * 2 ** attempt, 6000));
          continue;
        }

        throw new Error(message);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = redactedErrorMessage(error);
      if (attempt < retries) {
        await sleep(Math.min(1000 * 2 ** attempt, 6000));
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(lastError ?? 'Unknown API error');
}

function authHeaders(token: string, contentType = true): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };

  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

export async function verifyToken(baseUrl: string, token: string): Promise<void> {
  await requestJsonWithRetry(`${baseUrl}/1/oauth/verify_token`, {
    method: 'GET',
    headers: authHeaders(token, false)
  }, 10000, 2);
}

export interface FolderReadResult {
  threadIds: string[];
  threadTitles: Record<string, string>;
  threadPaths: Record<string, string[]>;
  foldersScanned: number;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : undefined;
}

function asRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => Boolean(item));
}

function getField(record: JsonRecord | undefined, key: string): unknown {
  return record?.[key];
}

function parseChildren(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (!root) return [];

  const direct = asRecordArray(getField(root, 'children'));
  if (direct.length) return direct;

  const folder = asRecord(getField(root, 'folder'));
  const folderChildren = asRecordArray(getField(folder, 'children'));
  if (folderChildren.length) return folderChildren;

  const response = asRecord(getField(root, 'response'));
  const responseChildren = asRecordArray(getField(response, 'children'));
  if (responseChildren.length) return responseChildren;

  return [];
}

function parseFolderName(payload: unknown, folderId: string): string {
  const root = asRecord(payload);
  const folder = asRecord(getField(root, 'folder'));
  return (
    readString(
      getField(folder, 'title'),
      getField(folder, 'name'),
      getField(root, 'title'),
      getField(root, 'name')
    ) ?? folderId
  );
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isFolder(item: JsonRecord): boolean {
  const type = String(getField(item, 'type') ?? getField(item, 'item_type') ?? getField(item, 'kind') ?? '').toLowerCase();
  return type === 'folder' || Boolean(getField(item, 'folder_id') && !getField(item, 'thread_id'));
}

function isThreadLike(item: JsonRecord): boolean {
  const type = String(getField(item, 'type') ?? getField(item, 'item_type') ?? getField(item, 'kind') ?? '').toLowerCase();
  return (
    type === 'document' ||
    type === 'spreadsheet' ||
    type === 'thread' ||
    Boolean(getField(item, 'thread_id'))
  );
}

export async function readFolderTree(
  baseUrl: string,
  token: string,
  rootFolderId: string,
  recurseSubfolders: boolean
): Promise<FolderReadResult> {
  const visited = new Set<string>();
  const foldersToScan: Array<{ folderId: string; parentPath: string[] }> = [{ folderId: rootFolderId, parentPath: [] }];
  const threads = new Set<string>();
  const threadTitles = new Map<string, string>();
  const threadPaths = new Map<string, string[]>();

  while (foldersToScan.length) {
    const folderEntry = foldersToScan.pop();
    const folderId = folderEntry?.folderId;
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);

    const payload = await requestJsonWithRetry<unknown>(`${baseUrl}/1/folders/${encodeURIComponent(folderId)}`, {
      method: 'GET',
      headers: authHeaders(token, false)
    });

    const currentFolderName = parseFolderName(payload, folderId);
    const currentPath = [...(folderEntry?.parentPath ?? []), currentFolderName];
    const children = parseChildren(payload);

    for (const child of children) {
      if (isFolder(child) && recurseSubfolders) {
        const subFolderId = readString(getField(child, 'folder_id'), getField(child, 'id'));
        if (subFolderId && !visited.has(subFolderId)) {
          foldersToScan.push({
            folderId: subFolderId,
            parentPath: currentPath
          });
        }
        continue;
      }

      if (isThreadLike(child)) {
        const threadId = readString(getField(child, 'thread_id'), getField(child, 'id'));
        if (threadId) {
          threads.add(threadId);
          const threadTitle = readString(
            getField(child, 'title'),
            getField(child, 'name'),
            getField(child, 'thread_title')
          );
          if (threadTitle && !threadTitles.has(threadId)) {
            threadTitles.set(threadId, threadTitle);
          }
          if (!threadPaths.has(threadId)) {
            threadPaths.set(threadId, [...currentPath]);
          }
        }
      }
    }
  }

  return {
    threadIds: Array.from(threads),
    threadTitles: Object.fromEntries(threadTitles.entries()),
    threadPaths: Object.fromEntries(threadPaths.entries()),
    foldersScanned: visited.size
  };
}

export async function submitBulkExport(
  baseUrl: string,
  token: string,
  threadIds: string[],
  includeConversations: boolean
): Promise<string> {
  const body = {
    threads: threadIds.map((threadId) => ({ thread_id: threadId, format: 'DOCX' })),
    include_conversations: includeConversations,
    locale: 'en-US'
  };

  const payload = await requestJsonWithRetry<unknown>(`${baseUrl}/1/threads/export/async`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body)
  });

  const root = asRecord(payload);
  const data = asRecord(getField(root, 'data'));
  const requestId = readString(getField(root, 'request_id'), getField(data, 'request_id'));
  if (!requestId) {
    throw new Error('Quip export request did not return request_id.');
  }

  return requestId;
}

function parseThreadTitle(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) return undefined;

  const thread = asRecord(getField(root, 'thread'));
  const data = asRecord(getField(root, 'data'));

  return readString(
    getField(root, 'title'),
    getField(root, 'thread_title'),
    getField(root, 'name'),
    getField(thread, 'title'),
    getField(thread, 'thread_title'),
    getField(thread, 'name'),
    getField(data, 'title'),
    getField(data, 'thread_title'),
    getField(data, 'name')
  );
}

function parseThreadId(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) return undefined;
  const thread = asRecord(getField(root, 'thread'));
  const data = asRecord(getField(root, 'data'));
  return readString(
    getField(thread, 'id'),
    getField(root, 'thread_id'),
    getField(data, 'id'),
    getField(root, 'id')
  );
}

async function fetchThreadDetails(
  baseUrl: string,
  token: string,
  threadReference: string
): Promise<{ id?: string; title?: string }> {
  const payload = await requestJsonWithRetry<unknown>(
    `${baseUrl}/1/threads/${encodeURIComponent(threadReference)}`,
    {
      method: 'GET',
      headers: authHeaders(token, false)
    },
    12000,
    2
  );

  return {
    id: parseThreadId(payload),
    title: parseThreadTitle(payload)
  };
}

async function fetchThreadTitle(baseUrl: string, token: string, threadId: string): Promise<string | undefined> {
  const details = await fetchThreadDetails(baseUrl, token, threadId);
  return details.title;
}

export async function resolveThreadId(baseUrl: string, token: string, threadReference: string): Promise<string> {
  const details = await fetchThreadDetails(baseUrl, token, threadReference);
  return details.id ?? threadReference;
}

export async function enrichThreadTitles(
  baseUrl: string,
  token: string,
  threadIds: string[],
  existingTitles: Record<string, string>
): Promise<Record<string, string>> {
  const titles: Record<string, string> = { ...existingTitles };
  const missing = threadIds.filter((id) => !titles[id]);
  if (!missing.length) return titles;

  const queue = [...missing];
  const workers = Math.min(6, queue.length);

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) {
        const threadId = queue.shift();
        if (!threadId) break;
        try {
          const title = await fetchThreadTitle(baseUrl, token, threadId);
          if (title) {
            titles[threadId] = title;
          }
        } catch {
          // Best-effort enrichment. Keep fallback naming if title lookup fails.
        }
      }
    })
  );

  return titles;
}

function parseExportItems(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (!root) return [];

  const results = asRecordArray(getField(root, 'results'));
  if (results.length) return results;

  const items = asRecordArray(getField(root, 'items'));
  if (items.length) return items;

  const exportsField = asRecordArray(getField(root, 'exports'));
  if (exportsField.length) return exportsField;

  const data = asRecord(getField(root, 'data'));
  const dataResults = asRecordArray(getField(data, 'results'));
  if (dataResults.length) return dataResults;

  return [];
}

export async function pollExportResult(
  baseUrl: string,
  token: string,
  requestId: string
): Promise<{ successes: ExportResultItem[]; failures: FailureItem[] }> {
  const maxPolls = 120;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const payload = await requestJsonWithRetry<unknown>(
      `${baseUrl}/1/threads/export/async?request_id=${encodeURIComponent(requestId)}`,
      {
        method: 'GET',
        headers: authHeaders(token, false)
      },
      15000,
      3
    );

    const root = asRecord(payload);
    const data = asRecord(getField(root, 'data'));
    const completed = Boolean(getField(root, 'completed') ?? getField(data, 'completed'));
    if (!completed) {
      await sleep(Math.min(1500 + poll * 100, 5000));
      continue;
    }

    const rawItems = parseExportItems(payload);
    const successes: ExportResultItem[] = [];
    const failures: FailureItem[] = [];

    for (const item of rawItems) {
      const threadId =
        readString(getField(item, 'thread_id'), getField(item, 'threadId'), getField(item, 'id')) ?? 'unknown-thread';
      const fileUrl = readString(getField(item, 'file_url'), getField(item, 'url'));
      const status = readString(getField(item, 'status'), getField(item, 'state'));

      if (fileUrl) {
        successes.push({
          threadId,
          fileUrl,
          suggestedName: readString(getField(item, 'file_name'), getField(item, 'title'), getField(item, 'name'))
        });
      } else {
        failures.push({
          threadId,
          status,
          error: readString(getField(item, 'error'), getField(item, 'message'), getField(item, 'reason')) ?? 'Export failed'
        });
      }
    }

    return { successes, failures };
  }

  throw new Error('Export polling timed out before completion.');
}

export async function downloadFileBuffer(url: string, token: string): Promise<ArrayBuffer> {
  const tryDownload = async (withAuth: boolean) => {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: withAuth ? authHeaders(token, false) : undefined,
        cache: 'no-store'
      },
      25000
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Download failed (${response.status}): ${text.slice(0, 200)}`);
    }

    return response.arrayBuffer();
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await tryDownload(true);
    } catch (error) {
      const message = redactedErrorMessage(error);
      const authIssue = /401|403/.test(message);
      if (authIssue) {
        try {
          return await tryDownload(false);
        } catch (secondError) {
          if (attempt === 3) throw new Error(redactedErrorMessage(secondError));
        }
      } else if (attempt === 3) {
        throw new Error(message);
      }
      await sleep(Math.min(1000 * 2 ** attempt, 6000));
    }
  }

  throw new Error('Unable to download exported file.');
}
