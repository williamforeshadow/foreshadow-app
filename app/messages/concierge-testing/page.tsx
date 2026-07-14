'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SendHorizontal,
  Loader2,
  RotateCcw,
  ChevronDown,
  Home,
  CalendarClock,
  Globe,
} from 'lucide-react';
import DesktopSidebarShell from '@/components/DesktopSidebarShell';
import MobileRouteShell from '@/components/mobile/MobileRouteShell';
import { useIsMobile } from '@/lib/useIsMobile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ProposedTask, type ProposedTaskData } from '@/components/messages/ProposedTask';
import { ProposedKnowledge, type ProposedKnowledgeData } from '@/components/messages/ProposedKnowledge';
import { cn } from '@/lib/utils';

interface PropertyOption {
  id: string;
  name: string;
}

// A back-and-forth turn sent to the test API (a guest message or a prior
// concierge reply). Notes and proposals are NOT turns — only real messages are.
interface ConversationTurn {
  role: 'guest' | 'host';
  text: string;
}

// Items rendered in the test transcript. 'guest'/'concierge' are real messages;
// 'note' explains a gated-out reply; 'task'/'knowledge' are DUMMY proposals
// rendered through the real inbox bubbles (nothing is persisted).
type TranscriptItem =
  | { kind: 'guest'; id: string; text: string }
  | { kind: 'concierge'; id: string; text: string }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'task'; id: string; data: ProposedTaskData }
  | { kind: 'knowledge'; id: string; data: ProposedKnowledgeData };

type TestScenario = 'checked_in' | 'upcoming' | 'past' | 'inquiry';

// `short` is what the inline composer trigger shows; `label` is the full
// dropdown option. Keeping the trigger terse is what keeps the bar minimal.
const SCENARIO_OPTIONS: { value: TestScenario; label: string; short: string }[] = [
  { value: 'checked_in', label: 'Currently checked in', short: 'Checked in' },
  { value: 'upcoming', label: 'Upcoming reservation', short: 'Upcoming' },
  { value: 'past', label: 'Past stay (checked out)', short: 'Past stay' },
  { value: 'inquiry', label: 'Inquiry (not booked)', short: 'Inquiry' },
];

// The OTA the simulated guest is on. Drives channel-aware tools: the concierge
// only recommends/links alternative properties listed on this channel. 'unknown'
// mirrors a source with no channel — alternatives can't be linked then.
type TestChannel = 'airbnb' | 'vrbo' | 'bookingcom' | 'expedia' | 'direct' | 'unknown';

const CHANNEL_OPTIONS: { value: TestChannel; label: string; short: string }[] = [
  { value: 'airbnb', label: 'Airbnb', short: 'Airbnb' },
  { value: 'vrbo', label: 'Vrbo', short: 'Vrbo' },
  { value: 'bookingcom', label: 'Booking.com', short: 'Booking' },
  { value: 'expedia', label: 'Expedia', short: 'Expedia' },
  { value: 'direct', label: 'Direct booking', short: 'Direct' },
  { value: 'unknown', label: 'Unknown channel', short: 'No channel' },
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

  const console_ = <TestConsole properties={properties} loadingProperties={loading} />;

  return isMobile ? (
    <MobileRouteShell backHref="/messages" title="Concierge Testing">
      {console_}
    </MobileRouteShell>
  ) : (
    <DesktopSidebarShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {console_}
      </div>
    </DesktopSidebarShell>
  );
}

