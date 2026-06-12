-- Proposed Property Knowledge — the concierge's third proposal type. When a
-- conversation reveals a durable, reusable fact about the PROPERTY (a discovered
-- quirk/fix, a recurring fact like a landscaper schedule, a known defect), the
-- concierge drafts a knowledge addition for review. Accepting writes it into the
-- existing property-knowledge structure (a room note, a room card, or a property
-- note) with a chosen guest-visibility. Mirrors proposed_tasks.

begin;

create table if not exists public.proposed_knowledge (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  triggering_message_id  uuid references public.guest_messages(id) on delete set null,
  property_id            uuid references public.properties(id) on delete set null,
  -- Structured write target (discriminated union by `kind`): room_note | card |
  -- property_note. Replayed through the property write services on accept.
  target                 jsonb not null,
  -- Human-readable one-liner for the bubble ("Exterior - Yard - note: ...").
  summary                text not null,
  -- Suggested guest visibility; the reviewer can flip it before accepting.
  guest_visible          boolean not null default false,
  status                 text not null default 'pending'
                           check (status in ('pending', 'accepted', 'dismissed')),
  -- What the accepted proposal created, for traceability.
  resulting_resource_type text,
  resulting_resource_id   text,
  decided_by             text references public.users(id) on delete set null,
  decided_at             timestamptz,
  source                 text not null default 'auto',
  reasoning              text,
  generated_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists proposed_knowledge_conversation_idx
  on public.proposed_knowledge (conversation_id, status);

create index if not exists proposed_knowledge_property_idx
  on public.proposed_knowledge (property_id, status);

alter table public.proposed_knowledge enable row level security;
-- Intentionally NO policies: service-role access through API routes only.

commit;
