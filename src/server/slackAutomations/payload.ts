import type { Block } from '@slack/types';
import type { SlackAutomationConfig } from '@/lib/types';
import { normalizeSlackAutomationConfig } from '@/lib/slackAutomationConfig';
import type { TaskByIdRow } from '@/src/server/tasks/getTaskById';
import { renderTaskRowsAsExtras } from '@/src/slack/unfurl';
import { renderTemplate } from './render';

export interface SlackAutomationPayload {
  text: string;
  blocks?: Block[];
  errors: string[];
}

export interface TaskCardPayloadContext {
  task: TaskByIdRow;
  url: string;
}

const BLOCK_LIMIT = 50;
const TEXT_OBJECT_LIMIT = 3000;
const RAW_MRKDWN_VARIABLES = new Set(['task_url', 'task_link']);

export function escapeSlackMrkdwn(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSlackTaskLink(args: {
  url: string;
  title: string;
}): string {
  if (!isAbsoluteHttpUrl(args.url)) return '';
  return `<${args.url}|${escapeSlackMrkdwn(args.title)}>`;
}

export function renderSlackAutomationPayload(args: {
  config: SlackAutomationConfig;
  variables: Record<string, string>;
  taskCard?: TaskCardPayloadContext;
}): SlackAutomationPayload {
  const { variables, taskCard } = args;
  const config = normalizeSlackAutomationConfig(args.config);
  const message = config.action?.message;
  const messageTemplate = message?.template ?? config.message_template ?? '';
  const customBlocksJson = message?.custom_blocks_json ?? config.custom_blocks_json ?? '';
  const useCustomBlocks = message?.use_custom_blocks ?? config.message_format === 'custom_blocks';
  const includeTaskCards = message?.include_task_cards ?? config.message_format === 'task_card';
  const fallbackText = renderTemplate(messageTemplate, variables).trim();
  const visibleIntroText = renderSlackMrkdwnTemplate(
    messageTemplate,
    variables,
  ).trim();
  const errors = validateVariableRequirements(config, variables);

  if (!useCustomBlocks && !includeTaskCards) {
    return {
      text: fallbackText,
      errors,
    };
  }

  const blocks: Block[] = [];
  if (visibleIntroText) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: visibleIntroText },
    } as Block);
  }

  if (includeTaskCards && taskCard) {
    if (!isAbsoluteHttpUrl(taskCard.url)) {
      errors.push('Task card format requires APP_BASE_URL so task buttons use absolute URLs.');
    } else {
      const extras = renderTaskRowsAsExtras([taskCard]);
      if (extras.blocks?.length) {
        blocks.push(...extras.blocks);
      } else {
        errors.push('Task card format could not render a Slack task card.');
      }
    }
  }

  if (useCustomBlocks) {
    const parsed = parseCustomBlocks(customBlocksJson, variables);
    errors.push(...parsed.errors);
    blocks.push(...parsed.blocks);
  }

  if (blocks.length > BLOCK_LIMIT) {
    errors.push(`Slack messages can include at most ${BLOCK_LIMIT} blocks.`);
  }

  return {
    text: fallbackText || buildFallbackText(variables),
    blocks: blocks.slice(0, BLOCK_LIMIT),
    errors,
  };
}

export function renderSlackMrkdwnTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const blockVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    blockVars[key] = RAW_MRKDWN_VARIABLES.has(key)
      ? value
      : escapeSlackMrkdwn(value);
  }
  return renderTemplate(template, blockVars);
}

function parseCustomBlocks(
  json: string,
  variables: Record<string, string>,
): { blocks: Block[]; errors: string[] } {
  const trimmed = json.trim();
  if (!trimmed) {
    return {
      blocks: [],
      errors: ['Custom blocks mode needs a Slack blocks JSON array.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      blocks: [],
      errors: [`Custom blocks JSON is invalid: ${message}`],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      blocks: [],
      errors: ['Custom blocks JSON must be an array of Slack blocks.'],
    };
  }

  const rendered = renderBlockValue(parsed, variables);
  const errors = validateBlocks(rendered);
  return {
    blocks: rendered as Block[],
    errors,
  };
}

function renderBlockValue(
  value: unknown,
  variables: Record<string, string>,
): unknown {
  if (typeof value === 'string') {
    return renderSlackMrkdwnTemplate(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderBlockValue(item, variables));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = renderBlockValue(child, variables);
    }
    return out;
  }
  return value;
}

function validateBlocks(value: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) return ['Custom blocks JSON must be an array.'];
  if (value.length === 0) errors.push('Custom blocks JSON cannot be an empty array.');
  if (value.length > BLOCK_LIMIT) {
    errors.push(`Slack messages can include at most ${BLOCK_LIMIT} blocks.`);
  }

  value.forEach((block, index) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      errors.push(`Block ${index + 1} must be an object.`);
      return;
    }
    const typed = block as { type?: unknown };
    if (typeof typed.type !== 'string' || !typed.type.trim()) {
      errors.push(`Block ${index + 1} needs a string type.`);
    }
    validateTextObjects(block, `Block ${index + 1}`, errors);
  });

  return errors;
}

function validateTextObjects(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTextObjects(item, `${path}.${index}`, errors));
    return;
  }

  const object = value as Record<string, unknown>;
  if (
    (object.type === 'mrkdwn' || object.type === 'plain_text') &&
    Object.prototype.hasOwnProperty.call(object, 'text')
  ) {
    if (typeof object.text !== 'string' || !object.text.trim()) {
      errors.push(`${path} has an empty Slack text object.`);
    } else if (object.text.length > TEXT_OBJECT_LIMIT) {
      errors.push(`${path} text is longer than Slack's ${TEXT_OBJECT_LIMIT}-character text object limit.`);
    }
  }

  for (const [key, child] of Object.entries(object)) {
    validateTextObjects(child, `${path}.${key}`, errors);
  }
}

function validateVariableRequirements(
  config: SlackAutomationConfig,
  variables: Record<string, string>,
): string[] {
  const errors: string[] = [];
  const templates = [
    config.action?.message?.template ?? config.message_template ?? '',
    config.action?.message?.use_custom_blocks || config.message_format === 'custom_blocks'
      ? config.action?.message?.custom_blocks_json ?? config.custom_blocks_json ?? ''
      : '',
  ];
  const usesTaskLink = templates.some((template) => usesVariable(template, 'task_link'));
  if (usesTaskLink && !variables.task_link) {
    errors.push('The {{task_link}} variable requires APP_BASE_URL to be configured.');
  }
  return errors;
}

function usesVariable(template: string, variable: string): boolean {
  return new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`).test(template);
}

function buildFallbackText(variables: Record<string, string>): string {
  if (variables.task_title) return `Task assigned: ${variables.task_title}`;
  if (variables.property_name || variables.guest_name) {
    return [variables.property_name, variables.guest_name].filter(Boolean).join(' - ');
  }
  return 'Slack automation';
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
