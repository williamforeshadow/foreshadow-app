import { NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';

// GET /api/slack/channels
//
// Returns the list of Slack channels the bot has access to. Used by the
// Slack automation editor to render a channel picker (instead of a
// free-text channel name field that's prone to typos).
//
// Required Slack scopes:
//   - channels:read   — public channels
//   - groups:read     — private channels the bot is a member of
//
// We include both public and private channels but exclude DMs and MPIMs
// (those aren't useful targets for automation broadcasts). Channels are
// returned sorted by name for a predictable UI.
//
// Note: `chat:write.public` lets the bot post to public channels it isn't
// a member of, but `conversations.list` only returns channels the bot is
// in (private) or all public channels (read scope). We surface a
// `bot_is_member` flag so the UI can warn when the user picks a channel
// the bot will be unable to post to without that scope.

interface SlackChannelOption {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

export async function GET() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'SLACK_BOT_TOKEN not configured' },
      { status: 500 },
    );
  }

  const web = new WebClient(token);
  const channels: SlackChannelOption[] = [];

  try {
    // Paginate to handle workspaces with >1000 channels. We exclude
    // archived channels (no point automating to a dead channel) and
    // exclude DMs/MPIMs (not useful broadcast targets).
    let cursor: string | undefined;
    do {
      const resp = await web.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      for (const c of resp.channels ?? []) {
        if (!c.id || !c.name) continue;
        channels.push({
          id: c.id,
          name: c.name,
          is_private: !!c.is_private,
          is_member: !!c.is_member,
        });
      }

      cursor = resp.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (err) {
    console.error('[api/slack/channels] conversations.list failed', err);
    const message = err instanceof Error ? err.message : 'Failed to load channels';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  channels.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ channels });
}
