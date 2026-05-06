import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logPropertyKnowledgeActivity, type KnowledgeSource } from '@/lib/logPropertyKnowledgeActivity';
import { SLACK_INBOUND_BUCKET } from './inboundFiles';

const documentTagSchema = z.enum([
  'lease',
  'appliance_manual',
  'inspection',
  'insurance',
  'other',
]);

export const slackFileAttachmentInputSchema = z.discriminatedUnion('destination', [
  z.object({
    destination: z.literal('task_attachment'),
    inbound_file_id: z.string().uuid(),
    task_id: z.string().uuid(),
    actor_user_id: z.string().nullable().optional(),
  }),
  z.object({
    destination: z.literal('property_document'),
    inbound_file_id: z.string().uuid(),
    property_id: z.string().uuid(),
    tag: documentTagSchema.default('other'),
    title: z.string().optional(),
    notes: z.string().nullable().optional(),
    actor_user_id: z.string().nullable().optional(),
    source: z.enum(['agent_slack', 'agent_web', 'web', 'system']).optional(),
  }),
  z.object({
    destination: z.literal('property_room_photo'),
    inbound_file_id: z.string().uuid(),
    property_id: z.string().uuid(),
    room_id: z.string().uuid(),
    caption: z.string().nullable().optional(),
  }),
  z.object({
    destination: z.literal('property_card_photo'),
    inbound_file_id: z.string().uuid(),
    property_id: z.string().uuid(),
    card_id: z.string().uuid(),
    caption: z.string().nullable().optional(),
  }),
  z.object({
    destination: z.literal('property_tech_account_photo'),
    inbound_file_id: z.string().uuid(),
    property_id: z.string().uuid(),
    account_id: z.string().uuid(),
  }),
]);

export type SlackFileAttachmentInput = z.infer<typeof slackFileAttachmentInputSchema>;

export interface SlackFileAttachmentPlan {
  destination: SlackFileAttachmentInput['destination'];
  inbound_file: {
    id: string;
    name: string;
    file_type: string;
    mime_type: string | null;
    size_bytes: number | null;
  };
  target: { type: string; id: string; label: string };
  summary: string;
}

export type PreviewSlackFileAttachmentResult =
  | {
      ok: true;
      plan: SlackFileAttachmentPlan;
      canonicalInput: SlackFileAttachmentInput;
    }
  | { ok: false; error: { code: 'invalid_input' | 'not_found' | 'db_error'; message: string; field?: string } };

export type SlackFileAttachmentResult =
  | { ok: true; plan: SlackFileAttachmentPlan; row: unknown }
  | { ok: false; error: { code: 'invalid_input' | 'not_found' | 'db_error'; message: string; field?: string } };

interface InboundFileRow {
  id: string;
  storage_bucket: string;
  storage_path: string;
  name: string;
  title: string | null;
  mime_type: string | null;
  file_type: 'image' | 'video' | 'document' | 'other';
  size_bytes: number | null;
}

type Supabase = ReturnType<typeof getSupabaseServer>;

function randomSegment(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function extension(name: string) {
  return (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'bin').toLowerCase();
}

function safeName(raw: string) {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'slack-file';
}

function isImage(file: InboundFileRow) {
  return file.mime_type?.startsWith('image/') || file.file_type === 'image';
}

async function loadInboundFile(
  supabase: Supabase,
  inboundFileId: string,
): Promise<InboundFileRow | null> {
  const { data, error } = await supabase
    .from('slack_inbound_files')
    .select('id, storage_bucket, storage_path, name, title, mime_type, file_type, size_bytes')
    .eq('id', inboundFileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as InboundFileRow | null) ?? null;
}

async function downloadInboundBytes(
  supabase: Supabase,
  file: InboundFileRow,
): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage
    .from(file.storage_bucket || SLACK_INBOUND_BUCKET)
    .download(file.storage_path);
  if (error || !data) throw new Error(error?.message || 'Failed to download inbound file');
  return data.arrayBuffer();
}

async function markConsumed(
  supabase: Supabase,
  inboundFileId: string,
  destination: string,
) {
  await supabase
    .from('slack_inbound_files')
    .update({
      consumed_at: new Date().toISOString(),
      consumed_destination: destination,
    })
    .eq('id', inboundFileId);
}

