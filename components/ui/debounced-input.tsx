'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Input } from './input';
import { Textarea } from './textarea';

interface DebouncedInputProps {
  value: string;
  onChange: (value: string) => void;
  delay?: number;
  className?: string;
  placeholder?: string;
  type?: string;
  id?: string;
  disabled?: boolean;
}

interface DebouncedTextareaProps extends DebouncedInputProps {
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

// Memoized debounced input - manages local state to prevent parent re-renders on every keystroke
export const DebouncedInput = memo(function DebouncedInput({
  value,
  onChange,
  delay = 300,
  className,
  placeholder,
  type = 'text',
  id,
  disabled
}: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced sync back to parent
  useEffect(() => {
    if (localValue === value) return;

    const timer = setTimeout(() => {
      onChange(localValue);
    }, delay);

    return () => clearTimeout(timer);
  }, [localValue, delay, onChange, value]);

  return (
    <Input
      type={type}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      className={className}
      placeholder={placeholder}
      id={id}
      disabled={disabled}
    />
  );
});

// Memoized debounced textarea
export const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onChange,
  delay = 300,
  className,
  placeholder,
  id,
  disabled,
  rows,
  onKeyDown
}: DebouncedTextareaProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced sync back to parent
  useEffect(() => {
    if (localValue === value) return;

    const timer = setTimeout(() => {
      onChange(localValue);
    }, delay);

    return () => clearTimeout(timer);
  }, [localValue, delay, onChange, value]);

  return (
    <Textarea
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      className={className}
      placeholder={placeholder}
      id={id}
      disabled={disabled}
      rows={rows}
      onKeyDown={onKeyDown}
    />
  );
});

// Simple native input version for bare inputs (no styling wrapper)
export const DebouncedNativeInput = memo(function DebouncedNativeInput({
  value,
  onChange,
  delay = 300,
  className,
  placeholder,
  type = 'text',
  id,
  disabled
}: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (localValue === value) return;

    const timer = setTimeout(() => {
      onChange(localValue);
    }, delay);

    return () => clearTimeout(timer);
  }, [localValue, delay, onChange, value]);

  return (
    <input
      type={type}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      className={className}
      placeholder={placeholder}
      id={id}
      disabled={disabled}
    />
  );
});
