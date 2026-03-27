'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Channel, ChatMessage, User } from '@/lib/types';

interface UseMessagesProps {
  currentUser: User | null;
}

export function useMessages({ currentUser }: UseMessagesProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ─── Fetch Channels ───
  const fetchChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const res = await fetch('/api/channels');
      const data = await res.json();
      if (data.data) {
        setChannels(data.data);
        // Auto-select first channel if none selected
        if (!activeChannelId && data.data.length > 0) {
          setActiveChannelId(data.data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching channels:', err);
    } finally {
      setLoadingChannels(false);
    }
  }, [activeChannelId]);

  // ─── Fetch Messages for Active Channel ───
  const fetchMessages = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages?channel_id=${channelId}`);
      const data = await res.json();
      if (data.data) {
        setMessages(data.data);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // ─── Send a Message ───
  const sendMessage = useCallback(async (content: string) => {
    if (!activeChannelId || !currentUser || !content.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: activeChannelId,
          sender_type: 'user',
          sender_id: currentUser.id,
          sender_name: currentUser.name,
          content: content.trim(),
        }),
      });
      const data = await res.json();
      if (data.data) {
        // Optimistic: add to messages immediately
        setMessages(prev => [...prev, data.data]);
      }
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  }, [activeChannelId, currentUser]);

  // ─── Create a Channel ───
  const createChannel = useCallback(async (name: string, description?: string) => {
    if (!currentUser) return null;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.toLowerCase().replace(/\s+/g, '-'),
          description,
          type: 'general',
          created_by: currentUser.id,
        }),
      });
      const data = await res.json();
      if (data.data) {
        setChannels(prev => [...prev, data.data]);
        setActiveChannelId(data.data.id);
        return data.data;
      }
      return null;
    } catch (err) {
      console.error('Error creating channel:', err);
      return null;
    }
  }, [currentUser]);

  // ─── Action on Message (approve/reject/edit) ───
  const actionMessage = useCallback(async (
    messageId: string,
    action: 'approved' | 'rejected',
    editedContent?: string
  ) => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/messages/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          action_status: action,
          action_by: currentUser.id,
          edited_content: editedContent || null,
        }),
      });
      const data = await res.json();
      if (data.data) {
        // Update the message in state
        setMessages(prev =>
          prev.map(m => m.id === messageId ? { ...m, ...data.data } : m)
        );
      }
    } catch (err) {
      console.error('Error actioning message:', err);
    }
  }, [currentUser]);

  // ─── Select Channel ───
  const selectChannel = useCallback((channelId: string) => {
    setActiveChannelId(channelId);
    setMessages([]);
  }, []);

  // ─── Realtime Subscription ───
  useEffect(() => {
    if (!activeChannelId) return;

    // Fetch messages for the newly selected channel
    fetchMessages(activeChannelId);

    // Clean up previous subscription
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    // Subscribe to new messages in this channel
    const channel = supabase
      .channel(`messages:${activeChannelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${activeChannelId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages(prev => {
            // Avoid duplicates (optimistic update may have already added it)
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${activeChannelId}`,
        },
        (payload) => {
          const updated = payload.new as ChatMessage;
          setMessages(prev =>
            prev.map(m => m.id === updated.id ? { ...m, ...updated } : m)
          );
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeChannelId, fetchMessages]);

  // ─── Initial Load ───
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const activeChannel = channels.find(c => c.id === activeChannelId) || null;

  return {
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
    fetchChannels,
  };
}
