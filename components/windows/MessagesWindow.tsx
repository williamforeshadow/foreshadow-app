'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useMessages } from '@/lib/hooks/useMessages';
import type { User, ChatMessage, Channel } from '@/lib/types';
import {
  Hash,
  Plus,
  Send,
  Check,
  X,
  Pencil,
  Bot,
  User as UserIcon,
  Zap,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/ui/user-avatar';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MessagesWindowProps {
  currentUser: User | null;
  users: User[];
}

// ─────────────────────────────────────────────
// Channel List Sidebar
// ─────────────────────────────────────────────

function ChannelList({
  channels,
  activeChannelId,
  onSelect,
  onCreateChannel,
}: {
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (id: string) => void;
  onCreateChannel: () => void;
}) {
  return (
    <div className="w-56 flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex flex-col bg-neutral-50/50 dark:bg-background/50">
      {/* Header */}
      <div className="px-3 py-3 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800">
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
          Channels
        </span>
        <button
          onClick={onCreateChannel}
          className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
          title="Create channel"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-1">
        {channels.map((ch) => {
          const isActive = ch.id === activeChannelId;
          return (
            <button
              key={ch.id}
              onClick={() => onSelect(ch.id)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
                isActive
                  ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50'
              }`}
            >
              {ch.integration_source ? (
                <Zap size={14} className="text-amber-500 flex-shrink-0" />
              ) : (
                <Hash size={14} className="flex-shrink-0 opacity-50" />
              )}
              <span className="truncate">{ch.name}</span>
            </button>
          );
        })}

        {channels.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-neutral-400">No channels yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Message Bubble
// ─────────────────────────────────────────────

function MessageBubble({
  message,
  currentUser,
  users,
  onAction,
}: {
  message: ChatMessage;
  currentUser: User | null;
  users: User[];
  onAction: (messageId: string, action: 'approved' | 'rejected', editedContent?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const isOwn = message.sender_type === 'user' && message.sender_id === currentUser?.id;
  const isIntegration = message.sender_type === 'integration' || message.sender_type === 'bot';
  const isPending = message.requires_action && message.action_status === 'pending';
  const isActioned = message.requires_action && message.action_status && message.action_status !== 'pending';

  // Find sender user for avatar
  const senderUser = message.sender_id ? users.find(u => u.id === message.sender_id) : null;
  const actionUser = message.action_by ? users.find(u => u.id === message.action_by) : null;

  // Auto-focus edit textarea
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = 'auto';
      editRef.current.style.height = `${editRef.current.scrollHeight}px`;
    }
  }, [editing]);

  const handleApprove = () => {
    if (editing && editText.trim() !== message.content) {
      onAction(message.id, 'approved', editText.trim());
    } else {
      onAction(message.id, 'approved');
    }
    setEditing(false);
  };

  const handleReject = () => {
    onAction(message.id, 'rejected');
    setEditing(false);
  };

  const metadata = message.metadata as Record<string, string> | undefined;
  const timeStr = new Date(message.created_at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className={`group flex gap-2.5 px-4 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 ${isPending ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 pt-0.5">
        {senderUser ? (
          <UserAvatar src={senderUser.avatar} name={senderUser.name} size="sm" />
        ) : isIntegration ? (
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Bot size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
            <UserIcon size={16} className="text-neutral-500" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Sender name + time */}
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${isIntegration ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-900 dark:text-white'}`}>
            {message.sender_name || senderUser?.name || 'Unknown'}
          </span>
          {isIntegration && message.sender_name && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              BOT
            </span>
          )}
          <span className="text-[11px] text-neutral-400">{timeStr}</span>
        </div>

        {/* Metadata context (for integration messages) */}
        {isIntegration && metadata && (metadata.incoming_message || metadata.guest_name) && (
          <div className="mt-1 p-2 rounded-md bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs">
            {metadata.guest_name && (
              <div className="text-neutral-500 dark:text-neutral-400">
                <span className="font-medium">Guest:</span> {String(metadata.guest_name)}
                {metadata.property_name && <span className="ml-2 text-neutral-400">• {String(metadata.property_name)}</span>}
                {metadata.channel && <span className="ml-2 text-neutral-400">via {String(metadata.channel)}</span>}
              </div>
            )}
            {metadata.incoming_message && (
              <div className="mt-1 text-neutral-700 dark:text-neutral-300 italic">
                &ldquo;{String(metadata.incoming_message)}&rdquo;
              </div>
            )}
          </div>
        )}

        {/* Message content or edit area */}
        {editing ? (
          <div className="mt-1">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              className="w-full p-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
            />
          </div>
        ) : (
          <div className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
            {isActioned && message.edited_content ? message.edited_content : message.content}
          </div>
        )}

        {/* Action status badge */}
        {isActioned && (
          <div className={`mt-1 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            message.action_status === 'approved'
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}>
            {message.action_status === 'approved' ? <Check size={12} /> : <X size={12} />}
            {message.action_status === 'approved' ? 'Approved' : 'Rejected'}
            {actionUser && <span className="ml-1 font-normal">by {actionUser.name}</span>}
            {message.edited_content && <span className="ml-1 font-normal">(edited)</span>}
          </div>
        )}

        {/* Action buttons for pending messages */}
        {isPending && !editing && (
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleApprove}
            >
              <Check size={12} className="mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                setEditText(message.content);
                setEditing(true);
              }}
            >
              <Pencil size={12} className="mr-1" /> Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
              onClick={handleReject}
            >
              <X size={12} className="mr-1" /> Reject
            </Button>
          </div>
        )}

        {/* Edit mode action buttons */}
        {editing && (
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleApprove}
            >
              <Check size={12} className="mr-1" /> Approve with Edits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setEditing(false);
                setEditText(message.content);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Create Channel Dialog (inline)
// ─────────────────────────────────────────────

function CreateChannelInline({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, description?: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), description.trim() || undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-card rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-700 p-5 w-80"
      >
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
          Create Channel
        </h3>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="channel-name"
          className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────
// Compose Bar
// ─────────────────────────────────────────────

function ComposeBar({
  onSend,
  sending,
  channelName,
}: {
  onSend: (content: string) => void;
  sending: boolean;
  channelName?: string;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!value.trim() || sending) return;
    onSend(value.trim());
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 px-4 py-3">
      <div className="flex items-end gap-2 bg-neutral-100 dark:bg-neutral-800/60 rounded-lg px-3 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={channelName ? `Message #${channelName}` : 'Type a message...'}
          rows={1}
          className="flex-1 bg-transparent text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 resize-none focus:outline-none"
          style={{ outline: 'none' }}
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || sending}
          className="p-1.5 rounded-md bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 disabled:opacity-30 hover:opacity-80 transition-opacity flex-shrink-0"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Window
// ─────────────────────────────────────────────

function MessagesWindowContent({ currentUser, users }: MessagesWindowProps) {
  const {
    channels,
    activeChannel,
    activeChannelId,
    messages,
    loadingChannels,
    loadingMessages,
    sending,
    selectChannel,
    sendMessage,
    createChannel,
    actionMessage,
  } = useMessages({ currentUser });

  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleCreateChannel = async (name: string, description?: string) => {
    await createChannel(name, description);
    setShowCreateChannel(false);
  };

  if (loadingChannels) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Channel Sidebar */}
      <ChannelList
        channels={channels}
        activeChannelId={activeChannelId}
        onSelect={selectChannel}
        onCreateChannel={() => setShowCreateChannel(true)}
      />

      {/* Message Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannel ? (
          <>
            {/* Channel Header */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
              {activeChannel.integration_source ? (
                <Zap size={16} className="text-amber-500" />
              ) : (
                <Hash size={16} className="text-neutral-400" />
              )}
              <span className="font-semibold text-sm text-neutral-900 dark:text-white">
                {activeChannel.name}
              </span>
              {activeChannel.description && (
                <span className="text-xs text-neutral-400 ml-2 truncate">
                  {activeChannel.description}
                </span>
              )}
              {activeChannel.integration_source && (
                <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  {activeChannel.integration_source}
                </span>
              )}
            </div>

            {/* Messages */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-neutral-400 text-sm">Loading messages...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3">
                    <MessageSquare size={20} className="text-neutral-400" />
                  </div>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No messages in #{activeChannel.name} yet
                  </p>
                  <p className="text-xs text-neutral-400 mt-1">
                    Send a message to start the conversation
                  </p>
                </div>
              ) : (
                <div className="py-2">
                  {messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      currentUser={currentUser}
                      users={users}
                      onAction={actionMessage}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Compose */}
            <ComposeBar
              onSend={sendMessage}
              sending={sending}
              channelName={activeChannel.name}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <MessageSquare size={24} className="text-neutral-400" />
            </div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white mb-1">
              Messages
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
              Select a channel to view messages, or create a new one to start a conversation.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setShowCreateChannel(true)}
            >
              <Plus size={14} className="mr-1" /> Create Channel
            </Button>
          </div>
        )}
      </div>

      {/* Create Channel Dialog */}
      {showCreateChannel && (
        <CreateChannelInline
          onSubmit={handleCreateChannel}
          onCancel={() => setShowCreateChannel(false)}
        />
      )}
    </div>
  );
}

const MessagesWindow = memo(MessagesWindowContent);
export default MessagesWindow;
