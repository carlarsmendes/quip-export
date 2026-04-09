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
      stage: job.stage,
      progress: job.progress,
      summary: job.summary,
      userError: job.userError,
      hasZip: Boolean(job.zipBuffer)
    },
    { status: 200 }
  );
}
