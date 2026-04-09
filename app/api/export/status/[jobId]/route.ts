import { NextRequest, NextResponse } from 'next/server';
import { loadCompletedJobMeta } from '@/lib/completedJobStore';
import { getJob } from '@/lib/jobStore';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const job = getJob(params.jobId);
  if (!job) {
    const persistedMeta = loadCompletedJobMeta(params.jobId);
    if (persistedMeta) {
      return NextResponse.json(
        {
          id: persistedMeta.id,
          status: 'completed',
          stage: 'done',
          progress: ['queued', 'completed', 'done'],
          summary: persistedMeta.summary,
          downloadProgress: {
            total: persistedMeta.summary.attemptedExports,
            downloaded: persistedMeta.summary.successfulExports,
            failed: persistedMeta.summary.failedExports,
            percent: 100,
            etaSeconds: 0,
            filesPerMinute: 0
          },
          userError: undefined,
          hasZip: true
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        id: params.jobId,
        status: 'failed',
        stage: 'failed',
        progress: ['queued', 'failed'],
        summary: {
          foldersScanned: 0,
          uniqueThreadsFound: 0,
          attemptedExports: 0,
          successfulExports: 0,
          failedExports: 0
        },
        downloadProgress: {
          total: 0,
          downloaded: 0,
          failed: 0,
          percent: 0,
          etaSeconds: null,
          filesPerMinute: 0
        },
        userError:
          'Export session expired or server restarted while processing. Please click Export again. (This app keeps job state in memory.)',
        hasZip: false
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      summary: job.summary,
      downloadProgress: job.downloadProgress,
      userError: job.userError,
      hasZip: Boolean(job.zipBuffer)
    },
    { status: 200 }
  );
}
