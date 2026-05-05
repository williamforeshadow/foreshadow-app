import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST /api/slack-automations/attachments
//
// Uploads a file to be attached when a Slack automation fires. Files are
// stored in the `slack-automation-attachments` Supabase Storage bucket and
// referenced by storage_path in the automation's config.attachments array.
//
// At send time, the execution layer will:
//   1. Read each attachment's storage_path
//   2. Generate a signed URL (or download the bytes)
//   3. Upload via Slack's files.uploadV2 with the message
//
// This is a generic upload endpoint — works for PDFs, images, docs,
// anything teams want to attach to their automated messages. Bucket-level
// MIME validation is intentionally permissive; the limit is the file
// size cap.
//
// Storage layout:
//   slack-automation-attachments/
//     {random-token}.{ext}
//
// We don't scope by automation_id because attachments can be created
// before the automation row exists (the user uploads files while
// composing in the dialog). The DELETE handler under [id] cleans up
// orphaned uploads.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — Slack's per-file upload cap is higher but this matches property documents
const BUCKET = 'slack-automation-attachments';

function randomSegment(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_BYTES / 1024 / 1024}MB limit` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServer();

  const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'bin').toLowerCase();
  const token = randomSegment(16);
  const storagePath = `${token}.${ext}`;

  const arrayBuf = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) {
    console.error('[api/slack-automations/attachments] upload failed', uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // Generate a public URL for display in the editor. The execution layer
  // doesn't rely on this URL — it reads the bytes directly from storage
  // by path — but it's useful for letting the user preview / re-download
  // the file from the configuration UI.
  const { data: publicData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  return NextResponse.json(
    {
      attachment: {
        id: token,
        name: file.name,
        storage_path: storagePath,
        url: publicData.publicUrl,
        mime_type: file.type || null,
        size_bytes: file.size,
      },
    },
    { status: 201 },
  );
}
