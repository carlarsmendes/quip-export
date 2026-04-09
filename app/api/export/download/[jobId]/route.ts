import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobStore';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const job = getJob(params.jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found or expired.' }, { status: 404 });
  }

  if (job.status !== 'completed' || !job.zipBuffer) {
    return NextResponse.json({ error: 'ZIP is not ready yet.' }, { status: 409 });
  }

  const filename = job.zipFilename ?? `quip_export_${params.jobId}.zip`;
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
