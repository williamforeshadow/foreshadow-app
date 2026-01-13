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
    const { error } = await getSupabaseServer()
      .from('project_activity_log')
      .insert({
        project_id: projectId,
        user_id: userId,
        action_type: actionType,
        description,
        old_value: oldValue || null,
        new_value: newValue || null
      });

    if (error) {
      console.error('Error logging activity:', error);
    }
  } catch (err) {
    console.error('Error in logProjectActivity:', err);
  }
}

