'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type StatusPayload = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  progress: string[];
  summary: {
    foldersScanned: number;
    uniqueThreadsFound: number;
    attemptedExports: number;
    successfulExports: number;
    failedExports: number;
  };
  downloadProgress?: {
    total: number;
    downloaded: number;
    failed: number;
    percent: number;
    etaSeconds: number | null;
    filesPerMinute: number;
  };
  userError?: string;
  hasZip: boolean;
};

const EMPTY_SUMMARY = {
  foldersScanned: 0,
  uniqueThreadsFound: 0,
  attemptedExports: 0,
  successfulExports: 0,
  failedExports: 0
};

async function safeReadJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = (await response.json()) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore JSON parse failures and fall back to status-based errors.
  }
  return {};
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mapHttpError(status: number, apiMessage?: string): string {
  if (status === 400) return apiMessage ?? 'Request is invalid. Please check token, folder ID, and API URL.';
  if (status === 401 || status === 403) return 'Access denied. Please verify your bearer token permissions.';
  if (status === 404) {
    if (apiMessage?.toLowerCase().includes('job')) {
      return 'Export session expired or server restarted. Please click Export again.';
    }
    return 'Requested resource was not found. Please check the folder ID and API base URL.';
  }
  if (status === 409) return apiMessage ?? 'The export is not ready yet. Please wait and try again.';
  if (status === 429) return 'Rate limit hit. Please wait a moment and retry.';
  if (status >= 500) return 'Server error occurred. Please retry in a minute.';
  return apiMessage ?? `Request failed with status ${status}.`;
}

function mapClientError(error: unknown, phase: 'start' | 'poll'): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('err_connection_refused') || lower.includes('networkerror')) {
    return phase === 'start'
      ? 'Could not reach the app backend. If running locally, confirm `npm run dev` is running and open the app from the same URL.'
      : 'Connection was lost while checking export progress. Please retry.';
  }

  if (lower.includes('abort') || lower.includes('timeout')) {
    return 'The request timed out. Please retry.';
  }

  return message || 'Unexpected error. Please retry.';
}

function describeStage(stage: string): string {
  const value = stage.toLowerCase();
  if (value.includes('validating token')) return 'Checking your token with Quip.';
  if (value.includes('reading folder')) return 'Reading the folder contents.';
  if (value.includes('scanning subfolders')) return 'Scanning nested folders for files.';
  if (value.includes('resolving file names')) return 'Looking up original file titles for naming.';
  if (value.includes('collected')) return 'Preparing list of unique files to export.';
  if (value.includes('submitting export')) return 'Submitting export request to Quip.';
  if (value.includes('polling export status')) return 'Waiting for Quip to finish preparing files.';
  if (value.includes('downloading files')) return 'Downloading exported DOCX files.';
  if (value.includes('creating zip')) return 'Packaging all files into a ZIP.';
  return 'Working...';
}

function overallProgressPercent(stage: string): number {
  const s = stage.toLowerCase();
  if (s.includes('queued')) return 3;
  if (s.includes('validating token')) return 10;
  if (s.includes('reading folder')) return 20;
  if (s.includes('scanning subfolders')) return 30;
  if (s.includes('resolving file names')) return 40;
  if (s.includes('collected')) return 50;
  if (s.includes('submitting export')) return 60;
  if (s.includes('polling export status')) return 70;
  if (s.includes('downloading files')) return 85;
  if (s.includes('creating zip')) return 95;
  if (s.includes('done')) return 100;
  if (s.includes('failed')) return 100;
  return 5;
}

function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null) return 'calculating...';
  if (etaSeconds <= 0) return 'less than 1 min';
  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;
  if (minutes <= 0) return `~${seconds}s`;
  if (seconds === 0) return `~${minutes} min`;
  return `~${minutes}m ${seconds}s`;
}

