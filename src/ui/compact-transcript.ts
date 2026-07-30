import type { TextContent } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { extractText } from "../context.js";
import type { Theme } from "./agent-widget.js";

type TranscriptMessage = AgentSession["messages"][number];

export interface CompactTranscriptOptions {
  messages: readonly TranscriptMessage[];
  width: number;
  theme: Theme;
  /** Render at width - 2, leaving room for the transcript prefix. */
  renderAssistant?: (text: string, block: TextContent) => string[];
}

interface ToolSummary {
  kind: "agent" | "tool";
  name: string;
  detail?: string;
}

function stringArgument(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  return value.split("\n").find(line => line.trim())?.trim();
}

function summarizeTool(name: string, args: Record<string, unknown>): ToolSummary {
  if (name === "Agent") {
    const description = stringArgument(args, "description");
    const model = stringArgument(args, "model") ?? stringArgument(args, "subagent_type");
    const parts = [description, model];
    if (args.run_in_background === true) parts.push("↗ background");
    const detail = parts.filter(part => part !== undefined).join(" · ");
    return { kind: "agent", name: "agent", detail: detail || undefined };
  }

  const detailKeys = name === "bash"
    ? ["command"]
    : name === "grep"
      ? ["pattern", "path"]
      : ["path", "agent_id", "query", "pattern"];
  const detail = detailKeys
    .map(key => stringArgument(args, key))
    .filter(value => value !== undefined)
    .join(" · ");
  return { kind: "tool", name, detail: detail || undefined };
}

function firstLine(text: string): string | undefined {
  return text.split("\n").find(line => line.trim())?.trim();
}

/** Transform agent messages into compact, styled, width-safe transcript lines. */
export function renderCompactTranscript({ messages, width, theme, renderAssistant }: CompactTranscriptOptions): string[] {
  if (width <= 0) return [];

  const lines: string[] = [];
  const pushMessage = (text: string, block?: TextContent) => {
    const wrapped = block && renderAssistant
      ? renderAssistant(text.trim(), block)
      : wrapTextWithAnsi(text.trim(), Math.max(1, width - 2));
    for (const [index, line] of wrapped.entries()) {
      lines.push((index === 0 ? theme.fg("accent", "› ") : "  ") + line);
    }
  };
  const pushTool = ({ kind, name, detail }: ToolSummary) => {
    const icon = kind === "agent" ? "◈ " : "◇ ";
    let line = theme.fg("toolTitle", icon) + theme.fg("toolTitle", theme.bold(name));
    if (detail) line += `  ${theme.fg("muted", detail)}`;
    lines.push(line);
  };
  const pushFailure = (summary: string) => lines.push(theme.fg("error", `  ⎿ ${summary}`));

  for (const message of messages) {
    if (message.role === "user") {
      const text = typeof message.content === "string" ? message.content : extractText(message.content);
      if (text.trim()) pushMessage(text);
    } else if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "text" && content.text.trim()) pushMessage(content.text, content);
        if (content.type === "toolCall") pushTool(summarizeTool(content.name, content.arguments ?? {}));
      }
    } else if (message.role === "toolResult") {
      if (!message.isError) continue;
      pushFailure(firstLine(extractText(message.content)) ?? `${message.toolName} failed`);
    } else if (message.role === "bashExecution") {
      pushTool(summarizeTool("bash", { command: message.command }));
      const failed = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
      if (failed) {
        const fallback = message.cancelled ? "cancelled" : `exit ${message.exitCode}`;
        pushFailure(firstLine(message.output) ?? fallback);
      }
    }
  }

  return lines.map(line => truncateToWidth(line, width));
}
