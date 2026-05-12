'use client';

// Editor scaffold for the rebuilt automations engine.
//
// This is a UI-only preview right now — state lives in React, no API calls.
// It exists so the user can see the WHEN → IF → THEN box layout, the
// variable picker reading from the real entity schema, and the condition
// tree. Wire-up to the API + execution engine comes next.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { getEntitySchema } from '@/lib/automations/entities';
import type {
  Automation,
  AutomationAction,
  AutomationTrigger,
  ConditionGroup,
  ConditionNode,
  ConditionRule,
  ConditionExists,
  EntityKey,
  Expression,
  Operator,
  RowChangeKind,
  SlackMessageAction,
  SlackRecipient,
} from '@/lib/automations/types';
import { emptyConditionGroup } from '@/lib/automations/types';
import {
  buildVariableOptions,
  fieldTypeAtPath,
  OPERATOR_LABELS,
  OPERATORS_BY_FIELD_TYPE,
  type VariableOption,
} from '@/lib/automations/labels';
import { summarizeAutomation } from '@/lib/automations/summarize';

const ENTITY_KEYS: EntityKey[] = ['reservation', 'task', 'property', 'user', 'department'];
const ITERATABLE_ENTITIES: EntityKey[] = ['reservation', 'task', 'property'];

// Pretty-print an entity key in places we drop it directly into UI text.
const ENTITY_LABEL: Record<EntityKey, string> = {
  reservation: 'reservation',
  task: 'task',
  property: 'property',
  user: 'user',
  department: 'department',
};

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultTrigger(): AutomationTrigger {
  return {
    kind: 'schedule',
    schedule: {
      frequency: 'day',
      time: '07:00',
      weekdays: [],
      month_days: [],
      interval: 1,
      timezone: 'property',
    },
    for_each: { entity: 'reservation' },
  };
}

function defaultRule(scopeEntity: EntityKey | null): ConditionRule {
  const firstField = scopeEntity
    ? getEntitySchema(scopeEntity).fields.find((f) => !f.internal)?.key ?? 'id'
    : 'id';
  return {
    kind: 'rule',
    left: {
      kind: 'variable',
      path: scopeEntity ? `this.${firstField}` : 'today',
    },
    op: 'equals',
    right: { kind: 'literal', value: '' },
  };
}

function defaultAction(): SlackMessageAction {
  return {
    id: uid(),
    kind: 'slack_message',
    recipients: [],
    message_template: '',
  };
}

