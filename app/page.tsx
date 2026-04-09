'use client';

import { FormEvent, useMemo, useState } from 'react';

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
  userError?: string;
  hasZip: boolean;
};

const DEFAULT_BASE_URL = 'https://platform.quip.com';

export default function HomePage() {
  const [token, setToken] = useState('');
  const [folderId, setFolderId] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [recurseSubfolders, setRecurseSubfolders] = useState(true);
  const [includeConversations, setIncludeConversations] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [statusPayload, setStatusPayload] = useState<StatusPayload | null>(null);
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  const isBusy = isStarting || statusPayload?.status === 'running' || statusPayload?.status === 'queued';

  const summaryLines = useMemo(() => {
    if (!statusPayload) return [];
    return [
      `Folders scanned: ${statusPayload.summary.foldersScanned}`,
      `Unique threads found: ${statusPayload.summary.uniqueThreadsFound}`,
      `Requested exports: ${statusPayload.summary.attemptedExports}`,
      `Successful exports: ${statusPayload.summary.successfulExports}`,
      `Failed exports: ${statusPayload.summary.failedExports}`
    ];
  }, [statusPayload]);

  async function pollStatus(currentJobId: string) {
    while (true) {
      const response = await fetch(`/api/export/status/${currentJobId}`, { cache: 'no-store' });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to read export status.');
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

    try {
      const response = await fetch('/api/export/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token,
          folderId,
          baseUrl,
          recurseSubfolders,
          includeConversations,
          testMode
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to start export.');
      }

      const newJobId = payload.jobId as string;
      setJobId(newJobId);

      // Clear token from client state after submit to minimize in-memory lifetime in browser.
      setToken('');

      await pollStatus(newJobId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Export failed to start.');
    } finally {
      setIsStarting(false);
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
            <label htmlFor="token">Bearer token</label>
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
            <label htmlFor="folderId">Folder ID</label>
            <input
              id="folderId"
              type="text"
              required
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              spellCheck={false}
            />
          </div>

          <div>
            <label htmlFor="baseUrl">Quip API base URL</label>
            <input
              id="baseUrl"
              type="text"
              required
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              spellCheck={false}
            />
            <div className="help">Default: https://platform.quip.com (change for VPC environments)</div>
          </div>

          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={recurseSubfolders}
                onChange={(event) => setRecurseSubfolders(event.target.checked)}
              />
              Recurse into subfolders
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={includeConversations}
                onChange={(event) => setIncludeConversations(event.target.checked)}
              />
              Include conversations
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(event) => setTestMode(event.target.checked)}
              />
              Test mode (first 5 threads)
            </label>
          </div>

          <button type="submit" disabled={isBusy}>
            {isBusy ? 'Export in progress...' : 'Export to DOCX ZIP'}
          </button>
        </form>

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
                <div className="success">Done. Your export ZIP is ready.</div>
                {jobId && (
                  <div className="links">
                    <a href={`/api/export/download/${jobId}`}>Download ZIP</a>
                    <a href={`/api/export/report/${jobId}`} target="_blank" rel="noreferrer">
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
      </section>
    </main>
  );
}
