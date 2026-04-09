import JSZip from 'jszip';
import {
  getJob,
  setJobCompleted,
  setJobDownloadProgress,
  setJobFailed,
  setJobFailures,
  setJobRunning,
  setJobStage,
  setJobSummary
} from './jobStore';
import {
  downloadFileBuffer,
  enrichThreadTitles,
  pollExportResult,
  readFolderTree,
  submitBulkExport,
  verifyToken
} from './quip';
import {
  redactToken,
  redactedErrorMessage,
  sanitizeFilename,
  userFacingError
} from './security';
import { ExportStartInput, FailureItem } from './types';

function uniqueName(base: string, used: Set<string>, threadId: string): string {
  const cleaned = sanitizeFilename(base);
  const withExt = cleaned.toLowerCase().endsWith('.docx') ? cleaned : `${cleaned}.docx`;
  if (!used.has(withExt)) {
    used.add(withExt);
    return withExt;
  }

  const bare = withExt.replace(/\.docx$/i, '');
  const fallback = `${sanitizeFilename(`${bare}_${threadId}`)}.docx`;
  if (!used.has(fallback)) {
    used.add(fallback);
    return fallback;
  }

  let i = 2;
  let candidate = `${sanitizeFilename(`${bare}_${threadId}_${i}`)}.docx`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${sanitizeFilename(`${bare}_${threadId}_${i}`)}.docx`;
  }
  used.add(candidate);
  return candidate;
}

function sanitizePathSegment(value: string): string {
  return sanitizeFilename(value).replace(/\.docx$/i, '') || 'folder';
}

function uniqueZipPath(
  folderPath: string[] | undefined,
  filename: string,
  usedPaths: Set<string>,
  threadId: string
): string {
  const safeSegments = (folderPath ?? []).map((segment) => sanitizePathSegment(segment)).filter(Boolean);
  const basePath = safeSegments.length ? `${safeSegments.join('/')}/${filename}` : filename;
  if (!usedPaths.has(basePath)) {
    usedPaths.add(basePath);
    return basePath;
  }

  const withThreadId = filename.replace(/\.docx$/i, `_${sanitizeFilename(threadId)}.docx`);
  const withThreadIdPath = safeSegments.length ? `${safeSegments.join('/')}/${withThreadId}` : withThreadId;
  if (!usedPaths.has(withThreadIdPath)) {
    usedPaths.add(withThreadIdPath);
    return withThreadIdPath;
  }

  let i = 2;
  let candidate = withThreadId.replace(/\.docx$/i, `_${i}.docx`);
  let candidatePath = safeSegments.length ? `${safeSegments.join('/')}/${candidate}` : candidate;
  while (usedPaths.has(candidatePath)) {
    i += 1;
    candidate = withThreadId.replace(/\.docx$/i, `_${i}.docx`);
    candidatePath = safeSegments.length ? `${safeSegments.join('/')}/${candidate}` : candidate;
  }
  usedPaths.add(candidatePath);
  return candidatePath;
}

function buildDownloadProgress(total: number, downloaded: number, failed: number, processedAt: number[]) {
  const processed = downloaded + failed;
  const percent = total > 0 ? Math.round((processed / total) * 10000) / 100 : 100;

  let filesPerMinute = 0;
  let etaSeconds: number | null = null;

  const history = processedAt.slice(-40);
  if (history.length >= 2) {
    const elapsedMs = history[history.length - 1] - history[0];
    if (elapsedMs > 0) {
      const perSecond = (history.length - 1) / (elapsedMs / 1000);
      filesPerMinute = Math.round(perSecond * 60 * 100) / 100;
      const remaining = Math.max(total - processed, 0);
      etaSeconds = perSecond > 0 ? Math.ceil(remaining / perSecond) : null;
    }
  }

  return {
    total,
    downloaded,
    failed,
    percent: Math.min(Math.max(percent, 0), 100),
    etaSeconds,
    filesPerMinute
  };
}

export async function runExportJob(jobId: string, input: ExportStartInput): Promise<void> {
  try {
    setJobRunning(jobId, 'validating token');
    await verifyToken(input.baseUrl, input.token);

    setJobStage(jobId, 'reading folder');
    if (input.recurseSubfolders) {
      setJobStage(jobId, 'scanning subfolders');
    }
    const folderScan = await readFolderTree(input.baseUrl, input.token, input.folderId, input.recurseSubfolders);

    setJobSummary(jobId, {
      foldersScanned: folderScan.foldersScanned,
      uniqueThreadsFound: folderScan.threadIds.length
    });

    if (!folderScan.threadIds.length) {
      throw new Error('No exportable files found.');
    }

    const deduped = Array.from(new Set(folderScan.threadIds));
    const finalThreadIds = input.testMode ? deduped.slice(0, 5) : deduped;
    setJobStage(jobId, 'resolving file names');
    const resolvedTitles = await enrichThreadTitles(
      input.baseUrl,
      input.token,
      finalThreadIds,
      folderScan.threadTitles
    );

    setJobStage(jobId, `collected ${finalThreadIds.length} unique files`);
    setJobSummary(jobId, {
      uniqueThreadsFound: finalThreadIds.length,
      attemptedExports: finalThreadIds.length
    });

    setJobStage(jobId, 'submitting export');
    const requestId = await submitBulkExport(
      input.baseUrl,
      input.token,
      finalThreadIds,
      input.includeConversations
    );

    setJobStage(jobId, 'polling export status');
    const result = await pollExportResult(input.baseUrl, input.token, requestId);

    setJobStage(jobId, 'downloading files');
    const failures: FailureItem[] = [...result.failures];
    const zip = new JSZip();
    const usedNames = new Set<string>();
    const usedZipPaths = new Set<string>();

    let successCount = 0;
    let failedDownloads = 0;
    const processedAt: number[] = [];
    const totalDownloads = result.successes.length;

    setJobDownloadProgress(jobId, buildDownloadProgress(totalDownloads, successCount, failedDownloads, processedAt));

    for (const item of result.successes) {
      try {
        const fileBuffer = await downloadFileBuffer(item.fileUrl, input.token);
        const preferredName = resolvedTitles[item.threadId] ?? item.suggestedName ?? item.threadId;
        const filename = uniqueName(preferredName, usedNames, item.threadId);
        const zipPath = uniqueZipPath(folderScan.threadPaths[item.threadId], filename, usedZipPaths, item.threadId);
        zip.file(zipPath, fileBuffer);
        successCount += 1;
        processedAt.push(Date.now());
        setJobDownloadProgress(jobId, buildDownloadProgress(totalDownloads, successCount, failedDownloads, processedAt));
      } catch (error) {
        failures.push({
          threadId: item.threadId,
          error: redactedErrorMessage(error)
        });
        failedDownloads += 1;
        processedAt.push(Date.now());
        setJobDownloadProgress(jobId, buildDownloadProgress(totalDownloads, successCount, failedDownloads, processedAt));
      }
    }

    setJobSummary(jobId, {
      successfulExports: successCount,
      failedExports: failures.length
    });
    setJobFailures(jobId, failures);

    if (!successCount) {
      throw new Error('All exports failed. No files were downloaded successfully.');
    }

    setJobStage(jobId, 'creating zip');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = sanitizeFilename(`quip_export_${input.folderId}_${timestamp}.zip`);

    setJobCompleted(jobId, zipBuffer, zipFilename);
  } catch (error) {
    const debugError = redactedErrorMessage(error);
    const userError = userFacingError(debugError);

    console.error('[export_job_failed]', {
      jobId,
      debugError: redactToken(debugError),
      stage: getJob(jobId)?.stage
    });

    setJobFailed(jobId, userError, debugError);
  }
}
