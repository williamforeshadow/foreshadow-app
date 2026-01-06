import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function logProjectActivity(
  projectId: string,
  userId: string,
  actionType: string,
  description: string,
  oldValue?: string | null,
  newValue?: string | null
) {
  try {
    const { error } = await supabase
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

