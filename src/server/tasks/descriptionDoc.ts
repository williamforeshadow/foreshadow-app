/**
 * Task descriptions are Tiptap documents; the agent writes plain strings.
 * This module is the translation between the two, in both directions.
 *
 * The agent naturally writes markdown-ish prose — "- item" for a list, "[ ] item"
 * for something to tick off. Before this existed, every such line became a
 * paragraph containing those literal characters, so a list the agent "wrote"
 * rendered as hyphens rather than an actual list, even though the editor has
 * supported bulletList/orderedList/taskList all along. Reading that markdown here
 * means the agent gets real structure without needing a richer tool input to get
 * wrong: it keeps sending a string.
 *
 * The render direction matters just as much. Comparing descriptions used to be
 * done on an 80-character display preview, which silently swallowed any edit
 * past that point. `toComparableText` renders the whole document INCLUDING its
 * structure, so equality means "same words and same shape" — and because it emits
 * the same markdown `fromMarkdownish` parses, the two round-trip.
 */

/** Headings are capped at the levels the editor actually offers. */
const HEADING_LEVELS = [2, 3] as const;

export const EMPTY_DOC = { type: 'doc', content: [] as unknown[] };

export function isTiptapDoc(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'doc'
  );
}

type Line =
  | { kind: 'blank' }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'ordered'; text: string }
  | { kind: 'task'; text: string; checked: boolean }
  | { kind: 'paragraph'; text: string };

// A checkbox may be written with or without a leading bullet ("- [ ] x" or
// "[ ] x"); both are things people and models write, and both mean the same.
const TASK_RE = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;

function classify(raw: string): Line {
  const line = raw.trimEnd();
  if (line.trim().length === 0) return { kind: 'blank' };

  const heading = HEADING_RE.exec(line);
  if (heading) {
    // Clamp into the editor's range rather than emitting an h1/h4 it cannot
    // render — a heading that shows up as nothing is worse than a near one.
    const level = Math.min(
      Math.max(heading[1].length, HEADING_LEVELS[0]),
      HEADING_LEVELS[HEADING_LEVELS.length - 1],
    );
    return { kind: 'heading', level, text: heading[2].trim() };
  }
  // Checkbox before bullet: "- [ ] x" satisfies both patterns.
  const task = TASK_RE.exec(line);
  if (task) {
    return { kind: 'task', checked: task[1].toLowerCase() === 'x', text: task[2].trim() };
  }
  const bullet = BULLET_RE.exec(line);
  if (bullet) return { kind: 'bullet', text: bullet[1].trim() };

  const ordered = ORDERED_RE.exec(line);
  if (ordered) return { kind: 'ordered', text: ordered[1].trim() };

  return { kind: 'paragraph', text: line.trim() };
}

function paragraph(text: string) {
  return text.length > 0
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph' };
}

/**
 * Parse the markdown-ish text the agent writes into a Tiptap document.
 *
 * Consecutive list lines of the same kind collapse into one list node, which is
 * what makes a run of "- " lines a single list rather than several one-item
 * lists. Plain lines become separate paragraphs: the old converter split only on
 * BLANK lines, so a single-newline list collapsed into one paragraph with
 * embedded newlines and rendered as a run-on sentence.
 */
export function fromMarkdownish(text: string): Record<string, unknown> {
  const lines = text.split('\n').map(classify);
  const content: unknown[] = [];

  let listNode: { type: string; content: unknown[] } | null = null;
  const closeList = () => {
    if (listNode) content.push(listNode);
    listNode = null;
  };
  const openList = (type: string) => {
    if (listNode?.type !== type) {
      closeList();
      listNode = { type, content: [] };
    }
    return listNode!;
  };

  for (const line of lines) {
    switch (line.kind) {
      case 'blank':
        closeList();
        break;
      case 'bullet':
        openList('bulletList').content.push({
          type: 'listItem',
          content: [paragraph(line.text)],
        });
        break;
      case 'ordered':
        openList('orderedList').content.push({
          type: 'listItem',
          content: [paragraph(line.text)],
        });
        break;
      case 'task':
        openList('taskList').content.push({
          type: 'taskItem',
          attrs: { checked: line.checked },
          content: [paragraph(line.text)],
        });
        break;
      case 'heading':
        closeList();
        content.push({
          type: 'heading',
          attrs: { level: line.level },
          content: [{ type: 'text', text: line.text }],
        });
        break;
      case 'paragraph':
        closeList();
        content.push(paragraph(line.text));
        break;
    }
  }
  closeList();

  return content.length === 0 ? { ...EMPTY_DOC } : { type: 'doc', content };
}

/** Back-compat alias — this replaced the paragraphs-only converter. */
export const plainTextToTiptap = fromMarkdownish;

function inlineText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) return n.content.map(inlineText).join('');
  return '';
}