export default function AutomationEditor({
  automationId,
}: {
  automationId?: string;
}) {
  const router = useRouter();
  const isEditing = !!automationId;
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState('Untitled Automation');
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(defaultTrigger());
  const [conditions, setConditions] = useState<ConditionGroup>(emptyConditionGroup());
  const [actions, setActions] = useState<AutomationAction[]>([defaultAction()]);

  // Hydrate from the API when editing an existing automation.
  useEffect(() => {
    if (!automationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/automations/${automationId}`);
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const a = data.automation as Automation;
        setName(a.name);
        setEnabled(a.enabled);
        setTrigger(a.trigger);
        setConditions(a.conditions ?? emptyConditionGroup());
        setActions(a.actions ?? []);
      } catch (err) {
        if (!cancelled) {
          setSaveError(err instanceof Error ? err.message : 'load failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [automationId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = { name, enabled, trigger, conditions, actions };
      const res = await fetch(
        automationId ? `/api/automations/${automationId}` : '/api/automations',
        {
          method: automationId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.errors
            ? data.errors.map((e: { message: string }) => e.message).join('; ')
            : data.error ?? `save failed: ${res.status}`,
        );
      }
      if (!automationId && data.automation?.id) {
        router.replace(`/automations/new-engine/${data.automation.id}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [automationId, name, enabled, trigger, conditions, actions, router]);

  // Resolve the "this" entity for variable paths.
  const scopeEntity: EntityKey | null = useMemo(() => {
    if (trigger.kind === 'schedule') return trigger.for_each?.entity ?? null;
    return trigger.entity;
  }, [trigger]);

  // Row-change kind drives the extra namespaces (actor/added/removed).
  // We expose them whenever the trigger covers any row-change kind; the
  // engine will validate at runtime that `added`/`removed` are only filled
  // for 'updated' events.
  const rowChangeKind = useMemo(() => {
    if (trigger.kind !== 'row_change') return undefined;
    if (trigger.on.includes('updated')) return 'updated' as const;
    return trigger.on[0];
  }, [trigger]);

  const automation: Automation = useMemo(
    () => ({
      id: 'preview',
      name,
      enabled,
      trigger,
      conditions,
      actions,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    [name, enabled, trigger, conditions, actions],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-50 dark:bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-card">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/automations/new-engine')}
            className="mb-1 px-0"
          >
            ← All automations
          </Button>
          <div className="flex items-center gap-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 max-w-xl border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            />
            <Badge variant={enabled ? 'secondary' : 'outline'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <Button variant="outline" disabled title="Wired in the next chunk">
            Test
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {saveError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {saveError}
        </div>
      )}
      {loading && (
        <div className="border-b border-neutral-200 bg-neutral-50 px-6 py-2 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          Loading automation…
        </div>
      )}

      {/* Live English summary — primary affordance for confirming intent. */}
      <div className="border-b border-neutral-200 bg-gradient-to-r from-indigo-50 to-white px-6 py-4 dark:border-neutral-800 dark:from-indigo-950/30 dark:to-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
          In plain English
        </p>
        <p className="mt-1 text-base leading-relaxed text-neutral-800 dark:text-neutral-100">
          {summarizeAutomation(automation)}
        </p>
      </div>

      {/* Body: stacked flow */}
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-0">
          <FlowBox label="When this happens" tone="trigger">
            <TriggerBlock trigger={trigger} onChange={setTrigger} />
          </FlowBox>

          <FlowConnector />

          <FlowBox label="Only if…" tone="condition">
            <ConditionGroupEditor
              group={conditions}
              onChange={setConditions}
              scopeEntity={scopeEntity}
              rowChangeKind={rowChangeKind}
              depth={0}
            />
          </FlowBox>

          {actions.map((action, index) => (
            <div key={action.id} className="flex w-full flex-col items-center">
              <FlowConnector />
              <FlowBox
                label={`Then${actions.length > 1 ? ` (${index + 1} of ${actions.length})` : ''}`}
                tone="action"
                onRemove={
                  actions.length > 1
                    ? () => setActions((list) => list.filter((a) => a.id !== action.id))
                    : undefined
                }
              >
                <ActionBlock
                  action={action}
                  scopeEntity={scopeEntity}
                  rowChangeKind={rowChangeKind}
                  onChange={(next) =>
                    setActions((list) =>
                      list.map((a) => (a.id === action.id ? next : a)),
                    )
                  }
                />
              </FlowBox>
            </div>
          ))}

          <FlowConnector />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActions((list) => [...list, defaultAction()])}
          >
            + Do another thing
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Flow box chrome ───────────────────────────────────────────────────

function FlowBox({
  label,
  tone,
  onRemove,
  children,
}: {
  label: string;
  tone: 'trigger' | 'condition' | 'action';
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'trigger'
      ? 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20'
      : tone === 'condition'
      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20'
      : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20';

  return (
    <div
      className={`w-full max-w-3xl rounded-xl border-2 ${toneClass} px-5 py-4 shadow-sm`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-neutral-700 dark:text-neutral-200">
          {label}
        </span>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function FlowConnector() {
  return (
    <div className="my-1 h-8 w-px bg-neutral-300 dark:bg-neutral-700" aria-hidden />
  );
}

// ─── Trigger block ─────────────────────────────────────────────────────

function TriggerBlock({
  trigger,
  onChange,
}: {
  trigger: AutomationTrigger;
  onChange: (next: AutomationTrigger) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={trigger.kind === 'schedule' ? 'default' : 'outline'}
          onClick={() => onChange(defaultTrigger())}
        >
          On a schedule
        </Button>
        <Button
          size="sm"
          variant={trigger.kind === 'row_change' ? 'default' : 'outline'}
          onClick={() =>
            onChange({
              kind: 'row_change',
              entity: 'task',
              on: ['updated'],
            })
          }
        >
          On a record change
        </Button>
      </div>

      {trigger.kind === 'schedule' ? (
        <ScheduleTriggerEditor trigger={trigger} onChange={onChange} />
      ) : (
        <RowChangeTriggerEditor trigger={trigger} onChange={onChange} />
      )}
    </div>
  );
}

function ScheduleTriggerEditor({
  trigger,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { kind: 'schedule' }>;
  onChange: (next: AutomationTrigger) => void;
}) {
  const { schedule, for_each } = trigger;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[140px_140px_140px_1fr] gap-2">
        <LabeledField label="Frequency">
          <Select
            value={schedule.frequency}
            onValueChange={(value) =>
              onChange({
                ...trigger,
                schedule: { ...schedule, frequency: value as typeof schedule.frequency },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">Hourly</SelectItem>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Every">
          <Input
            type="number"
            min={1}
            value={schedule.interval}
            onChange={(e) =>
              onChange({
                ...trigger,
                schedule: {
                  ...schedule,
                  interval: Math.max(1, Number(e.target.value) || 1),
                },
              })
            }
          />
        </LabeledField>
        <LabeledField label="Time">
          <Input
            type="time"
            value={schedule.time}
            onChange={(e) =>
              onChange({
                ...trigger,
                schedule: { ...schedule, time: e.target.value },
              })
            }
            disabled={schedule.frequency === 'hour'}
          />
        </LabeledField>
        <LabeledField label="Timezone">
          <Select
            value={schedule.timezone}
            onValueChange={(value) =>
              onChange({
                ...trigger,
                schedule: { ...schedule, timezone: value as typeof schedule.timezone },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company">Company timezone</SelectItem>
              <SelectItem value="property">Property timezone (when iterating)</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
      </div>

      <LabeledField label="For each">
        <Select
          value={for_each?.entity ?? 'none'}
          onValueChange={(value) => {
            if (value === 'none') {
              onChange({ ...trigger, for_each: undefined });
              return;
            }
            onChange({ ...trigger, for_each: { entity: value as EntityKey } });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Just fire once, no iteration</SelectItem>
            {ITERATABLE_ENTITIES.map((key) => (
              <SelectItem key={key} value={key}>
                Each {ENTITY_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
    </div>
  );
}

function RowChangeTriggerEditor({
  trigger,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { kind: 'row_change' }>;
  onChange: (next: AutomationTrigger) => void;
}) {
  const kinds: RowChangeKind[] = ['created', 'updated', 'deleted'];
  return (
    <div className="space-y-3">
      <LabeledField label="A">
        <Select
          value={trigger.entity}
          onValueChange={(value) =>
            onChange({ ...trigger, entity: value as EntityKey })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {ENTITY_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LabeledField>
      <LabeledField label="is">
        <div className="flex flex-wrap gap-3">
          {kinds.map((kind) => (
            <label key={kind} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={trigger.on.includes(kind)}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    on: e.target.checked
                      ? Array.from(new Set([...trigger.on, kind]))
                      : trigger.on.filter((k) => k !== kind),
                  })
                }
              />
              {kind === 'created'
                ? 'created'
                : kind === 'updated'
                ? 'changed'
                : 'deleted'}
            </label>
          ))}
        </div>
      </LabeledField>
    </div>
  );
}

// ─── Condition tree ────────────────────────────────────────────────────

function ConditionGroupEditor({
  group,
  onChange,
  scopeEntity,
  rowChangeKind,
  depth,
  relatedEntity,
}: {
  group: ConditionGroup;
  onChange: (next: ConditionGroup) => void;
  scopeEntity: EntityKey | null;
  rowChangeKind?: RowChangeKind;
  depth: number;
  /** When inside an exists clause, `related.*` resolves to this entity. */
  relatedEntity?: EntityKey;
}) {
  const updateChild = (index: number, child: ConditionNode | null) => {
    onChange({
      ...group,
      children:
        child === null
          ? group.children.filter((_, i) => i !== index)
          : group.children.map((c, i) => (i === index ? child : c)),
    });
  };

  return (
    <div className={depth > 0 ? 'rounded-md border border-neutral-300 p-3 dark:border-neutral-700' : ''}>
      {group.children.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">
          <span>Match</span>
          <Select
            value={group.match}
            onValueChange={(value) =>
              onChange({ ...group, match: value as 'all' | 'any' })
            }
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all</SelectItem>
              <SelectItem value="any">any</SelectItem>
            </SelectContent>
          </Select>
          <span>of the following</span>
        </div>
      )}

      <div className="space-y-2">
        {group.children.map((child, index) => (
          <ConditionNodeEditor
            key={index}
            node={child}
            onChange={(next) => updateChild(index, next)}
            scopeEntity={scopeEntity}
            rowChangeKind={rowChangeKind}
            depth={depth + 1}
            relatedEntity={relatedEntity}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              ...group,
              children: [...group.children, defaultRule(scopeEntity)],
            })
          }
        >
          + Condition
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              ...group,
              children: [...group.children, emptyConditionGroup()],
            })
          }
        >
          + Group
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              ...group,
              children: [
                ...group.children,
                { kind: 'exists', entity: 'reservation', where: emptyConditionGroup() } satisfies ConditionExists,
              ],
            })
          }
          title="Check whether some other record matches a condition"
        >
          + Check another record
        </Button>
      </div>
    </div>
  );
}

function ConditionNodeEditor({
  node,
  onChange,
  scopeEntity,
  rowChangeKind,
  depth,
  relatedEntity,
}: {
  node: ConditionNode;
  onChange: (next: ConditionNode | null) => void;
  scopeEntity: EntityKey | null;
  rowChangeKind?: RowChangeKind;
  depth: number;
  relatedEntity?: EntityKey;
}) {
  if (node.kind === 'group') {
    return (
      <ConditionGroupEditor
        group={node}
        onChange={onChange}
        scopeEntity={scopeEntity}
        rowChangeKind={rowChangeKind}
        depth={depth}
        relatedEntity={relatedEntity}
      />
    );
  }
  if (node.kind === 'rule') {
    return (
      <ConditionRuleEditor
        rule={node}
        onChange={onChange}
        scopeEntity={scopeEntity}
        rowChangeKind={rowChangeKind}
        relatedEntity={relatedEntity}
      />
    );
  }
  // exists / not_exists
  return (
    <div className="rounded-md border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-card">
      <div className="mb-2 flex items-center gap-2">
        <Select
          value={node.kind}
          onValueChange={(value) =>
            onChange({ ...node, kind: value as ConditionExists['kind'] })
          }
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exists">there is another</SelectItem>
            <SelectItem value="not_exists">there is no other</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={node.entity}
          onValueChange={(value) =>
            onChange({ ...node, entity: value as EntityKey })
          }
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTITY_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {ENTITY_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-neutral-500">where</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Remove
        </Button>
      </div>
      <ConditionGroupEditor
        group={(node.where as ConditionGroup) ?? emptyConditionGroup()}
        onChange={(next) => onChange({ ...node, where: next })}
        scopeEntity={scopeEntity}
        rowChangeKind={rowChangeKind}
        depth={depth + 1}
        relatedEntity={node.entity}
      />
    </div>
  );
}

function ConditionRuleEditor({
  rule,
  onChange,
  scopeEntity,
  rowChangeKind,
  relatedEntity,
}: {
  rule: ConditionRule;
  onChange: (next: ConditionNode | null) => void;
  scopeEntity: EntityKey | null;
  rowChangeKind?: RowChangeKind;
  relatedEntity?: EntityKey;
}) {
  const variableOptions = useMemo(
    () => buildVariableOptions({ scopeEntity, relatedEntity, rowChangeKind }),
    [scopeEntity, relatedEntity, rowChangeKind],
  );

  // Filter operators by the left expression's field type so a date field
  // doesn't suggest "starts with" and a string doesn't suggest "before".
  const leftFieldType = useMemo(
    () =>
      rule.left.kind === 'variable'
        ? fieldTypeAtPath(rule.left.path, scopeEntity, relatedEntity)
        : undefined,
    [rule.left, scopeEntity, relatedEntity],
  );
  const availableOperators = useMemo<Operator[]>(() => {
    if (!leftFieldType) return Object.keys(OPERATOR_LABELS) as Operator[];
    return (
      OPERATORS_BY_FIELD_TYPE[leftFieldType] ??
      (Object.keys(OPERATOR_LABELS) as Operator[])
    );
  }, [leftFieldType]);

  const operatorNeedsRight = !['is_empty', 'is_not_empty'].includes(rule.op);

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2">
      <ExpressionEditor
        expression={rule.left}
        variableOptions={variableOptions}
        onChange={(next) => onChange({ ...rule, left: next })}
        allowedKinds={['variable']}
      />
      <Select
        value={rule.op}
        onValueChange={(value) => onChange({ ...rule, op: value as Operator })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableOperators.map((op) => (
            <SelectItem key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {operatorNeedsRight ? (
        <ExpressionEditor
          expression={rule.right ?? { kind: 'literal', value: '' }}
          variableOptions={variableOptions}
          onChange={(next) => onChange({ ...rule, right: next })}
          allowedKinds={['variable', 'literal', 'today', 'today_offset', 'now']}
        />
      ) : (
        <span className="text-sm text-neutral-400">—</span>
      )}
      <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
        ✕
      </Button>
    </div>
  );
}

// ─── Expression editor ─────────────────────────────────────────────────

function ExpressionEditor({
  expression,
  variableOptions,
  onChange,
  allowedKinds,
}: {
  expression: Expression;
  variableOptions: VariableOption[];
  onChange: (next: Expression) => void;
  allowedKinds: Array<Expression['kind']>;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select
        value={expression.kind}
        onValueChange={(value) => {
          const kind = value as Expression['kind'];
          if (kind === 'variable') {
            onChange({ kind, path: variableOptions[0]?.path ?? 'this.id' });
          } else if (kind === 'literal') {
            onChange({ kind, value: '' });
          } else if (kind === 'today') {
            onChange({ kind: 'today' });
          } else if (kind === 'now') {
            onChange({ kind: 'now' });
          } else if (kind === 'today_offset') {
            onChange({ kind: 'today_offset', days: 0 });
          } else if (kind === 'now_offset') {
            onChange({ kind: 'now_offset', minutes: 0 });
          }
        }}
      >
        <SelectTrigger className="h-9 w-28 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowedKinds.includes('variable') && <SelectItem value="variable">Variable</SelectItem>}
          {allowedKinds.includes('literal') && <SelectItem value="literal">Value</SelectItem>}
          {allowedKinds.includes('today') && <SelectItem value="today">Today</SelectItem>}
          {allowedKinds.includes('now') && <SelectItem value="now">Now</SelectItem>}
          {allowedKinds.includes('today_offset') && (
            <SelectItem value="today_offset">Today + N days</SelectItem>
          )}
          {allowedKinds.includes('now_offset') && (
            <SelectItem value="now_offset">Now + N minutes</SelectItem>
          )}
        </SelectContent>
      </Select>
      <ExpressionBody
        expression={expression}
        variableOptions={variableOptions}
        onChange={onChange}
      />
    </div>
  );
}

function ExpressionBody({
  expression,
  variableOptions,
  onChange,
}: {
  expression: Expression;
  variableOptions: VariableOption[];
  onChange: (next: Expression) => void;
}) {
  if (expression.kind === 'variable') {
    const grouped = groupVariableOptions(variableOptions);
    return (
      <Select
        value={expression.path}
        onValueChange={(value) => onChange({ kind: 'variable', path: value })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {grouped.map(({ group, options }) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {options.map((option) => (
                <SelectItem key={option.path} value={option.path}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (expression.kind === 'literal') {
    return (
      <Input
        value={String(expression.value ?? '')}
        onChange={(e) => onChange({ kind: 'literal', value: e.target.value })}
        placeholder="value"
      />
    );
  }
  if (expression.kind === 'today_offset') {
    return (
      <Input
        type="number"
        value={expression.days}
        onChange={(e) =>
          onChange({ kind: 'today_offset', days: Number(e.target.value) || 0 })
        }
      />
    );
  }
  if (expression.kind === 'now_offset') {
    return (
      <Input
        type="number"
        value={expression.minutes ?? 0}
        onChange={(e) =>
          onChange({ kind: 'now_offset', minutes: Number(e.target.value) || 0 })
        }
      />
    );
  }
  return <span className="text-sm text-neutral-500">{expression.kind}</span>;
}

// Variable picker helpers live in `lib/automations/labels.ts` so the engine
// and the editor share one definition of what's selectable.

interface GroupedVariableOptions {
  group: string;
  options: VariableOption[];
}

function groupVariableOptions(options: VariableOption[]): GroupedVariableOptions[] {
  const order: string[] = [];
  const map = new Map<string, VariableOption[]>();
  for (const option of options) {
    if (!map.has(option.group)) {
      map.set(option.group, []);
      order.push(option.group);
    }
    map.get(option.group)!.push(option);
  }
  return order.map((group) => ({ group, options: map.get(group)! }));
}

// ─── Action block ──────────────────────────────────────────────────────

function ActionBlock({
  action,
  scopeEntity,
  rowChangeKind,
  onChange,
}: {
  action: AutomationAction;
  scopeEntity: EntityKey | null;
  rowChangeKind?: RowChangeKind;
  onChange: (next: AutomationAction) => void;
}) {
  const variableOptions = useMemo(
    () => buildVariableOptions({ scopeEntity, rowChangeKind }),
    [scopeEntity, rowChangeKind],
  );
  if (action.kind !== 'slack_message') return null;

  const updateRecipients = (next: SlackRecipient[]) => {
    onChange({ ...action, recipients: next });
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Send Slack message to
        </h4>
        <div className="space-y-2">
          {action.recipients.map((recipient) => (
            <RecipientRow
              key={recipient.id}
              recipient={recipient}
              variableOptions={variableOptions}
              onChange={(next) =>
                updateRecipients(
                  action.recipients.map((r) =>
                    r.id === recipient.id ? next : r,
                  ),
                )
              }
              onRemove={() =>
                updateRecipients(
                  action.recipients.filter((r) => r.id !== recipient.id),
                )
              }
            />
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateRecipients([
                  ...action.recipients,
                  {
                    id: uid(),
                    kind: 'channel',
                    channel_id: '',
                    channel_name: '',
                  },
                ])
              }
            >
              + A Slack channel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateRecipients([
                  ...action.recipients,
                  {
                    id: uid(),
                    kind: 'user',
                    user_id: '',
                    user_name: '',
                    user_email: null,
                  },
                ])
              }
            >
              + A specific person
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateRecipients([
                  ...action.recipients,
                  {
                    id: uid(),
                    kind: 'variable',
                    path: variableOptions[0]?.path ?? 'this.assignee',
                  },
                ])
              }
            >
              + A person from this record
            </Button>
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Message
        </h4>
        <Textarea
          rows={5}
          value={action.message_template}
          onChange={(e) =>
            onChange({ ...action, message_template: e.target.value })
          }
          placeholder="Same-day flip at {{this.property.name}} — {{this.guest_name}} out today."
          className="font-mono text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-neutral-500">Insert data:</span>
          <Select
            value=""
            onValueChange={(value) => {
              if (!value) return;
              onChange({
                ...action,
                message_template: `${action.message_template}{{${value}}}`,
              });
            }}
          >
            <SelectTrigger className="h-8 max-w-xs text-xs">
              <SelectValue placeholder="Pick a field to insert…" />
            </SelectTrigger>
            <SelectContent>
              {groupVariableOptions(variableOptions).map(({ group, options }) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {options.map((opt) => (
                    <SelectItem key={opt.path} value={opt.path}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function RecipientRow({
  recipient,
  variableOptions,
  onChange,
  onRemove,
}: {
  recipient: SlackRecipient;
  variableOptions: VariableOption[];
  onChange: (next: SlackRecipient) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-card">
      <Badge variant="outline">
        {recipient.kind === 'channel'
          ? 'Slack channel'
          : recipient.kind === 'user'
          ? 'Specific person'
          : 'From this record'}
      </Badge>
      {recipient.kind === 'channel' && (
        <Input
          placeholder="Channel name or ID (picker comes later)"
          value={recipient.channel_name}
          onChange={(e) =>
            onChange({ ...recipient, channel_name: e.target.value })
          }
        />
      )}
      {recipient.kind === 'user' && (
        <Input
          placeholder="User name or email (picker comes later)"
          value={recipient.user_name}
          onChange={(e) =>
            onChange({ ...recipient, user_name: e.target.value })
          }
        />
      )}
      {recipient.kind === 'variable' && (
        <Select
          value={recipient.path}
          onValueChange={(value) => onChange({ ...recipient, path: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a person field…" />
          </SelectTrigger>
          <SelectContent>
            {groupVariableOptions(variableOptions).map(({ group, options }) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {options.map((option) => (
                  <SelectItem key={option.path} value={option.path}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="sm" variant="ghost" onClick={onRemove}>
        ✕
      </Button>
    </div>
  );
}

// ─── Misc helpers ──────────────────────────────────────────────────────

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      {children}
    </div>
  );
}
