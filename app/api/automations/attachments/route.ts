import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// POST /api/automations/attachments
//
// Uploads a file to attach when an automation fires. Files are stored in
// the `slack-automation-attachments` Supabase Storage bucket and referenced
// by storage_path in the action's attachments array.
//
// (Bucket keeps its historical name `slack-automation-attachments` — it
// holds live files and the runtime references it by that name. Renaming
// would orphan the existing HOA-form uploads for no functional gain.)
//
// At send time the runtime reads each storage_path, downloads the bytes,
// and uploads via Slack's files.uploadV2 with the message as initial_comment.
//
// Not scoped by automation_id — attachments are created while composing,
// before the automation row exists. The DELETE handler cleans orphans.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
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
    console.error('[api/automations/attachments] upload failed', uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

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
