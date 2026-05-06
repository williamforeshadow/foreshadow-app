'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  SectionCaption,
  SectionHeader,
} from '@/components/properties/form/FormPrimitives';

type KnowledgeAction = 'create' | 'update' | 'delete';
type KnowledgeSource = 'web' | 'agent_slack' | 'agent_web' | 'system' | string;

interface DiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

type KnowledgeChanges =
  | { kind: 'snapshot'; row: Record<string, unknown> }
  | { kind: 'diff'; entries: DiffEntry[] }
  | null;

interface ActivityEntry {
  id: string;
  property_id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  user_avatar: string | null;
  resource_type: string;
  resource_id: string | null;
  action: KnowledgeAction;
  changes: KnowledgeChanges;
  subject_label: string | null;
  source: KnowledgeSource | null;
  created_at: string;
}

const RESOURCE_LABELS: Record<string, string> = {
  note: 'Note',
  contact: 'Contact',
  room: 'Room',
  card: 'Card',
  access: 'Access',
  connectivity: 'Connectivity',
  tech_account: 'Tech account',
  document: 'Document',
};

const ACTION_LABELS: Record<KnowledgeAction, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
};

const SOURCE_LABELS: Record<string, string> = {
  web: 'App',
  agent_slack: 'Slack agent',
  agent_web: 'Web agent',
  system: 'System',
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function labelizeField(field: string): string {
  return field
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function actorLabel(entry: ActivityEntry): string {
  if (entry.user_name) return entry.user_name;
  if (entry.user_email) return entry.user_email;
  if (entry.user_id) return entry.user_id;
  if (entry.source === 'agent_web') return 'Web agent';
  if (entry.source === 'agent_slack') return 'Slack agent';
  return 'Unknown actor';
}

function entrySentence(entry: ActivityEntry): string {
  const actor = actorLabel(entry);
  const verb = ACTION_LABELS[entry.action] ?? entry.action;
  const resource = RESOURCE_LABELS[entry.resource_type] ?? labelizeField(entry.resource_type);
  const subject = entry.subject_label || resource;
  return `${actor} ${verb} ${subject}`;
}

function SnapshotRows({ row }: { row: Record<string, unknown> }) {
  const entries = Object.entries(row).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );
  if (entries.length === 0) {
    return (
      <p className="text-[12px] text-neutral-500 dark:text-[#66645f]">
        No details captured.
      </p>
    );
  }
  return (
    <dl className="grid gap-2">
      {entries.map(([field, value]) => (
        <div
          key={field}
          className="grid grid-cols-[130px_1fr] gap-3 text-[12px]"
        >
          <dt className="text-neutral-500 dark:text-[#66645f]">
            {labelizeField(field)}
          </dt>
          <dd className="text-neutral-800 dark:text-[#d8d6d1] whitespace-pre-wrap break-words">
            {formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DiffRows({ entries }: { entries: DiffEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-[12px] text-neutral-500 dark:text-[#66645f]">
        No field changes captured.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.field} className="text-[12px]">
          <div className="mb-1 font-medium text-neutral-700 dark:text-[#c8c4bd]">
            {labelizeField(entry.field)}
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="rounded-lg border border-neutral-200/70 dark:border-[rgba(255,255,255,0.07)] bg-neutral-50/70 dark:bg-[#1d1b18]/70 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
                Before
              </div>
              <div className="text-neutral-700 dark:text-[#d8d6d1] whitespace-pre-wrap break-words">
                {formatValue(entry.before)}
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200/70 dark:border-[rgba(255,255,255,0.07)] bg-neutral-50/70 dark:bg-[#1d1b18]/70 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
                After
              </div>
              <div className="text-neutral-700 dark:text-[#d8d6d1] whitespace-pre-wrap break-words">
                {formatValue(entry.after)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityDetails({ changes }: { changes: KnowledgeChanges }) {
  if (!changes) {
    return (
      <p className="text-[12px] text-neutral-500 dark:text-[#66645f]">
        No details captured.
      </p>
    );
  }
  if (changes.kind === 'diff') {
    return <DiffRows entries={changes.entries ?? []} />;
  }
  if (changes.kind === 'snapshot') {
    return <SnapshotRows row={changes.row ?? {}} />;
  }
  return (
    <pre className="text-[12px] text-neutral-700 dark:text-[#d8d6d1] whitespace-pre-wrap break-words">
      {formatValue(changes)}
    </pre>
  );
}

export default function PropertyKnowledgeActivityPage() {
  const params = useParams<{ id: string }>();
  const propertyId = params?.id as string;
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch(
        `/api/properties/${propertyId}/knowledge/activity?limit=100`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load activity');
      setEntries((data.activities || []) as ActivityEntry[]);
      setHasMore(Boolean(data.hasMore));
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const groupedEntries = useMemo(() => {
    return entries;
  }, [entries]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-neutral-400 dark:border-[#66645f] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-sm text-neutral-500 dark:text-[#a09e9a] mb-3">
          {loadError}
        </p>
        <button
          onClick={load}
          className="text-[13px] text-neutral-800 dark:text-[#f0efed] underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[820px] px-5 sm:px-8 py-6 sm:py-8">
        <SectionHeader label="Activity" />
        <SectionCaption>
          A read-only history of property knowledge changes from the app and
          agent. Shows creates, updates, and deletes across access,
          connectivity, rooms, cards, notes, contacts, tech accounts, and
          documents.
        </SectionCaption>

        {groupedEntries.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-neutral-200 dark:border-[rgba(255,255,255,0.08)] p-8 text-center">
            <p className="text-[13px] text-neutral-500 dark:text-[#a09e9a]">
              No property knowledge activity has been recorded yet.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {groupedEntries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-xl border border-neutral-200/70 dark:border-[rgba(255,255,255,0.07)] bg-white/80 dark:bg-[#161412]/80 p-4 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-medium text-neutral-900 dark:text-[#f0efed]">
                        {entrySentence(entry)}
                      </h3>
                      <span className="rounded-full border border-neutral-200 dark:border-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-neutral-500 dark:text-[#a09e9a]">
                        {RESOURCE_LABELS[entry.resource_type] ??
                          labelizeField(entry.resource_type)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500 dark:text-[#66645f]">
                      <span>{formatDate(entry.created_at)}</span>
                      <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                      <span>
                        {SOURCE_LABELS[entry.source ?? ''] ??
                          labelizeField(entry.source ?? 'unknown')}
                      </span>
                      {entry.user_role && (
                        <>
                          <span className="w-[3px] h-[3px] rounded-full bg-neutral-300 dark:bg-[#3e3d3a]" />
                          <span>{labelizeField(entry.user_role)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-neutral-400 dark:text-[#66645f]">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </div>
                </div>

                <div className="mt-4 border-t border-neutral-100 dark:border-[rgba(255,255,255,0.06)] pt-4">
                  <ActivityDetails changes={entry.changes} />
                </div>
              </article>
            ))}
          </div>
        )}

        {hasMore && (
          <p className="mt-4 text-[12px] text-neutral-500 dark:text-[#66645f]">
            Showing the 100 most recent entries.
          </p>
        )}
      </div>
    </div>
  );
}
