'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSupabaseClient } from '@/lib/supabaseAuth';
import { useAuth } from '@/lib/authContext';

export default function UpdatePasswordClient() {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, router, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    try {
      await refreshUser();
    } catch {
      // The Auth password update succeeded; the app profile can refresh after redirect.
    }

    router.replace('/');
    router.refresh();
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f5f2] text-neutral-950 dark:bg-[#111114] dark:text-white">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#f6f5f2] text-neutral-950 dark:bg-[#111114] dark:text-white">
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#17171b]">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-semibold tracking-normal">Choose a new password</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Update the password for {user.email}.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#17171b]"
          >
            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                  New password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="pr-11"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium">
                  Confirm password
                </label>
                <Input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Updating...' : 'Update password'}
                {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