/**
 * Render a description to text that carries its STRUCTURE, for comparison.
 *
 * Emits the same markdown `fromMarkdownish` reads, so the two round-trip and a
 * document compares equal to the text that produced it. Structure is included on
 * purpose: reformatting a list without changing a word is a real edit, and the
 * old flatten (which joined every text node with a space) could not see it.
 */
export function toComparableText(desc: unknown): string {
  if (desc == null) return '';
  if (typeof desc === 'string') return fromMarkdownishNormalized(desc);
  if (!isTiptapDoc(desc)) return '';

  const out: string[] = [];
  const walkBlocks = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as {
        type?: string;
        attrs?: { level?: number; checked?: boolean };
        content?: unknown[];
      };
      switch (n.type) {
        case 'heading':
          out.push(`${'#'.repeat(n.attrs?.level ?? 2)} ${inlineText(n)}`);
          break;
        case 'bulletList':
          for (const item of n.content ?? []) out.push(`- ${inlineText(item).trim()}`);
          break;
        case 'orderedList':
          (n.content ?? []).forEach((item, i) =>
            out.push(`${i + 1}. ${inlineText(item).trim()}`),
          );
          break;
        case 'taskList':
          for (const item of n.content ?? []) {
            const checked = (item as { attrs?: { checked?: boolean } })?.attrs?.checked;
            out.push(`[${checked ? 'x' : ' '}] ${inlineText(item).trim()}`);
          }
          break;
        case 'paragraph': {
          const text = inlineText(n).trim();
          if (text.length > 0) out.push(text);
          break;
        }
        default:
          // Unknown block (blockquote, codeBlock, a future node): fall back to
          // its text so an edit to it is still visible as a change.
          if (Array.isArray(n.content)) walkBlocks(n.content);
          else {
            const text = inlineText(n).trim();
            if (text.length > 0) out.push(text);
          }
      }
    }
  };
  walkBlocks((desc as { content?: unknown[] }).content ?? []);
  return out.join('\n').trim();
}

/** Normalize a raw string the same way a parsed-then-rendered one would be. */
function fromMarkdownishNormalized(text: string): string {
  return toComparableText(fromMarkdownish(text));
}

/** Attributes that carry meaning; everything else is editor bookkeeping. */
const SIGNIFICANT_ATTRS = ['level', 'checked'] as const;

/**
 * Reduce a document to the shape that matters for equality: node types, text,
 * and the few attributes that change what the reader sees.
 *
 * Dropping the other attributes keeps incidental editor bookkeeping (alignment,
 * ids, marks the agent cannot express) from reporting a change when the agent
 * re-sends text it did not touch.
 */
function canonicalShape(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    content?: unknown[];
  };
  const out: Record<string, unknown> = {};
  if (n.type) out.t = n.type;
  if (typeof n.text === 'string') out.x = n.text;
  if (n.attrs) {
    const kept: Record<string, unknown> = {};
    for (const key of SIGNIFICANT_ATTRS) {
      if (n.attrs[key] !== undefined && n.attrs[key] !== null) kept[key] = n.attrs[key];
    }
    if (Object.keys(kept).length > 0) out.a = kept;
  }
  if (Array.isArray(n.content)) {
    const kids = n.content.map(canonicalShape).filter(Boolean);
    if (kids.length > 0) out.c = kids;
  }
  return out;
}

function toDoc(value: unknown): Record<string, unknown> {
  if (value == null) return { ...EMPTY_DOC };
  if (typeof value === 'string') return fromMarkdownish(value);
  if (isTiptapDoc(value)) return value;
  return { ...EMPTY_DOC };
}

/**
 * Did the description actually change?
 *
 * Compares full structured content, deliberately NOT the display preview:
 * comparing previews meant any edit past the preview's cutoff was invisible, so
 * the diff came back empty while the commit still wrote the new text.
 *
 * Structure is compared rather than just the rendered text because they can
 * disagree. Descriptions written before this module existed stored "- a\n- b" as
 * ONE paragraph with embedded newlines — a list that only looks like one. That
 * renders to the same text as a real bulletList, so a text-only comparison would
 * call reformatting it a no-op even though the stored document, and what the
 * user sees, both change.
 */
export function descriptionChanged(before: unknown, after: unknown): boolean {
  return (
    JSON.stringify(canonicalShape(toDoc(before))) !==
    JSON.stringify(canonicalShape(toDoc(after)))
  );
}

/** Longest description text carried in a plan, purely a runaway guard. */
const MAX_PLAN_TEXT = 2000;

/**
 * Human-readable description text for a preview plan.
 *
 * Shows the whole thing up to a generous ceiling. The user is being asked to
 * approve this exact content, so truncating it to a one-line teaser would hide
 * what they are agreeing to.
 */
export function describeDescription(desc: unknown): string | null {
  const text = toComparableText(desc);
  if (text.length === 0) return null;
  return text.length <= MAX_PLAN_TEXT ? text : `${text.slice(0, MAX_PLAN_TEXT - 3)}...`;
}
