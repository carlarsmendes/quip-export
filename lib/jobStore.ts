import { randomUUID } from 'crypto';
import { JobRecord } from './types';

const JOB_TTL_MS = 30 * 60 * 1000;
const jobs = new Map<string, JobRecord>();

function now() {
  return Date.now();
}

function cleanupExpiredJobs() {
  const cutoff = now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) {
      jobs.delete(id);
    }
  }
}

export function createJob(): JobRecord {
  cleanupExpiredJobs();
  const id = randomUUID();
  const timestamp = now();
  const job: JobRecord = {
    id,
    status: 'queued',
    stage: 'queued',
    progress: ['queued'],
    createdAt: timestamp,
    updatedAt: timestamp,
    failures: [],
    summary: {
      foldersScanned: 0,
      uniqueThreadsFound: 0,
      attemptedExports: 0,
      successfulExports: 0,
      failedExports: 0
    }
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  cleanupExpiredJobs();
  return jobs.get(id);
}

export function setJobRunning(id: string, stage: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  job.stage = stage;
  job.progress.push(stage);
  job.updatedAt = now();
}

export function setJobStage(id: string, stage: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.stage = stage;
  job.progress.push(stage);
  job.updatedAt = now();
}

export function setJobSummary(id: string, partial: Partial<JobRecord['summary']>): void {
  const job = jobs.get(id);
  if (!job) return;
  job.summary = { ...job.summary, ...partial };
  job.updatedAt = now();
}

export function setJobFailures(id: string, failures: JobRecord['failures']): void {
  const job = jobs.get(id);
  if (!job) return;
  job.failures = failures;
  job.summary.failedExports = failures.length;
  job.updatedAt = now();
}

export function setJobCompleted(id: string, zipBuffer: Buffer, zipFilename: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'completed';
  job.stage = 'done';
  job.progress.push('done');
  job.zipBuffer = zipBuffer;
  job.zipFilename = zipFilename;
  job.updatedAt = now();
}

export function setJobFailed(id: string, userError: string, debugError: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'failed';
  job.stage = 'failed';
  job.progress.push('failed');
  job.userError = userError;
  job.debugError = debugError;
  job.updatedAt = now();
}
