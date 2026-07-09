import { getSupabaseServer } from '@/lib/supabaseServer';

export async function logProjectActivity(
  projectId: string,
  userId: string,
  actionType: string,
  description: string,
  oldValue?: string | null,
  newValue?: string | null
) {
  try {
    const supabase = getSupabaseServer();

    // Service-role insert bypasses RLS, so stamp org_id explicitly — derived
    // from the project row itself so ledger rows always land in the project's
    // org (callers don't have to thread it).
    const { data: project } = await supabase
      .from('property_projects')
      .select('org_id')
      .eq('id', projectId)
      .maybeSingle();

    const { error } = await supabase
      .from('project_activity_log')
      .insert({
        project_id: projectId,
        user_id: userId,
        action_type: actionType,
        description,
        old_value: oldValue || null,
        new_value: newValue || null,
        org_id: (project as { org_id?: string | null } | null)?.org_id ?? null,
      });

    if (error) {
      console.error('Error logging activity:', error);
    }
  } catch (err) {
    console.error('Error in logProjectActivity:', err);
  }
}
