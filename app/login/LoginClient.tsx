'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSupabaseClient } from '@/lib/supabaseAuth';
import { useAuth } from '@/lib/authContext';

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, refreshUser } = useAuth();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = searchParams.get('next') || '/';

  useEffect(() => {
    if (!loading && user) {
      router.replace(next);
    }
  }, [loading, next, router, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    try {
      await refreshUser();
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your Foreshadow profile');
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f5f2] text-neutral-950 dark:bg-[#111114] dark:text-white">
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#17171b]">
              <LockKeyhole className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-semibold tracking-normal">Sign in to Foreshadow</h1>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Use the account your Foreshadow profile is linked to.
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
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
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

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Signing in...' : 'Sign in'}
                {!submitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