async function buildPlan(
  supabase: Supabase,
  input: SlackFileAttachmentInput,
  file: InboundFileRow,
): Promise<PreviewSlackFileAttachmentResult> {
  if (input.destination === 'task_attachment') {
    const { data, error } = await supabase
      .from('turnover_tasks')
      .select('id, title, property_name, templates(name)')
      .eq('id', input.task_id)
      .maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    if (!data) return { ok: false, error: { code: 'not_found', message: 'Task not found.', field: 'task_id' } };
    const row = data as { id: string; title: string | null; property_name: string | null; templates?: { name?: string } | null };
    const label = row.title || row.templates?.name || 'Untitled task';
    return {
      ok: true,
      plan: {
        destination: input.destination,
        inbound_file: file,
        target: { type: 'task', id: row.id, label },
        summary: `Attach "${file.name}" to task "${label}"${row.property_name ? ` at ${row.property_name}` : ''}.`,
      },
      canonicalInput: input,
    };
  }

  if (input.destination === 'property_document') {
    const { data, error } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', input.property_id)
      .maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    if (!data) return { ok: false, error: { code: 'not_found', message: 'Property not found.', field: 'property_id' } };
    return {
      ok: true,
      plan: {
        destination: input.destination,
        inbound_file: file,
        target: { type: 'property_document', id: data.id, label: data.name },
        summary: `Add "${file.name}" to ${data.name} Property Knowledge documents as ${input.tag}.`,
      },
      canonicalInput: input,
    };
  }

  if (!isImage(file)) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Only image files can be attached as Property Knowledge photos.',
        field: 'inbound_file_id',
      },
    };
  }

  if (input.destination === 'property_room_photo') {
    const { data, error } = await supabase
      .from('property_rooms')
      .select('id, title, type')
      .eq('id', input.room_id)
      .eq('property_id', input.property_id)
      .maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    if (!data) return { ok: false, error: { code: 'not_found', message: 'Room not found.', field: 'room_id' } };
    return {
      ok: true,
      plan: {
        destination: input.destination,
        inbound_file: file,
        target: { type: 'property_room_photo', id: data.id, label: data.title || data.type },
        summary: `Add "${file.name}" as a photo on room "${data.title || data.type}".`,
      },
      canonicalInput: input,
    };
  }

  if (input.destination === 'property_card_photo') {
    const { data, error } = await supabase
      .from('property_cards')
      .select('id, title, tag')
      .eq('id', input.card_id)
      .eq('property_id', input.property_id)
      .maybeSingle();
    if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
    if (!data) return { ok: false, error: { code: 'not_found', message: 'Card not found.', field: 'card_id' } };
    return {
      ok: true,
      plan: {
        destination: input.destination,
        inbound_file: file,
        target: { type: 'property_card_photo', id: data.id, label: data.title || data.tag },
        summary: `Add "${file.name}" as a photo on card "${data.title || data.tag}".`,
      },
      canonicalInput: input,
    };
  }

  const { data, error } = await supabase
    .from('property_tech_accounts')
    .select('id, service_name, kind')
    .eq('id', input.account_id)
    .eq('property_id', input.property_id)
    .maybeSingle();
  if (error) return { ok: false, error: { code: 'db_error', message: error.message } };
  if (!data) return { ok: false, error: { code: 'not_found', message: 'Tech account not found.', field: 'account_id' } };
  const accountLabel = data.service_name || data.kind || 'Tech account';
  return {
    ok: true,
    plan: {
      destination: input.destination,
      inbound_file: file,
      target: { type: 'property_tech_account_photo', id: data.id, label: accountLabel },
      summary: `Add "${file.name}" as a photo on tech account "${accountLabel}".`,
    },
    canonicalInput: input,
  };
}

