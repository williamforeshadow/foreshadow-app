import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const cleaningId = formData.get('cleaningId') as string;
    const fieldId = formData.get('fieldId') as string;

    if (!file || !cleaningId || !fieldId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' },
        { status: 400 }
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      );
    }

    // Create filename with timestamp to avoid collisions
    const fileExt = file.name.split('.').pop();
    const fileName = `${cleaningId}/${fieldId}_${Date.now()}.${fileExt}`;

    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to getSupabaseServer() Storage
    const { data, error } = await getSupabaseServer().storage
      .from('cleaning-photos')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false
      });

    if (error) {
      console.error('getSupabaseServer() storage error:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to upload photo' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = getSupabaseServer().storage
      .from('cleaning-photos')
      .getPublicUrl(fileName);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName: data.path
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to upload photo' },
      { status: 500 }
    );
  }
}

// DELETE endpoint to remove photos
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('fileName');

    if (!fileName) {
      return NextResponse.json(
        { error: 'Missing fileName parameter' },
        { status: 400 }
      );
    }

    const { error } = await getSupabaseServer().storage
      .from('cleaning-photos')
      .remove([fileName]);

    if (error) {
      return NextResponse.json(
        { error: error.message || 'Failed to delete photo' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete photo' },
      { status: 500 }
    );
  }
}

