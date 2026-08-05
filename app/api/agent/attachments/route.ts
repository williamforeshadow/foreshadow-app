import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requireAuthContext } from '@/lib/requireAuthContext';
import {
  INBOUND_FILES_BUCKET,
  INBOUND_FILES_TABLE,
  MAX_INBOUND_BYTES,
  safeName,
  stageInboundFile,
} from '@/src/server/agent/inboundFiles';

// POST /api/agent/attachments
//
// Stage a file the user picked in the in-app agent chat. This is the web
// counterpart of the Slack events route's file capture: the bytes go into the
// private staging bucket, a row records them, and the client gets back an
// inbound_file_id to send with its next /api/agent message.
//
// Deliberately permissive about type. The agent's job here is filing — the
// user decides what's worth attaching, and the destination enforces its own
// rules at commit time (photo targets require an image, for example). The only
// hard limit is size, which matches the bucket's.
//
// Uploading is not attaching. A staged file sits unconsumed until the model
// previews a destination and the user confirms it; nothing lands anywhere off
// the back of this call alone.

/** Reject the pathological case early — before reading the body into memory. */
const MAX_FILES_PER_REQUEST = 10;

function randomSegment(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { appUser } = authCtx;

  let files: File[];
  try {
    const formData = await req.formData();
    files = formData
      .getAll('file')
      .filter((entry): entry is File => entry instanceof File);
  } catch {
    return NextResponse.json(
      { error: 'Expected a multipart/form-data body' },
      { status: 400 },
    );
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many files. Maximum ${MAX_FILES_PER_REQUEST} per upload.` },
      { status: 400 },
    );
  }

  const oversized = files.find((f) => f.size > MAX_INBOUND_BYTES);
  if (oversized) {
    return NextResponse.json(
      {
        error: `"${oversized.name}" is too large. Maximum size is ${
          MAX_INBOUND_BYTES / (1024 * 1024)
        }MB.`,
      },
      { status: 400 },
    );
  }

  try {
    const staged = await Promise.all(
      files.map(async (file) => {
        const name = file.name || 'upload';
        const storagePath = [
          'web',
          appUser.id,
          `${Date.now()}-${randomSegment()}-${safeName(name)}`,
        ].join('/');

        const row = await stageInboundFile({
          bytes: await file.arrayBuffer(),
          name,
          mimeType: file.type || null,
          appUserId: appUser.id,
          source: 'web',
          storagePath,
        });

        // The client needs enough to render a chip and, later, to name the
        // file back to the user. It never needs the storage location.
        return {
          id: row.id,
          name: row.name,
          mime_type: row.mime_type,
          file_type: row.file_type,
          size_bytes: row.size_bytes,
        };
      }),
    );

    return NextResponse.json({ attachments: staged });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('[agent attachments] staging failed', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/agent/attachments?id=<uuid>
//
// Drop a staged file the user removed from the composer before sending. Only
// the uploader's own unconsumed rows are eligible — once a file has been filed
// somewhere it's the destination's copy that matters, and the staging row is
// history.
export async function DELETE(req: NextRequest) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { appUser } = authCtx;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data: row, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select('id, storage_path, storage_bucket')
    .eq('id', id)
    .eq('app_user_id', appUser.id)
    .eq('source', 'web')
    .is('consumed_at', null)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    // Already consumed, already gone, or never theirs — all the same answer.
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  await supabase.storage
    .from(row.storage_bucket || INBOUND_FILES_BUCKET)
    .remove([row.storage_path]);
  const { error: deleteError } = await supabase
    .from(INBOUND_FILES_TABLE)
    .delete()
    .eq('id', row.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
