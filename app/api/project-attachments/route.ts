import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logProjectActivity } from '@/lib/logProjectActivity';

// Create Supabase client with service role for storage operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - List all attachments for a project
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('project_attachments')
      .select(`
        *,
        users(id, name, avatar)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch attachments' },
      { status: 500 }
    );
  }
}

// POST - Upload a new attachment
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('project_id') as string;
    const uploadedBy = formData.get('uploaded_by') as string;

    if (!file || !projectId) {
      return NextResponse.json(
        { error: 'file and project_id are required' },
        { status: 400 }
      );
    }

    // Determine file type (image or video)
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      return NextResponse.json(
        { error: 'Invalid file type. Only images and videos are allowed.' },
        { status: 400 }
      );
    }

    // Validate file types
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mov'];

    if (isImage && !allowedImageTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid image type. Allowed: JPEG, PNG, WebP, GIF' },
        { status: 400 }
      );
    }

    if (isVideo && !allowedVideoTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid video type. Allowed: MP4, MOV, WebM' },
        { status: 400 }
      );
    }

    // Validate file size
    const maxImageSize = 10 * 1024 * 1024; // 10MB
    const maxVideoSize = 50 * 1024 * 1024; // 50MB
    const maxSize = isVideo ? maxVideoSize : maxImageSize;

    if (file.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxMB}MB for ${isVideo ? 'videos' : 'images'}.` },
        { status: 400 }
      );
    }

    // Check attachment count for this project (max 30)
    const { count, error: countError } = await supabase
      .from('project_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (countError) {
      console.error('Error checking attachment count:', countError);
    } else if (count !== null && count >= 30) {
      return NextResponse.json(
        { error: 'Maximum 30 attachments per project allowed.' },
        { status: 400 }
      );
    }

    // Create filename with timestamp to avoid collisions
    const fileExt = file.name.split('.').pop();
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${projectId}/${timestamp}_${sanitizedName}`;

    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('project-attachments')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      console.error('Supabase storage error:', uploadError);
      return NextResponse.json(
        { error: uploadError.message || 'Failed to upload file' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('project-attachments')
      .getPublicUrl(fileName);

    // Insert record into database
    const { data: attachment, error: dbError } = await supabase
      .from('project_attachments')
      .insert({
        project_id: projectId,
        url: publicUrl,
        file_name: file.name,
        file_type: isVideo ? 'video' : 'image',
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: uploadedBy || null
      })
      .select(`
        *,
        users(id, name, avatar)
      `)
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Try to clean up the uploaded file
      await supabase.storage.from('project-attachments').remove([fileName]);
      return NextResponse.json(
        { error: dbError.message || 'Failed to save attachment record' },
        { status: 500 }
      );
    }

    // Log activity
    if (uploadedBy) {
      const fileType = isVideo ? 'video' : 'image';
      await logProjectActivity(projectId, uploadedBy, 'attachment_upload', `uploaded ${fileType}: ${file.name}`, null, publicUrl);
    }

    return NextResponse.json({
      success: true,
      data: attachment
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to upload attachment' },
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
    const { data: attachment, error: fetchError } = await supabase
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
      const { error: storageError } = await supabase.storage
        .from('project-attachments')
        .remove([filePath]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        // Continue to delete DB record even if storage delete fails
      }
    }

    // Delete from database
    const { error: dbError } = await supabase
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
  } catch (err: any) {
    console.error('Delete error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}

