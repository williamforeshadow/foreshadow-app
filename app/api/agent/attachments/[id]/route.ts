import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/requireAuthContext';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { INBOUND_FILES_TABLE } from '@/src/server/agent/inboundFiles';
import { loadRenderableByInboundFileId } from '@/src/server/agent/inboundFileVisionPrep';

// GET /api/agent/attachments/[id]
//
// Serve a staged attachment's bytes as something a browser can actually paint,
// so the chat can show the photo the user sent instead of just its filename.
// The staging bucket is private and the client never holds a URL, so the image
// has to come back through here.
//
// The bytes are the RENDERABLE form, not the raw upload: loadRenderableByInbound-
// FileId transcodes a HEIC (which no browser renders) to JPEG and normalises
// odd formats, exactly as it does for the model. It reads from storage_path
// directly, so a file works the instant it's staged — it doesn't wait on the
// after() vision-prep that runs post-upload.
//
// Scoped to the uploader's own web files. These are the user's own composer
// uploads echoed back into their own thread; nobody else's id resolves here.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authCtx = await requireAuthContext();
  if (authCtx instanceof NextResponse) return authCtx;
  const { appUser } = authCtx;
  const { id } = await params;

  const supabase = getSupabaseServer();
  const { data: owned, error } = await supabase
    .from(INBOUND_FILES_TABLE)
    .select('id')
    .eq('id', id)
    .eq('app_user_id', appUser.id)
    .eq('source', 'web')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!owned) {
    // Not theirs, never existed, or already cleaned up — all one answer.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const renderable = await loadRenderableByInboundFileId(id);
  // null = download failed or a format we can't normalise (e.g. a video). The
  // client only asks for images and falls back to the filename chip on error.
  if (!renderable) {
    return NextResponse.json({ error: 'Not renderable' }, { status: 415 });
  }

  const bytes = Buffer.from(renderable.base64, 'base64');
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': renderable.mediaType,
      'Content-Length': String(bytes.byteLength),
      // Immutable per id — the bytes for a staged file never change — so let
      // the browser keep it. Private: it's the user's own file behind auth.
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  });
}
