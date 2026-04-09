import JSZip from 'jszip';
import {
  getJob,
  setJobCompleted,
  setJobFailed,
  setJobFailures,
  setJobRunning,
  setJobStage,
  setJobSummary
} from './jobStore';
import {
  downloadFileBuffer,
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
      throw new Error('No exportable threads found.');
    }

    const deduped = Array.from(new Set(folderScan.threadIds));
    const finalThreadIds = input.testMode ? deduped.slice(0, 5) : deduped;

    setJobStage(jobId, `collected ${finalThreadIds.length} unique threads`);
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

    let successCount = 0;

    for (const item of result.successes) {
      try {
        const fileBuffer = await downloadFileBuffer(item.fileUrl, input.token);
        const name = uniqueName(item.suggestedName ?? item.threadId, usedNames, item.threadId);
        zip.file(name, fileBuffer);
        successCount += 1;
      } catch (error) {
        failures.push({
          threadId: item.threadId,
          error: redactedErrorMessage(error)
        });
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
