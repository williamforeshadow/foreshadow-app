import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TiptapJSON } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Extract plain text from a Tiptap JSON document for display/search. */
export function tiptapToPlainText(doc: TiptapJSON | null | undefined): string {
  if (!doc) return '';
  const parts: string[] = [];
  function walk(node: TiptapJSON) {
    if (node.text) parts.push(node.text);
    if (node.content) node.content.forEach(walk);
  }
  walk(doc);
  return parts.join(' ').trim();
}

/** Check whether a Tiptap document has any meaningful content. */
export function tiptapHasContent(doc: TiptapJSON | null | undefined): boolean {
  return tiptapToPlainText(doc).length > 0;
}
