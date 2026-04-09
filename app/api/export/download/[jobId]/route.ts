import { NextRequest, NextResponse } from 'next/server';
import { loadCompletedJobMeta, loadCompletedJobZip } from '@/lib/completedJobStore';
import { getJob } from '@/lib/jobStore';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const jobId = params.jobId;
  const job = getJob(jobId);
  if (!job) {
    const persistedZip = loadCompletedJobZip(jobId);
    const persistedMeta = loadCompletedJobMeta(jobId);
    if (!persistedZip || !persistedMeta) {
      return NextResponse.json({ error: 'Job not found or expired.' }, { status: 404 });
    }

    const filename = persistedMeta.zipFilename ?? `quip_export_${jobId}.zip`;
    const zipBytes = new Uint8Array(persistedZip);

    return new NextResponse(zipBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  }

  if (job.status !== 'completed' || !job.zipBuffer) {
    return NextResponse.json({ error: 'ZIP is not ready yet.' }, { status: 409 });
  }

  const filename = job.zipFilename ?? `quip_export_${jobId}.zip`;
  const zipBytes = new Uint8Array(job.zipBuffer);

  return new NextResponse(zipBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
