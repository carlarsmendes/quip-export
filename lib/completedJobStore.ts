import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExportSummary, FailureItem } from './types';

interface CompletedJobSnapshot {
  id: string;
  zipFilename: string;
  summary: ExportSummary;
  failures: FailureItem[];
  createdAt: number;
  updatedAt: number;
}

const ROOT = join(tmpdir(), 'quip-folder-exporter');
const COMPLETED_DIR = join(ROOT, 'completed');
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir() {
  if (!existsSync(COMPLETED_DIR)) {
    mkdirSync(COMPLETED_DIR, { recursive: true });
  }
}

function metaPath(jobId: string): string {
  return join(COMPLETED_DIR, `${jobId}.json`);
}

function zipPath(jobId: string): string {
  return join(COMPLETED_DIR, `${jobId}.zip`);
}

function cleanupExpiredSnapshots() {
  ensureDir();
  const cutoff = Date.now() - SNAPSHOT_TTL_MS;
  for (const file of readdirSync(COMPLETED_DIR)) {
    const fullPath = join(COMPLETED_DIR, file);
    try {
      const stats = statSync(fullPath);
      if (stats.mtimeMs < cutoff) {
        rmSync(fullPath, { force: true });
      }
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function persistCompletedJob(
  id: string,
  zipBuffer: Buffer,
  zipFilename: string,
  summary: ExportSummary,
  failures: FailureItem[]
): void {
  cleanupExpiredSnapshots();
  ensureDir();

  const now = Date.now();
  const snapshot: CompletedJobSnapshot = {
    id,
    zipFilename,
    summary,
    failures,
    createdAt: now,
    updatedAt: now
  };

  writeFileSync(zipPath(id), zipBuffer);
  writeFileSync(metaPath(id), JSON.stringify(snapshot));
}

export function loadCompletedJobMeta(id: string): CompletedJobSnapshot | undefined {
  cleanupExpiredSnapshots();
  const path = metaPath(id);
  if (!existsSync(path)) return undefined;

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as CompletedJobSnapshot;
    return parsed;
  } catch {
    return undefined;
  }
}

export function loadCompletedJobZip(id: string): Buffer | undefined {
  cleanupExpiredSnapshots();
  const path = zipPath(id);
  if (!existsSync(path)) return undefined;

  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

export function deleteCompletedJob(id: string): void {
  try {
    unlinkSync(metaPath(id));
  } catch {
    // Ignore cleanup failures.
  }
  try {
    unlinkSync(zipPath(id));
  } catch {
    // Ignore cleanup failures.
  }
}
