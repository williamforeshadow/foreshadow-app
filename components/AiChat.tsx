"use client";

import { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  AudioLines,
  Bot,
  MessageSquare,
  Paperclip,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import styles from "./AiChat.module.css";

const aiModes = [
  { value: "default", label: "Default", icon: WandSparkles },
  { value: "fast", label: "Fast", icon: Zap },
];

interface AIResponse {
  content: string;
  toolUsed?: string;
}

export function AiChat() {
  const [inputValue, setInputValue] = useState("");
  const [selectedMode, setSelectedMode] = useState("default");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<AIResponse | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    setInputValue("");
    setIsLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/ai-router", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userMessage }),
      });

      const data = await res.json();

      if (data.error) {
        setResponse({ content: `Error: ${data.error}` });
      } else {
        setResponse({
          content: data.answer,
          toolUsed: data.tool_used,
        });
      }
    } catch (err: any) {
      setResponse({ content: `Error: ${err.message || "Failed to get response"}` });
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

  const SelectedIcon = aiModes.find((m) => m.value === selectedMode)?.icon || WandSparkles;

  return (
    <div className={styles.container}>
      {/* Response Area */}
      {(response || isLoading) && (
        <div className={styles.responseArea}>
          <Button
            variant="ghost"
            size="icon"
            className={styles.closeResponseButton}
            onClick={() => setResponse(null)}
          >
            <X className="h-3 w-3" />
          </Button>
          <div className={styles.responseMessage}>
            <div className={styles.botIcon}>
              <Bot />
            </div>
            <div className={styles.responseText}>
              {isLoading ? (
                <div className={styles.loadingDots}>
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                </div>
              ) : response ? (
                <>
                  {response.toolUsed && response.toolUsed !== "none" && (
                    <div className={styles.toolBadge}>
                      {response.toolUsed === "snapshot" ? "📊 Snapshot" : "🔍 Database"}
                    </div>
                  )}
                  {response.content}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Input Card */}
      <Card className={styles.inputCard}>
        <CardContent className={styles.inputArea}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask and I'll answer."
            rows={1}
            style={{ outline: "none" }}
          />
        </CardContent>
        <CardFooter className={styles.footer}>
          <div className={styles.leftActions}>
            <Button
              className={`${styles.iconButton} ${styles.attachButton}`}
              size="icon"
              type="button"
              variant="outline"
            >
              <Paperclip size={14} />
            </Button>

            <Select value={selectedMode} onValueChange={setSelectedMode}>
              <SelectTrigger size="sm" className={styles.selectTrigger}>
                <SelectValue>
                  <div className="flex items-center gap-2">
                    <SelectedIcon size={14} />
                    <span>{aiModes.find((m) => m.value === selectedMode)?.label}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {aiModes.map(({ label, value, icon: Icon }) => (
                  <SelectItem key={value} value={value}>
                    <div className="flex items-center gap-2">
                      <Icon size={14} />
                      <span>{label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className={styles.submitButton}
            size="icon"
            type="button"
            variant="outline"
            onClick={handleSubmit}
            disabled={isLoading}
          >
            {inputValue.trim() ? <ArrowUp size={16} /> : <AudioLines size={16} />}
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
