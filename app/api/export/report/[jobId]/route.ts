import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobStore';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const job = getJob(params.jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found or expired.' }, { status: 404 });
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
        'Content-Disposition': `attachment; filename="quip_export_report_${params.jobId}.json"`
      }
    }
  );
}