// Low-chrome inline trigger shared by every control in the composer bar, so the
// Property select, Guest-status select, and Guest popover read as one family.
const TRIGGER_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-[13px] font-medium text-muted-foreground shadow-none outline-none transition-colors hover:bg-black/[0.05] hover:text-foreground data-[state=open]:bg-black/[0.05] data-[state=open]:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] dark:hover:bg-white/[0.06] dark:data-[state=open]:bg-white/[0.06] dark:focus-visible:ring-[var(--accent-ring-dark)]';

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
  const [channel, setChannel] = useState<TestChannel>('airbnb');
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Monotonic id source for transcript items (stable React keys across turns;
  // the server reuses ids like "test-task-0" every turn, so we mint our own).
  const idSeq = useRef(0);
  const mintId = () => `c${idSeq.current++}`;

  const ready = propertyId.length > 0;
  const started = items.length > 0;
  const propertyName = properties.find((p) => p.id === propertyId)?.name ?? null;
  const scenarioShort = SCENARIO_OPTIONS.find((o) => o.value === scenario)?.short ?? '';
  const channelShort = CHANNEL_OPTIONS.find((o) => o.value === channel)?.short ?? '';

  // Changing the property or scenario changes the test identity mid-thread,
  // which would make an in-progress conversation incoherent — so reset it.
  const changeProperty = (v: string) => {
    setPropertyId(v);
    setItems([]);
    setError(null);
  };
  const changeScenario = (v: TestScenario) => {
    setScenario(v);
    setItems([]);
    setError(null);
  };
  const changeChannel = (v: TestChannel) => {
    setChannel(v);
    setItems([]);
    setError(null);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, sending]);

  const reset = () => {
    setItems([]);
    setInput('');
    setError(null);
  };

  // Dummy accept: flip the proposal to its in-thread "approved" tombstone — the
  // same UI a real accept produces, minus the database write.
  const acceptItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const decided = {
          status: 'accepted' as const,
          decided_by_name: 'You',
          decided_at: new Date().toISOString(),
        };
        if (it.kind === 'task') return { ...it, data: { ...it.data, ...decided } };
        if (it.kind === 'knowledge') return { ...it, data: { ...it.data, ...decided } };
        return it;
      }),
    );
  }, []);

  // Dummy dismiss: knowledge flips to a "dismissed by …" tombstone (mirroring
  // the inbox, which keeps a record); tasks just drop from the transcript.
  const dismissItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.flatMap((it) => {
        if (it.id !== id) return [it];
        if (it.kind === 'knowledge') {
          return [
            {
              ...it,
              data: {
                ...it.data,
                status: 'dismissed' as const,
                decided_by_name: 'You',
                decided_at: new Date().toISOString(),
              },
            },
          ];
        }
        return [];
      }),
    );
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !ready || sending) return;

    setItems((prev) => [...prev, { kind: 'guest', id: mintId(), text }]);
    setInput('');
    setError(null);
    setSending(true);

    // The conversation turns the API sees: prior real messages + this one.
    const priorTurns: ConversationTurn[] = items
      .filter(
        (it): it is Extract<TranscriptItem, { kind: 'guest' | 'concierge' }> =>
          it.kind === 'guest' || it.kind === 'concierge',
      )
      .map((it) => ({ role: it.kind === 'guest' ? 'guest' : 'host', text: it.text }));
    const turns: ConversationTurn[] = [...priorTurns, { role: 'guest', text }];

    try {
      const res = await fetch('/api/concierge-training/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          guest_name: guestName.trim(),
          scenario,
          channel: channel === 'unknown' ? null : channel,
          messages: turns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to generate a reply');

      const appended: TranscriptItem[] = [];

      // Reply — or a note when the gate / master switch suppressed it.
      const reply = typeof data.reply === 'string' ? data.reply : '';
      if (data.warranted && reply) {
        appended.push({ kind: 'concierge', id: mintId(), text: reply });
      } else {
        appended.push({
          kind: 'note',
          id: mintId(),
          text:
            data.replyEnabled === false
              ? 'Autonomous replies are off — the concierge didn’t draft one.'
              : 'The concierge judged no reply was needed at the current sensitivity.',
        });
      }

      // Dummy task proposals (rendered through the real inbox bubble).
      for (const t of Array.isArray(data.tasks) ? data.tasks : []) {
        const id = mintId();
        appended.push({
          kind: 'task',
          id,
          data: { ...(t as ProposedTaskData), id, triggering_message_id: null },
        });
      }

      // Dummy knowledge proposals.
      for (const k of Array.isArray(data.knowledge) ? data.knowledge : []) {
        const id = mintId();
        appended.push({
          kind: 'knowledge',
          id,
          data: { ...(k as ProposedKnowledgeData), id, triggering_message_id: null },
        });
      }

      setItems((prev) => [...prev, ...appended]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a reply');
    } finally {
      setSending(false);
    }
  }, [input, ready, sending, items, propertyId, guestName, scenario, channel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ---- The composer (identical in the hero + docked states) --------------
  const composer = (
    <div className="rounded-2xl border border-black/[0.08] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow] focus-within:border-[var(--accent-3)] focus-within:ring-2 focus-within:ring-[var(--accent-ring)] dark:border-white/[0.09] dark:bg-card dark:focus-within:ring-[var(--accent-ring-dark)]">
      <textarea
        rows={started ? 1 : 2}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!ready || sending}
        placeholder={ready ? 'Message the concierge as a guest…' : 'Select a property to start'}
        className="block max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2 pt-1">
        {/* Identity controls live in the hero only. Once a conversation starts
            they'd change the test mid-thread, so we hide them — Reset returns to
            the hero to change them. */}
        {!started && (
          <>
        {/* Property — the required action; tinted with the signal accent until chosen. */}
        <Select value={propertyId} onValueChange={changeProperty}>
          <SelectTrigger
            size="sm"
            aria-label="Property"
            disabled={loadingProperties}
            className={cn(
              TRIGGER_CLASS,
              !ready &&
                'text-[var(--accent-3)] hover:text-[var(--accent-3)] dark:text-[var(--accent-1)] dark:hover:text-[var(--accent-1)]',
            )}
          >
            <Home className="size-3.5" />
            <span className="max-w-[10rem] truncate">
              {loadingProperties ? 'Loading…' : propertyName ?? 'Select property'}
            </span>
          </SelectTrigger>
          <SelectContent align="start" side="bottom" sideOffset={6} avoidCollisions={false}>
            {properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Guest status (scenario) */}
        <Select value={scenario} onValueChange={(v) => changeScenario(v as TestScenario)}>
          <SelectTrigger size="sm" aria-label="Guest status" className={TRIGGER_CLASS}>
            <CalendarClock className="size-3.5" />
            <span>{scenarioShort}</span>
          </SelectTrigger>
          <SelectContent align="start">
            {SCENARIO_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Channel (which OTA the guest is messaging on) */}
        <Select value={channel} onValueChange={(v) => changeChannel(v as TestChannel)}>
          <SelectTrigger size="sm" aria-label="Guest channel" className={TRIGGER_CLASS}>
            <Globe className="size-3.5" />
            <span>{channelShort}</span>
          </SelectTrigger>
          <SelectContent align="start">
            {CHANNEL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Guest identity (name) */}
        <Popover>
          <PopoverTrigger className={TRIGGER_CLASS} aria-label="Guest name">
            <span
              className="size-3 rounded-full bg-gradient-to-br from-[var(--accent-1)] to-[var(--accent-3)]"
              aria-hidden
            />
            <span className="max-w-[8rem] truncate">{guestName.trim() || 'Guest'}</span>
            <ChevronDown className="size-3.5 opacity-50" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <div className="space-y-2">
              <Label htmlFor="test-guest" className="text-xs">
                Guest name
              </Label>
              <Input
                id="test-guest"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Jordan"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Optional — how the concierge addresses the guest. Doesn’t reset the conversation.
              </p>
            </div>
          </PopoverContent>
        </Popover>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          {started && (
            <button
              type="button"
              onClick={reset}
              aria-label="New conversation"
              title="New conversation"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!ready || sending || !input.trim()}
            aria-label="Send test message"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-3)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );

  // ---- Empty hero: the screenshot's centered, minimal composer -----------
  if (!started) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 pb-[8vh]">
        <div className="w-full max-w-2xl">
          <h1 className="mb-2 text-center text-[2.75rem] font-semibold leading-tight tracking-tight text-foreground text-balance">
            Concierge Testing
          </h1>
          <p className="mx-auto mb-7 max-w-md text-center text-base leading-relaxed text-muted-foreground text-balance">
            Simulate conversations with your Concierge Agent
          </p>
          {composer}
          {error && (
            <p className="mt-3 text-center text-sm text-[var(--destructive)]">{error}</p>
          )}
        </div>
      </div>
    );
  }

  // ---- Active: transcript scrolls; composer docks at the bottom ----------
  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overlay-scrollbar">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6">
          {items.map((it) => {
            if (it.kind === 'guest') {
              return (
                <div key={it.id} className="msg-in flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--accent-3)] px-3.5 py-2 text-sm text-white">
                    <p className="whitespace-pre-wrap break-words">{it.text}</p>
                  </div>
                </div>
              );
            }
            if (it.kind === 'concierge') {
              return (
                <div key={it.id} className="msg-in flex flex-col items-start">
                  <span className="mb-0.5 ml-1 text-[11px] font-medium text-muted-foreground">Concierge</span>
                  <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white/85 px-3.5 py-2 text-sm text-foreground ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.06]">
                    <p className="whitespace-pre-wrap break-words">{it.text}</p>
                  </div>
                </div>
              );
            }
            if (it.kind === 'note') {
              return (
                <div key={it.id} className="msg-in flex justify-start">
                  <span className="rounded-full bg-black/[0.04] px-3 py-1 text-[11px] text-muted-foreground dark:bg-white/[0.05]">
                    {it.text}
                  </span>
                </div>
              );
            }
            if (it.kind === 'task') {
              return (
                <ProposedTask
                  key={it.id}
                  proposal={it.data}
                  propertyName={propertyName}
                  align="start"
                  onAccept={() => acceptItem(it.id)}
                  onDismiss={() => dismissItem(it.id)}
                />
              );
            }
            return (
              <ProposedKnowledge
                key={it.id}
                proposal={it.data}
                propertyId={propertyId}
                align="start"
                onAccept={() => acceptItem(it.id)}
                onDismiss={() => dismissItem(it.id)}
              />
            );
          })}
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
      </div>

      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto w-full max-w-2xl">
          {error && <p className="mb-2 text-sm text-[var(--destructive)]">{error}</p>}
          {composer}
        </div>
      </div>
    </div>
  );
}
