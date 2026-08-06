-- Tag the synthetic confirmation turns written before the tag existed.
--
-- /api/agent/confirm records a "Confirmed." / "Cancelled." user turn so the
-- next agent turn knows what the user did. Live, that click never rendered as
-- a message — it turned the buttons into a result — so the session rehydrator
-- (loadSessionMessages) skips rows marked `kind: 'confirmation_click'`.
--
-- Rows written before that marker existed would come back as chat bubbles the
-- user never typed and never saw. The match below is exact: role='user',
-- verbatim content, AND a pending_action_ids array — which together only ever
-- describe a row this route wrote. Someone typing "Confirmed." by hand
-- produces no pending_action_ids, so it cannot be caught by this.

begin;

update public.ai_chat_messages
   set metadata = metadata || jsonb_build_object('kind', 'confirmation_click')
 where role = 'user'
   and content in ('Confirmed.', 'Cancelled.')
   and metadata ? 'pending_action_ids'
   and metadata->>'kind' is distinct from 'confirmation_click';

commit;
