import { NextRequest, NextResponse } from 'next/server';
import { loadCompletedJobMeta } from '@/lib/completedJobStore';
import { getJob } from '@/lib/jobStore';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const jobId = params.jobId;
  const job = getJob(jobId);
  if (!job) {
    const persistedMeta = loadCompletedJobMeta(jobId);
    if (!persistedMeta) {
      return NextResponse.json({ error: 'Job not found or expired.' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: persistedMeta.id,
        status: 'completed',
        summary: persistedMeta.summary,
        failures: persistedMeta.failures
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="quip_export_report_${jobId}.json"`
        }
      }
    );
  }

  return NextResponse.json(
    {
      id: job.id,
      status: job.status,
      summary: job.summary,
      failures: job.failures
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="quip_export_report_${jobId}.json"`
      }
    }
  );
}
