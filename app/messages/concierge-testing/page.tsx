'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FlaskConical,
  SendHorizontal,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface TestTurn {
  role: 'guest' | 'host';
  text: string;
}

type TestScenario = 'checked_in' | 'upcoming' | 'past' | 'inquiry';

const SCENARIO_OPTIONS: { value: TestScenario; label: string }[] = [
  { value: 'checked_in', label: 'Currently checked in' },
  { value: 'upcoming', label: 'Upcoming reservation' },
  { value: 'past', label: 'Past stay (checked out)' },
  { value: 'inquiry', label: 'Inquiry (not booked)' },
];

export default function ConciergeTestingPage() {
  const isMobile = useIsMobile();
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const propsRes = await fetch('/api/properties').then((r) => r.json());
        if (!active) return;
        setProperties(
          Array.isArray(propsRes?.properties)
            ? propsRes.properties.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
            : [],
        );
      } catch {
        if (active) setProperties([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const content = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg-soft)] text-[var(--accent-3)]">
          <FlaskConical className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Concierge Testing</h1>
          <p className="text-sm text-muted-foreground">
            Chat as a guest and see exactly how the concierge would reply — without sending anything.
          </p>
        </div>
      </header>

      <TestConsole properties={properties} loadingProperties={loading} />
    </div>
  );

  return isMobile ? (
    <MobileRouteShell backHref="/messages" title="Concierge Testing">
      {content}
    </MobileRouteShell>
  ) : (
    <DesktopSidebarShell>
      <div className="glass-bg-neutral flex h-full p-2.5">
        <div className="msg-pane flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="msg-divider shrink-0 border-b px-4 py-2.5">
            <Link
              href="/messages"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to Messages
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar">{content}</div>
        </div>
      </div>
    </DesktopSidebarShell>
  );
}

function TestConsole({
  properties,
  loadingProperties,
}: {
  properties: PropertyOption[];
  loadingProperties: boolean;
}) {
  const [propertyId, setPropertyId] = useState<string>('');
  const [guestName, setGuestName] = useState<string>('');
  const [scenario, setScenario] = useState<TestScenario>('checked_in');
  const [turns, setTurns] = useState<TestTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ready = propertyId.length > 0;

  // Changing the property or scenario changes the test identity mid-thread,
  // which would make an in-progress conversation incoherent — so reset it.
  const changeProperty = (v: string) => {
    setPropertyId(v);
    setTurns([]);
    setError(null);
  };
  const changeScenario = (v: TestScenario) => {
    setScenario(v);
    setTurns([]);
    setError(null);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const reset = () => {
    setTurns([]);
    setInput('');
    setError(null);
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !ready || sending) return;
    const nextTurns: TestTurn[] = [...turns, { role: 'guest', text }];
    setTurns(nextTurns);
    setInput('');
    setError(null);
    setSending(true);
    try {
      const res = await fetch('/api/concierge-training/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          guest_name: guestName.trim(),
          scenario,
          messages: nextTurns.map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to generate a reply');
      setTurns((prev) => [...prev, { role: 'host', text: typeof data.reply === 'string' ? data.reply : '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a reply');
    } finally {
      setSending(false);
    }
  }, [input, ready, sending, turns, propertyId, guestName, scenario]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Test identity controls */}
      <div className="msg-well flex flex-wrap items-end gap-3 rounded-xl p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Property</Label>
          <Select value={propertyId} onValueChange={changeProperty}>
            <SelectTrigger className="w-[200px]" disabled={loadingProperties}>
              <SelectValue placeholder={loadingProperties ? 'Loading…' : 'Select a property'} />
            </SelectTrigger>
            <SelectContent>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Guest status</Label>
          <Select value={scenario} onValueChange={(v) => changeScenario(v as TestScenario)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENARIO_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-guest" className="text-xs">Guest name</Label>
          <Input
            id="test-guest"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="e.g. Jordan"
            className="w-[150px]"
          />
        </div>
        {turns.length > 0 && (
          <Button variant="outline" size="sm" onClick={reset} className="ml-auto rounded-full">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            New conversation
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Messages run through the live concierge exactly as a real guest at this property would — the AI
        doesn’t know it’s a test. Nothing here is saved or sent.
      </p>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="msg-well flex min-h-[280px] flex-col gap-3 overflow-y-auto rounded-xl p-4 overlay-scrollbar"
      >
        {turns.length === 0 && !sending ? (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            {ready
              ? 'Type a guest message below to see how the concierge replies.'
              : 'Select a property to start testing.'}
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === 'guest' ? (
              <div key={i} className="msg-in flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--accent-3)] px-3.5 py-2 text-sm text-white">
                  <p className="whitespace-pre-wrap break-words">{t.text}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="msg-in flex flex-col items-start">
                <span className="mb-0.5 ml-1 text-[11px] font-medium text-muted-foreground">Concierge</span>
                <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white/85 px-3.5 py-2 text-sm text-foreground ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.06]">
                  <p className="whitespace-pre-wrap break-words">{t.text}</p>
                </div>
              </div>
            ),
          )
        )}
        {sending && (
          <div className="msg-in flex flex-col items-start">
            <span className="mb-0.5 ml-1 text-[11px] font-medium text-muted-foreground">Concierge</span>
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white/85 px-3.5 py-2 text-sm text-muted-foreground ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.06]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Composer */}
      <div className="msg-well flex items-end gap-2 rounded-2xl px-2 py-2 transition-[border-color,box-shadow] focus-within:border-[var(--accent-3)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)] dark:focus-within:ring-[var(--accent-ring-dark)]">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!ready || sending}
          placeholder={ready ? 'Message as the guest…' : 'Select a property first'}
          className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready || sending || !input.trim()}
          aria-label="Send test message"
          className="mb-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
