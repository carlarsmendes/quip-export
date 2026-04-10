import { NextRequest, NextResponse } from 'next/server';
import { downloadFileBuffer, enrichThreadTitles, pollExportResult, resolveThreadId, submitBulkExport, verifyToken } from '@/lib/quip';
import { redactedErrorMessage, sanitizeBaseUrl, sanitizeFilename, sanitizeThreadId, userFacingError } from '@/lib/security';

export const runtime = 'nodejs';

type Body = {
  token?: string;
  documentId?: string;
  baseUrl?: string;
};

function normalizeDocumentReference(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[0] ?? trimmed;
  } catch {
    return trimmed;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const token = (body.token ?? '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Bearer token is required.' }, { status: 400 });
    }

    const documentRef = sanitizeThreadId(normalizeDocumentReference(body.documentId ?? ''));
    const baseUrl = sanitizeBaseUrl(body.baseUrl || process.env.QUIP_API_BASE_URL || 'https://platform.quip.com');

    await verifyToken(baseUrl, token);
    const threadId = await resolveThreadId(baseUrl, token, documentRef);

    const requestId = await submitBulkExport(baseUrl, token, [threadId], false);
    const result = await pollExportResult(baseUrl, token, requestId);

    const file = result.successes.find((item) => item.threadId === threadId) ?? result.successes[0];
    if (!file) {
      const firstFailure = result.failures[0];
      const failureMessage = firstFailure?.error ?? 'Export failed for the provided document ID.';
      const statusHint = firstFailure?.status ? ` (status: ${firstFailure.status})` : '';
      return NextResponse.json(
        {
          error: `Quip could not export this document ID${statusHint}. ${failureMessage}`
        },
        { status: 400 }
      );
    }

    const fileBuffer = await downloadFileBuffer(file.fileUrl, token);
    const titles = await enrichThreadTitles(baseUrl, token, [threadId], {});
    const preferredName = titles[threadId] ?? file.suggestedName ?? documentRef;
    const filename = sanitizeFilename(preferredName).replace(/\.docx$/i, '') + '.docx';

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    const message = redactedErrorMessage(error);
    const lower = message.toLowerCase();
    let userMessage = userFacingError(message);

    if ((lower.includes('/threads/') || lower.includes('threads/')) && (lower.includes('404') || lower.includes('not found'))) {
      userMessage = 'Document not found. Please verify the document ID and that your token has access.';
    } else if (lower.includes('401') || lower.includes('403') || lower.includes('access denied') || lower.includes('unauthorized')) {
      userMessage = 'Your token does not have access to this document.';
    } else if (lower.includes('export failed for the provided document id')) {
      userMessage = 'Quip could not export this document as DOCX.';
    }

    return NextResponse.json({ error: userMessage }, { status: 400 });
  }
}
