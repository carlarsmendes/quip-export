import { NextRequest, NextResponse } from 'next/server';
import { createJob } from '@/lib/jobStore';
import { runExportJob } from '@/lib/exportJob';
import { redactedErrorMessage, sanitizeBaseUrl, sanitizeFolderId } from '@/lib/security';
import { ExportStartInput } from '@/lib/types';

export const runtime = 'nodejs';

type Body = {
  token?: string;
  folderId?: string;
  baseUrl?: string;
  recurseSubfolders?: boolean;
  includeConversations?: boolean;
  testMode?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const token = (body.token ?? '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Bearer token is required.' }, { status: 400 });
    }

    const folderId = sanitizeFolderId(body.folderId ?? '');
    const baseUrl = sanitizeBaseUrl(body.baseUrl || process.env.QUIP_API_BASE_URL || 'https://platform.quip.com');

    const input: ExportStartInput = {
      token,
      folderId,
      baseUrl,
      recurseSubfolders: body.recurseSubfolders ?? true,
      includeConversations: Boolean(body.includeConversations),
      testMode: Boolean(body.testMode)
    };

    const job = createJob();
    void runExportJob(job.id, input);

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) {
    const message = redactedErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