export default function HomePage() {
  const [token, setToken] = useState('');
  const [folderId, setFolderId] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [statusPayload, setStatusPayload] = useState<StatusPayload | null>(null);
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clockTick, setClockTick] = useState(0);

  const isBusy = isStarting || statusPayload?.status === 'queued' || statusPayload?.status === 'running';

  const summaryLines = useMemo(() => {
    if (!statusPayload) return [];
    return [
      `Folders scanned: ${statusPayload.summary.foldersScanned}`,
      `Unique files found: ${statusPayload.summary.uniqueThreadsFound}`,
      `Requested exports: ${statusPayload.summary.attemptedExports}`,
      `Successful exports: ${statusPayload.summary.successfulExports}`,
      `Failed exports: ${statusPayload.summary.failedExports}`
    ];
  }, [statusPayload]);

  const elapsedSeconds = useMemo(() => {
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  }, [startedAt, clockTick]);

  const currentStage = statusPayload?.stage ?? 'starting';
  const stageDescription = describeStage(currentStage);
  const isDownloadingStage = currentStage.toLowerCase().includes('downloading files');
  const downloadProgress = statusPayload?.downloadProgress;
  const overallPercent = overallProgressPercent(currentStage);

  useEffect(() => {
    if (!isBusy) return;
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isBusy]);

  async function pollStatus(currentJobId: string) {
    while (true) {
      const response = await fetch(`/api/export/status/${currentJobId}`, { cache: 'no-store' });
      const payload = await safeReadJson(response);

      if (!response.ok) {
        if (response.status === 404) {
          const expiredMessage =
            'Export session expired or server restarted while processing. Please click Export again.';
          setStatusPayload({
            id: currentJobId,
            status: 'failed',
            stage: 'failed',
            progress: ['queued', 'failed'],
            summary: EMPTY_SUMMARY,
            downloadProgress: {
              total: 0,
              downloaded: 0,
              failed: 0,
              percent: 0,
              etaSeconds: null,
              filesPerMinute: 0
            },
            userError: expiredMessage,
            hasZip: false
          });
          setError(expiredMessage);
          return;
        }
        const apiMessage = valueAsString(payload.error);
        throw new Error(mapHttpError(response.status, apiMessage));
      }

      setStatusPayload(payload as StatusPayload);

      if (payload.status === 'completed' || payload.status === 'failed') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setJobId(null);
    setStatusPayload(null);
    setIsStarting(true);
    setStartedAt(Date.now());

    try {
      const response = await fetch('/api/export/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token,
          folderId
        })
      });

      const payload = await safeReadJson(response);
      if (!response.ok) {
        const apiMessage = valueAsString(payload.error);
        throw new Error(mapHttpError(response.status, apiMessage));
      }

      const newJobId = valueAsString(payload.jobId);
      if (!newJobId) {
        throw new Error('Backend response is missing a job ID. Please retry.');
      }
      setJobId(newJobId);

      // Clear token from client state after submit to minimize in-memory lifetime in browser.
      setToken('');

      try {
        await pollStatus(newJobId);
      } catch (pollError) {
        throw new Error(mapClientError(pollError, 'poll'));
      }
    } catch (submitError) {
      setError(mapClientError(submitError, 'start'));
      setJobId(null);
      setStatusPayload((previous) => {
        if (!previous) return null;
        return {
          ...previous,
          status: 'failed',
          stage: 'failed',
          userError: mapClientError(submitError, 'start')
        };
      });
    } finally {
      setIsStarting(false);
      setClockTick(0);
    }
  }

  return (
    <main>
      <section className="panel">
        <h1>Quip Folder Exporter</h1>
        <p className="subtitle">
          Paste your Quip token and folder ID, then export all documents to one ZIP of DOCX files.
        </p>

        <form onSubmit={onSubmit}>
          <div>
            <label htmlFor="token">Step 1: Generate your Quip access token</label>
            <div className="help">
              To generate a personal Access Token for your Quip account, please visit:{' '}
              <a href="https://quip.com/dev/token" target="_blank" rel="noreferrer">
                https://quip.com/dev/token
              </a>
            </div>
            <div className="help">Admin is usually not required. The token just needs permission to access the target folder.</div>
          </div>

          <div>
            <label htmlFor="token">Step 2: Paste your Quip token</label>
            <input
              id="token"
              type="password"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="help">Token is used only for this request and is never stored.</div>
          </div>

          <div>
            <label htmlFor="folderId">Step 3: Paste your folder ID</label>
            <input
              id="folderId"
              type="text"
              required
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              spellCheck={false}
            />
            <div className="help">
              In Quip, open the target folder and copy the ID from the URL (the last segment after `/folder/`).
            </div>
          </div>

          <button type="submit" disabled={isBusy}>
            {isBusy ? 'Export in progress...' : 'Export to DOCX ZIP'}
          </button>
        </form>

        {isBusy && (
          <div className="activity-box">
            <div className="activity-title">
              <span className="spinner-dot" />
              Export is running
            </div>
            <div className="activity-line">Elapsed time: {elapsedSeconds}s</div>
            <div className="activity-line">{stageDescription}</div>
            <div className="download-metrics">
              <div className="metric-line">Overall progress: {overallPercent}%</div>
              <div className="progress-wrap">
                <div className="progress-fill overall-fill" style={{ width: `${overallPercent}%` }} />
              </div>
            </div>
            <div className="help">The app checks status every few seconds until the ZIP is ready.</div>
            <div className="help">Do not close or refresh this page while export/download is in progress.</div>
            {isDownloadingStage && downloadProgress && downloadProgress.total > 0 && (
              <div className="download-metrics">
                <div className="metric-line">
                  Downloaded {downloadProgress.downloaded} of {downloadProgress.total} files
                </div>
                <div className="progress-wrap">
                  <div className="progress-fill" style={{ width: `${downloadProgress.percent}%` }} />
                </div>
                <div className="metric-line">Estimated time remaining: {formatEta(downloadProgress.etaSeconds)}</div>
                <div className="metric-line">Current speed: ~{downloadProgress.filesPerMinute} files/min</div>
              </div>
            )}
          </div>
        )}

        {statusPayload && (
          <div className="status-box">
            <div className="status-line">
              <strong>Current stage:</strong> {statusPayload.stage}
            </div>
            {statusPayload.progress.map((line, index) => (
              <div className="status-line" key={`${line}-${index}`}>
                {index + 1}. {line}
              </div>
            ))}

            <div className="summary">
              {summaryLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>

            {statusPayload.status === 'completed' && (
              <>
                <div className="success">
                  Done. {statusPayload.summary.successfulExports} files exported. Your ZIP is ready.
                </div>
                {jobId && (
                  <div className="links">
                    <a className="cta-button" href={`/api/export/download/${jobId}`}>
                      Download ZIP
                    </a>
                    <a className="secondary-link" href={`/api/export/report/${jobId}`} target="_blank" rel="noreferrer">
                      Download JSON failure report
                    </a>
                  </div>
                )}
              </>
            )}

            {statusPayload.status === 'failed' && (
              <div className="error">{statusPayload.userError || 'Export failed.'}</div>
            )}
          </div>
        )}

        {error && <div className="error">{error}</div>}
        {error && (
          <div className="help" style={{ marginTop: '8px' }}>
            Tip: Browser extension console warnings like \"A listener indicated an asynchronous response...\" are usually not from this
            app and can be ignored.
          </div>
        )}
      </section>
    </main>
  );
}
