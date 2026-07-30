import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { BashExecutionMessage } from "@earendil-works/pi-coding-agent";
import * as PiTui from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "../src/ui/agent-widget.js";
import { renderCompactTranscript } from "../src/ui/compact-transcript.js";

const state = vi.hoisted(() => ({
  wrapOverride: undefined as ((text: string, width: number) => string[]) | undefined,
}));

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const original = await importOriginal<typeof PiTui>();
  return {
    ...original,
    wrapTextWithAnsi: (...args: [string, number]) => state.wrapOverride?.(...args) ?? original.wrapTextWithAnsi(...args),
  };
});

const usage: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage,
    stopReason: "stop",
    timestamp: 0,
  };
}

function user(content: string): UserMessage {
  return { role: "user", content, timestamp: 0 };
}

function toolResult(overrides: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "read",
    content: [{ type: "text", text: "result" }],
    isError: false,
    timestamp: 0,
    ...overrides,
  };
}

function bashExecution(overrides: Partial<BashExecutionMessage> = {}): BashExecutionMessage {
  return {
    role: "bashExecution",
    command: "npm test",
    output: "",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 0,
    ...overrides,
  };
}

function semanticTheme(): Theme {
  return {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<b>${text}</b>`,
  };
}

function ansiTheme(): Theme {
  return {
    fg: (_color: string, text: string) => `\x1b[38;5;240m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
}

beforeEach(() => {
  state.wrapOverride = undefined;
});

describe("renderCompactTranscript", () => {
  it("preserves text and tool order while hiding successful results", () => {
    const messages = [
      user("Inspect the project."),
      assistant([
        { type: "text", text: "I’ll inspect the file." },
        { type: "toolCall", id: "t1", name: "read", arguments: { path: "package.json" } },
      ]),
      toolResult({ content: [{ type: "text", text: "very verbose file contents" }] }),
      assistant([
        { type: "text", text: "Now I’ll test controls." },
        {
          type: "toolCall",
          id: "t2",
          name: "Agent",
          arguments: {
            description: "Test subagent controls",
            subagent_type: "general-purpose",
            model: "profile/fast",
            run_in_background: true,
          },
        },
        { type: "toolCall", id: "t3", name: "steer_subagent", arguments: { agent_id: "agent-123" } },
        { type: "toolCall", id: "t4", name: "get_subagent_result", arguments: { agent_id: "agent-123" } },
      ]),
    ];

    expect(renderCompactTranscript({ messages, width: 500, theme: semanticTheme() })).toEqual([
      "<accent>› </accent>Inspect the project.",
      "<accent>› </accent>I’ll inspect the file.",
      "<toolTitle>◇ </toolTitle><toolTitle><b>read</b></toolTitle>  <muted>package.json</muted>",
      "<accent>› </accent>Now I’ll test controls.",
      "<toolTitle>◈ </toolTitle><toolTitle><b>agent</b></toolTitle>  <muted>Test subagent controls · profile/fast · ↗ background</muted>",
      "<toolTitle>◇ </toolTitle><toolTitle><b>steer_subagent</b></toolTitle>  <muted>agent-123</muted>",
      "<toolTitle>◇ </toolTitle><toolTitle><b>get_subagent_result</b></toolTitle>  <muted>agent-123</muted>",
    ]);
  });

  it("reduces tool and shell failures to one useful line", () => {
    const messages = [
      toolResult({ isError: true, content: [{ type: "text", text: "File not found\nstack trace" }] }),
      toolResult({ toolName: "grep", isError: true, content: [] }),
      bashExecution({ command: "long task", cancelled: true, exitCode: undefined }),
      bashExecution({ command: "false", exitCode: 1 }),
    ];

    expect(renderCompactTranscript({ messages, width: 500, theme: semanticTheme() })).toEqual([
      "<error>  ⎿ File not found</error>",
      "<error>  ⎿ grep failed</error>",
      "<toolTitle>◇ </toolTitle><toolTitle><b>bash</b></toolTitle>  <muted>long task</muted>",
      "<error>  ⎿ cancelled</error>",
      "<toolTitle>◇ </toolTitle><toolTitle><b>bash</b></toolTitle>  <muted>false</muted>",
      "<error>  ⎿ exit 1</error>",
    ]);
  });

  it("passes stable assistant blocks to the renderer, keeps users raw and clamps its output", () => {
    const message = assistant([
      { type: "text", text: "# assistant" },
      { type: "toolCall", id: "t", name: "read", arguments: { path: "file" } },
      { type: "text", text: "second" },
    ]);
    const renderAssistant = vi.fn(() => ["rendered", "X".repeat(100)]);
    const lines = renderCompactTranscript({
      messages: [user("# user"), message], width: 20, theme: ansiTheme(), renderAssistant,
    });
    expect(renderAssistant).toHaveBeenCalledTimes(2);
    expect(renderAssistant.mock.calls[0]).toEqual(["# assistant", message.content[0]]);
    expect(renderAssistant.mock.calls[1]).toEqual(["second", message.content[2]]);
    expect(lines[0]).toContain("# user");
    expect(lines[1]).toContain("rendered");
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
  });

  it("normalizes tool details to a single non-empty line", () => {
    const messages = [assistant([{
      type: "toolCall",
      id: "t1",
      name: "grep",
      arguments: { pattern: "\n  target  \nignored", path: " src " },
    }])];

    expect(renderCompactTranscript({ messages, width: 500, theme: semanticTheme() })).toEqual([
      "<toolTitle>◇ </toolTitle><toolTitle><b>grep</b></toolTitle>  <muted>target · src</muted>",
    ]);
  });

  it("clamps malformed wrapped output to the requested width", () => {
    const width = 40;
    state.wrapOverride = () => [`\x1b[31m${"界".repeat(width)}\x1b[0m`];

    const lines = renderCompactTranscript({ messages: [user("trigger wrapping")], width, theme: ansiTheme() });

    expect(state.wrapOverride).toBeDefined();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  });
});
