"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowUp,
  ChevronDown,
  MessageSquare,
  Paperclip,
  X,
  User,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { useAuth } from "@/lib/authContext";
import styles from "./AiChat.module.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function AiChat() {
  const { user } = useAuth();
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showMessages, setShowMessages] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    const userMsgId = `user-${Date.now()}`;
    
    // Add user message immediately to UI
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: userMessage }]);
    setInputValue("");
    setIsLoading(true);
    setShowMessages(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt: userMessage,
          user_id: user.id,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", content: `Error: ${data.error || "Something went wrong"}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", content: data.answer },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", content: `Error: ${err.message || "Failed to get response"}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Collapsed state
  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className={styles.toggleButton}
        size="icon"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div className={styles.container}>
      {/* Messages Area */}
      {(messages.length > 0 || isLoading) && showMessages && (
        <div className={styles.responseWrapper}>
          <Button
            variant="ghost"
            size="icon"
            className={styles.closeResponseButton}
            onClick={() => setShowMessages(false)}
            title="Minimize chat"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <div className={styles.responseArea}>
            <div className={styles.messagesContainer}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`${styles.messageRow} ${
                  msg.role === "user" ? styles.userMessage : styles.assistantMessage
                }`}
              >
                <div className={styles.messageIcon}>
                  {msg.role === "user" ? (
                    <User size={14} />
                  ) : (
                    <Bot size={14} />
                  )}
                </div>
                <div className={styles.messageContent}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className={`${styles.messageRow} ${styles.assistantMessage}`}>
                <div className={styles.messageIcon}>
                  <Bot size={14} />
                </div>
                <div className={styles.messageContent}>
                  <div className={styles.loadingDots}>
                    <span className={styles.loadingDot} />
                    <span className={styles.loadingDot} />
                    <span className={styles.loadingDot} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Toggle button to show messages when hidden */}
      {messages.length > 0 && !showMessages && !isLoading && (
        <button
          className={styles.responseToggle}
          onClick={() => setShowMessages(true)}
        >
          <MessageSquare size={14} />
          <span>Show Chat</span>
        </button>
      )}

      {/* Input Card */}
      <Card className={styles.inputCard}>
        <CardContent className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            style={{ outline: "none" }}
          />
        </CardContent>
        <CardFooter className={styles.footer}>
          <div className={styles.leftActions}>
            <Button
              className={styles.attachButton}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Paperclip size={12} />
            </Button>
          </div>

          <Button
            className={styles.submitButton}
            size="icon"
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || !inputValue.trim()}
          >
            <ArrowUp size={14} />
          </Button>
        </CardFooter>

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className={styles.mainCloseButton}
          onClick={() => setIsOpen(false)}
        >
          <X className="h-3 w-3" />
        </Button>
      </Card>
    </div>
  );
}
