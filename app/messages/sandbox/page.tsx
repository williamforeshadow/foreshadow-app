'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FlaskConical, Plus, Trash2, Loader2, ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PropertyOption {
  id: string;
  name: string;
}

interface SandboxConversation {
  id: string;
  guest_name: string | null;
  property_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  message_count: number | null;
  app_status: string | null;
}

const PRESETS: { label: string; body: string; hint: string }[] = [
  {
    label: 'Maintenance issue',
    body: 'Hi, the air conditioning in the unit isn’t cooling at all and it’s getting really hot in here. Can someone take a look?',
    hint: 'Should trigger a proposed task',
  },
  {
    label: 'Simple question',
    body: 'Hey! What time is check-in, and is there parking on site?',
    hint: 'No task — reply only',
  },
  {
    label: 'Friendly greeting',
    body: 'Hi there! We’re so excited for our stay this weekend. Anything we should know before we arrive?',
    hint: 'No task — reply only',
  },
];

export default function MessagesSandboxPage() {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [guestName, setGuestName] = useState('Sandbox Guest');
  const [bookingState, setBookingState] = useState<'booked' | 'inquiry'>('booked');
  const [message, setMessage] = useState(PRESETS[0].body);
  const [generate, setGenerate] = useState(true);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convos, setConvos] = useState<SandboxConversation[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-conversation "append message" state.
  const [appendFor, setAppendFor] = useState<string | null>(null);
  const [appendRole, setAppendRole] = useState<'guest' | 'host'>('guest');
  const [appendBody, setAppendBody] = useState('');
  const [appendGenerate, setAppendGenerate] = useState(true);
  const [appending, setAppending] = useState(false);

  const loadSandbox = useCallback(async () => {
    const res = await fetch('/api/dev/sandbox', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setConvos(Array.isArray(data.conversations) ? data.conversations : []);
    } else if (res.status === 403) {
      setError('Sandbox is disabled in this environment (production).');
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [propsRes] = await Promise.all([
        fetch('/api/properties').then((r) => r.json()).catch(() => ({})),
        loadSandbox(),
      ]);
      if (!active) return;
      const list: PropertyOption[] = Array.isArray(propsRes?.properties)
        ? propsRes.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
        : [];
      setProperties(list);
      if (list[0]) setPropertyId((cur) => cur || list[0].id);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadSandbox]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          property_id: propertyId || undefined,
          guest_name: guestName,
          booking_state: bookingState,
          generate,
          messages: message.trim() ? [{ role: 'guest', body: message.trim() }] : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to create');
      await loadSandbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const append = async (conversationId: string) => {
    if (!appendBody.trim()) return;
    setAppending(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append',
          conversation_id: conversationId,
          role: appendRole,
          body: appendBody.trim(),
          generate: appendGenerate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to add message');
      setAppendBody('');
      await loadSandbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add message');
    } finally {
      setAppending(false);
    }
  };

  const resetAll = async () => {
    if (!confirm('Delete ALL sandbox conversations? This cannot be undone.')) return;
    setError(null);
    try {
      const res = await fetch('/api/dev/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to reset');
      await loadSandbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/messages"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Messages
        </Link>

        <header className="mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg-soft)] text-[var(--accent-3)]">
            <FlaskConical className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Messages Sandbox</h1>
            <p className="text-sm text-muted-foreground">
              Spin up fake conversations that look real to the inbox and the AI — no Hostaway needed.
              Dev only.
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Create */}
        <Card className="mb-6">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Property</Label>
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger disabled={loading}>
                    <SelectValue placeholder={loading ? 'Loading…' : 'Select a property'} />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Guest name</Label>
                <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Stay</Label>
              <Select value={bookingState} onValueChange={(v) => setBookingState(v as 'booked' | 'inquiry')}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked">Booked (checked in now)</SelectItem>
                  <SelectItem value="inquiry">Inquiry (not booked)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">First guest message</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setMessage(p.body)}
                    title={p.hint}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="resize-y" />
            </div>

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={generate}
                  onChange={(e) => setGenerate(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300 accent-[var(--accent-3)]"
                />
                Run the AI (proposed reply + task)
              </label>
              <Button onClick={create} disabled={creating || loading}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create conversation
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Existing sandbox conversations */}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Sandbox conversations {convos.length > 0 ? `(${convos.length})` : ''}
          </h2>
          {convos.length > 0 && (
            <Button variant="outline" size="sm" onClick={resetAll}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete all
            </Button>
          )}
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : convos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            No sandbox conversations yet. Create one above.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {convos.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{c.guest_name ?? 'Guest'}</span>
                        <span className="text-xs text-muted-foreground">· {c.property_name ?? 'No property'}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.app_status}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {c.message_count ?? 0} msgs · {c.last_message_preview || '—'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Link
                        href={`/messages/${c.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--accent-3)] hover:underline"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                      <button
                        onClick={() => {
                          setAppendFor((cur) => (cur === c.id ? null : c.id));
                          setAppendBody('');
                        }}
                        className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Add message
                      </button>
                    </div>
                  </div>

                  {appendFor === c.id && (
                    <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
                      <div className="flex items-center gap-2">
                        <div className="inline-flex gap-1 rounded-md border border-border bg-background p-0.5">
                          {(['guest', 'host'] as const).map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setAppendRole(r)}
                              className={`rounded px-2 py-1 text-xs font-medium capitalize transition-colors ${
                                appendRole === r ? 'bg-[var(--accent-3)] text-white' : 'text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={appendGenerate}
                            onChange={(e) => setAppendGenerate(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-neutral-300 accent-[var(--accent-3)]"
                          />
                          Run AI (guest only)
                        </label>
                      </div>
                      <Textarea
                        value={appendBody}
                        onChange={(e) => setAppendBody(e.target.value)}
                        rows={2}
                        placeholder={appendRole === 'guest' ? 'Message as the guest…' : 'Message as the host…'}
                        className="resize-y text-sm"
                      />
                      <div className="flex justify-end">
                        <Button size="sm" onClick={() => append(c.id)} disabled={appending || !appendBody.trim()}>
                          {appending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                          Send
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
