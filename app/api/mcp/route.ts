import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Creates and configures the Foreshadow MCP server with all tools.
 * External services (like Conduit) connect here to post messages
 * into Foreshadow's internal messaging system.
 */
function createForeshadowMcp() {
  const server = new McpServer({
    name: "Foreshadow Messaging",
    version: "1.0.0",
  });

  const supabase = getSupabase();

  // ─── Tool: Send a message to a channel ───
  server.tool(
    "send_message",
    "Send a message to a Foreshadow channel. Set requires_action=true for messages needing human approval (e.g. proposed guest replies).",
    {
      channel_name: z.string().describe("Channel name to post to, e.g. 'guest-replies' or 'general'"),
      content: z.string().describe("The message content"),
      sender_name: z.string().optional().describe("Display name of the sender (default: 'External Service')"),
      requires_action: z.boolean().optional().describe("Whether this message needs approve/reject from team"),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Extra data object, e.g. { guest_name, property_name, incoming_message, confidence }"),
    },
    async ({ channel_name, content, sender_name, requires_action, metadata }) => {
      // Look up the channel by name
      const { data: channel, error: chErr } = await supabase
        .from("channels")
        .select("id")
        .eq("name", channel_name)
        .single();

      if (chErr || !channel) {
        return {
          content: [
            { type: "text" as const, text: `Error: Channel '${channel_name}' not found. Available channels can be listed with list_channels.` },
          ],
        };
      }

      const { data: msg, error } = await supabase
        .from("messages")
        .insert({
          channel_id: channel.id,
          sender_type: "integration",
          sender_name: sender_name ?? "External Service",
          content,
          requires_action: requires_action ?? false,
          action_status: requires_action ? "pending" : null,
          metadata: metadata ?? {},
        })
        .select()
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `Error storing message: ${error.message}` }] };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Message posted (ID: ${msg.id})${requires_action ? " — pending team review in Foreshadow" : ""}`,
          },
        ],
      };
    }
  );

  // ─── Tool: List available channels (write-only: just so sender knows where to post) ───
  server.tool(
    "list_channels",
    "List available channel names to post messages to",
    {},
    async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("name, description, type")
        .order("created_at", { ascending: true });

      if (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  return server;
}

// ─── Request Handler ───
async function handleMcpRequest(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode for serverless
    enableJsonResponse: true,
  });

  const server = createForeshadowMcp();
  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown MCP error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req: Request) {
  return handleMcpRequest(req);
}

export async function GET(req: Request) {
  return handleMcpRequest(req);
}

export async function DELETE() {
  return new Response(null, { status: 204 });
}
