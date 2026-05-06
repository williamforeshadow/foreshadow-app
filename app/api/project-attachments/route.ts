import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logProjectActivity } from '@/lib/logProjectActivity';

const MAX_ATTACHMENTS = 30;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/mov',
]);
const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
]);

type AttachmentKind = 'image' | 'video' | 'document';

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function classifyAttachment(file: File): AttachmentKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (ALLOWED_DOCUMENT_TYPES.has(file.type)) return 'document';
  if (!file.type && ALLOWED_DOCUMENT_EXTENSIONS.has(getExtension(file.name))) {
    return 'document';
  }
  return null;
}

function validateAttachment(file: File, kind: AttachmentKind): string | null {
  if (kind === 'image' && !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'Invalid image type. Allowed: JPEG, PNG, WebP, GIF';
  }
  if (kind === 'video' && !ALLOWED_VIDEO_TYPES.has(file.type)) {
    return 'Invalid video type. Allowed: MP4, MOV, WebM';
  }
  if (
    kind === 'document' &&
    file.type &&
    !ALLOWED_DOCUMENT_TYPES.has(file.type)
  ) {
    return 'Invalid document type. Allowed: PDF, Word, Excel, CSV, TXT';
  }

  const maxSize =
    kind === 'video'
      ? MAX_VIDEO_BYTES
      : kind === 'document'
        ? MAX_DOCUMENT_BYTES
        : MAX_IMAGE_BYTES;

  if (file.size > maxSize) {
    const maxMB = maxSize / (1024 * 1024);
    return `File too large. Maximum size is ${maxMB}MB for ${kind}s.`;
  }

  return null;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

// GET - List all attachments for a project or task
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    const taskId = searchParams.get('task_id');

    if (!projectId && !taskId) {
      return NextResponse.json(
        { error: 'project_id or task_id is required' },
        { status: 400 }
      );
    }

    let query = getSupabaseServer()
      .from('project_attachments')
      .select(`
        *,
        users(id, name, avatar)
      `)
      .order('created_at', { ascending: false });

    if (taskId) {
      query = query.eq('task_id', taskId);
    } else {
      query = query.eq('project_id', projectId!);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: errorMessage(err, 'Failed to fetch attachments') },
      { status: 500 }
    );
  }
}

// POST - Upload a new attachment
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('project_id') as string | null;
    const taskId = formData.get('task_id') as string | null;
    const uploadedBy = formData.get('uploaded_by') as string;

    if (!file || (!projectId && !taskId)) {
      return NextResponse.json(
        { error: 'file and (project_id or task_id) are required' },
        { status: 400 }
      );
    }

    const entityId = taskId || projectId!;

    const attachmentKind = classifyAttachment(file);
    if (!attachmentKind) {
      return NextResponse.json(
        {
          error:
            'Invalid file type. Allowed: images, videos, PDF, Word, Excel, CSV, TXT.',
        },
        { status: 400 }
      );
    }

    const validationError = validateAttachment(file, attachmentKind);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    // Check attachment count for this entity (max 30)
    let countQuery = getSupabaseServer()
      .from('project_attachments')
      .select('*', { count: 'exact', head: true });
    if (taskId) {
      countQuery = countQuery.eq('task_id', taskId);
    } else {
      countQuery = countQuery.eq('project_id', projectId!);
    }
    const { count, error: countError } = await countQuery;

    if (countError) {
      console.error('Error checking attachment count:', countError);
    } else if (count !== null && count >= MAX_ATTACHMENTS) {
      return NextResponse.json(
        {
          error: `Maximum ${MAX_ATTACHMENTS} attachments per ${
            taskId ? 'task' : 'project'
          } allowed.`,
        },
        { status: 400 }
      );
    }

    // Create filename with timestamp to avoid collisions
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${entityId}/${timestamp}_${sanitizedName}`;

    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to getSupabaseServer() Storage
    const { error: uploadError } = await getSupabaseServer().storage
      .from('project-attachments')
      .upload(fileName, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      });

    if (uploadError) {
      console.error('getSupabaseServer() storage error:', uploadError);
      return NextResponse.json(
        { error: uploadError.message || 'Failed to upload file' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = getSupabaseServer().storage
      .from('project-attachments')
      .getPublicUrl(fileName);

    // Insert record into database
    const insertData: Record<string, unknown> = {
      url: publicUrl,
      file_name: file.name,
      file_type: attachmentKind,
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by: uploadedBy || null,
    };
    if (taskId) insertData.task_id = taskId;
    if (projectId) insertData.project_id = projectId;

    const firstInsert = await getSupabaseServer()
      .from('project_attachments')
      .insert(insertData)
      .select(`
        *,
        users(id, name, avatar)
      `)
      .single();
    let attachment = firstInsert.data;
    let dbError = firstInsert.error;

    if (
      dbError &&
      attachmentKind === 'document' &&
      dbError.message.includes('project_attachments_file_type_check')
    ) {
      const fallbackInsert = await getSupabaseServer()
        .from('project_attachments')
        .insert({ ...insertData, file_type: 'image' })
        .select(`
          *,
          users(id, name, avatar)
        `)
        .single();
      attachment = fallbackInsert.data;
      dbError = fallbackInsert.error;
    }

    if (dbError) {
      console.error('Database error:', dbError);
      // Try to clean up the uploaded file
      await getSupabaseServer().storage.from('project-attachments').remove([fileName]);
      return NextResponse.json(
        { error: dbError.message || 'Failed to save attachment record' },
        { status: 500 }
      );
    }

    // Log activity (only for projects — tasks don't have activity log yet)
    if (uploadedBy && projectId) {
      await logProjectActivity(
        projectId,
        uploadedBy,
        'attachment_upload',
        `uploaded ${attachmentKind}: ${file.name}`,
        null,
        publicUrl
      );
    }

    return NextResponse.json({
      success: true,
      data: attachment
    });
  } catch (err: unknown) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: errorMessage(err, 'Failed to upload attachment') },
      { status: 500 }
    );
  }
}

// DELETE - Remove an attachment
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('id');

    if (!attachmentId) {
      return NextResponse.json(
        { error: 'Attachment id is required' },
        { status: 400 }
      );
    }

    // Get the attachment record first to get the file path
    const { data: attachment, error: fetchError } = await getSupabaseServer()
      .from('project_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json(
        { error: 'Attachment not found' },
        { status: 404 }
      );
    }

    // Extract file path from URL
    const url = new URL(attachment.url);
    const pathParts = url.pathname.split('/project-attachments/');
    const filePath = pathParts[1] ? decodeURIComponent(pathParts[1]) : null;

    // Delete from storage
    if (filePath) {
      const { error: storageError } = await getSupabaseServer().storage
        .from('project-attachments')
        .remove([filePath]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        // Continue to delete DB record even if storage delete fails
      }
    }

    // Delete from database
    const { error: dbError } = await getSupabaseServer()
      .from('project_attachments')
      .delete()
      .eq('id', attachmentId);

    if (dbError) {
      return NextResponse.json(
        { error: dbError.message || 'Failed to delete attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Delete error:', err);
    return NextResponse.json(
      { error: errorMessage(err, 'Failed to delete attachment') },
      { status: 500 }
    );
  }
}

