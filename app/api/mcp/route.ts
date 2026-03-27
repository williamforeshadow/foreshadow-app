import { createClient } from "@supabase/supabase-js";

// ─── CORS Headers ───────────────────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Supabase ───────────────────────────────────────────────────────────────
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─── MCP Server Info ────────────────────────────────────────────────────────
const SERVER_INFO = { name: "Internal", version: "1.0.0" };
const SUPPORTED_VERSIONS = ["2024-11-05", "2024-11-25", "2025-03-26"];

// ─── Tool Definitions (JSON Schema) ────────────────────────────────────────
const TOOLS = [
  {
    name: "send_message",
    description:
      "Send a message to a Foreshadow channel. Set requires_action=true for messages needing human approval (e.g. proposed guest replies).",
    inputSchema: {
      type: "object" as const,
      properties: {
        channel_name: {
          type: "string",
          description:
            "Channel name to post to, e.g. 'guest-replies' or 'general'",
        },
        content: {
          type: "string",
          description: "The message content",
        },
        sender_name: {
          type: "string",
          description:
            "Display name of the sender (default: 'External Service')",
        },
        requires_action: {
          type: "boolean",
          description:
            "Whether this message needs approve/reject from team",
        },
        metadata: {
          type: "object",
          description:
            "Extra data object, e.g. { guest_name, property_name, incoming_message, confidence }",
          additionalProperties: true,
        },
      },
      required: ["channel_name", "content"],
    },
  },
  {
    name: "list_channels",
    description: "List available channel names to post messages to",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────────────
async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const supabase = getSupabase();

  if (name === "send_message") {
    const {
      channel_name,
      content,
      sender_name,
      requires_action,
      metadata,
    } = args as {
      channel_name: string;
      content: string;
      sender_name?: string;
      requires_action?: boolean;
      metadata?: Record<string, unknown>;
    };

    // Look up channel by name
    const { data: channel, error: chErr } = await supabase
      .from("channels")
      .select("id")
      .eq("name", channel_name)
      .single();

    if (chErr || !channel) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Channel '${channel_name}' not found. Use list_channels to see available channels.`,
          },
        ],
        isError: true,
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
      return {
        content: [
          { type: "text", text: `Error storing message: ${error.message}` },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Message posted (ID: ${msg.id})${requires_action ? " — pending team review" : ""}`,
        },
      ],
    };
  }

  if (name === "list_channels") {
    const { data, error } = await supabase
      .from("channels")
      .select("name, description, type")
      .order("created_at", { ascending: true });

    if (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

// ─── JSON-RPC Types ─────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── JSON-RPC Message Handler ───────────────────────────────────────────────
async function handleMessage(
  msg: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    // ── Initialize handshake ──
    case "initialize": {
      const clientVersion = (msg.params?.protocolVersion as string) ?? "";
      const negotiatedVersion = SUPPORTED_VERSIONS.includes(clientVersion)
        ? clientVersion
        : SUPPORTED_VERSIONS[0];

      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          protocolVersion: negotiatedVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }

    // ── Initialized notification (no response) ──
    case "notifications/initialized":
      return null;

    // ── List tools ──
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: { tools: TOOLS },
      };

    // ── Call a tool ──
    case "tools/call": {
      const params = msg.params as {
        name: string;
        arguments?: Record<string, unknown>;
      };
      const result = await executeTool(params.name, params.arguments ?? {});
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result,
      };
    }

    // ── Ping ──
    case "ping":
      return { jsonrpc: "2.0", id: msg.id!, result: {} };

    // ── Unknown method ──
    default:
      if (isNotification) return null;
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      };
  }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Handle batched JSON-RPC requests (array of messages)
    if (Array.isArray(body)) {
      const responses = await Promise.all(
        body.map((m: JsonRpcRequest) => handleMessage(m))
      );
      const filtered = responses.filter(
        (r): r is JsonRpcResponse => r !== null
      );
      if (filtered.length === 0) {
        return new Response(null, { status: 202, headers: CORS_HEADERS });
      }
      return jsonResponse(filtered);
    }

    // Handle single JSON-RPC request
    const response = await handleMessage(body);
    if (response === null) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }
    return jsonResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: `Parse error: ${message}` },
      },
      400
    );
  }
}

export async function GET() {
  return jsonResponse({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: SUPPORTED_VERSIONS[0],
    capabilities: { tools: {} },
    status: "ok",
  });
}

export async function DELETE() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
