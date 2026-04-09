export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ExportStartInput {
  token: string;
  folderId: string;
  baseUrl: string;
  recurseSubfolders: boolean;
  includeConversations: boolean;
  testMode: boolean;
}

export interface FailureItem {
  threadId: string;
  error: string;
  status?: string;
}

export interface ExportSummary {
  foldersScanned: number;
  uniqueThreadsFound: number;
  attemptedExports: number;
  successfulExports: number;
  failedExports: number;
}

export interface DownloadProgress {
  total: number;
  downloaded: number;
  failed: number;
  percent: number;
  etaSeconds: number | null;
  filesPerMinute: number;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  stage: string;
  progress: string[];
  createdAt: number;
  updatedAt: number;
  summary: ExportSummary;
  zipBuffer?: Buffer;
  zipFilename?: string;
  failures: FailureItem[];
  userError?: string;
  debugError?: string;
  downloadProgress?: DownloadProgress;
}

export interface ExportResultItem {
  threadId: string;
  fileUrl: string;
  suggestedName?: string;
}