export async function previewSlackFileAttachment(
  rawInput: unknown,
): Promise<PreviewSlackFileAttachmentResult> {
  const parsed = slackFileAttachmentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: first?.message ?? 'invalid input',
        field: first?.path.join('.') || undefined,
      },
    };
  }
  const supabase = getSupabaseServer();
  try {
    const file = await loadInboundFile(supabase, parsed.data.inbound_file_id);
    if (!file) {
      return {
        ok: false,
        error: { code: 'not_found', message: 'Slack inbound file not found.', field: 'inbound_file_id' },
      };
    }
    return buildPlan(supabase, parsed.data, file);
  } catch (err) {
    return {
      ok: false,
      error: { code: 'db_error', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function commitSlackFileAttachment(
  rawInput: unknown,
): Promise<SlackFileAttachmentResult> {
  const preview = await previewSlackFileAttachment(rawInput);
  if (!preview.ok) return { ok: false, error: preview.error };
  const input = preview.canonicalInput;
  const supabase = getSupabaseServer();

  try {
    const file = await loadInboundFile(supabase, input.inbound_file_id);
    if (!file) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: 'Slack inbound file not found.',
          field: 'inbound_file_id',
        },
      };
    }
    const bytes = await downloadInboundBytes(supabase, file);
    const contentType = file.mime_type || 'application/octet-stream';
    const ext = extension(file.name);

    if (input.destination === 'task_attachment') {
      const storagePath = `${input.task_id}/${Date.now()}_${safeName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from('project-attachments')
        .upload(storagePath, bytes, { contentType, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { data: publicData } = supabase.storage
        .from('project-attachments')
        .getPublicUrl(storagePath);
      const { data, error } = await supabase
        .from('project_attachments')
        .insert({
          task_id: input.task_id,
          url: publicData.publicUrl,
          file_name: file.name,
          file_type: file.file_type === 'other' ? 'document' : file.file_type,
          mime_type: file.mime_type,
          file_size: file.size_bytes,
          uploaded_by: input.actor_user_id ?? null,
        })
        .select('*')
        .maybeSingle();
      if (error || !data) {
        await supabase.storage.from('project-attachments').remove([storagePath]);
        throw new Error(error?.message || 'Failed to record task attachment');
      }
      await markConsumed(supabase, input.inbound_file_id, `task:${input.task_id}`);
      return { ok: true, plan: preview.plan, row: data };
    }

    if (input.destination === 'property_document') {
      const title = (input.title?.trim() || file.title || file.name).trim();
      const storagePath = `properties/${input.property_id}/documents/${randomSegment(16)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('property-documents')
        .upload(storagePath, bytes, { contentType, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { data, error } = await supabase
        .from('property_documents')
        .insert({
          property_id: input.property_id,
          tag: input.tag,
          title,
          notes: input.notes ?? null,
          storage_path: storagePath,
          mime_type: file.mime_type,
          size_bytes: file.size_bytes,
          original_filename: file.name,
          created_by_user_id: input.actor_user_id ?? null,
          updated_by_user_id: input.actor_user_id ?? null,
        })
        .select('*')
        .maybeSingle();
      if (error || !data) {
        await supabase.storage.from('property-documents').remove([storagePath]);
        throw new Error(error?.message || 'Failed to record property document');
      }
      await logPropertyKnowledgeActivity({
        property_id: input.property_id,
        user_id: input.actor_user_id ?? null,
        resource_type: 'document',
        resource_id: data.id,
        action: 'create',
        changes: { kind: 'snapshot', row: { tag: data.tag, title: data.title, original_filename: data.original_filename, size_bytes: data.size_bytes } },
        subject_label: data.title || data.original_filename,
        source: input.source ?? ('agent_slack' as KnowledgeSource),
      });
      await markConsumed(supabase, input.inbound_file_id, `property_document:${input.property_id}`);
      return { ok: true, plan: preview.plan, row: data };
    }

    const photoTarget =
      input.destination === 'property_room_photo'
        ? { bucketPath: `properties/${input.property_id}/rooms/${input.room_id}/${randomSegment(16)}.${ext}`, table: 'property_room_photos', fk: 'room_id', id: input.room_id, countField: 'room_id', max: 50, caption: input.caption ?? null }
        : input.destination === 'property_card_photo'
          ? { bucketPath: `properties/${input.property_id}/cards/${input.card_id}/${randomSegment(16)}.${ext}`, table: 'property_card_photos', fk: 'card_id', id: input.card_id, countField: 'card_id', max: 20, caption: input.caption ?? null }
          : { bucketPath: `properties/${input.property_id}/tech-accounts/${input.account_id}/${randomSegment(16)}.${ext}`, table: 'property_tech_account_photos', fk: 'account_id', id: input.account_id, countField: 'account_id', max: 10, caption: null };

    const { count } = await supabase
      .from(photoTarget.table)
      .select('*', { count: 'exact', head: true })
      .eq(photoTarget.countField, photoTarget.id);
    if ((count ?? 0) >= photoTarget.max) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: `Photo limit reached (${photoTarget.max}).` },
      };
    }

    const { error: uploadError } = await supabase.storage
      .from('property-photos')
      .upload(photoTarget.bucketPath, bytes, { contentType, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const insertPayload: Record<string, unknown> = {
      [photoTarget.fk]: photoTarget.id,
      storage_path: photoTarget.bucketPath,
      sort_order: count ?? 0,
    };
    if (photoTarget.caption !== null) insertPayload.caption = photoTarget.caption;
    const { data, error } = await supabase
      .from(photoTarget.table)
      .insert(insertPayload)
      .select('*')
      .maybeSingle();
    if (error || !data) {
      await supabase.storage.from('property-photos').remove([photoTarget.bucketPath]);
      throw new Error(error?.message || 'Failed to record property photo');
    }
    await markConsumed(supabase, input.inbound_file_id, `${input.destination}:${photoTarget.id}`);
    return { ok: true, plan: preview.plan, row: data };
  } catch (err) {
    return {
      ok: false,
      error: { code: 'db_error', message: err instanceof Error ? err.message : String(err) },
    };
  }
}
