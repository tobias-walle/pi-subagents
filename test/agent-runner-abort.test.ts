import { describe, expect, it, vi } from "vitest";
import { resumeAgent, runAgent } from "../src/agent-runner.js";

describe("agent runner cancellation", () => {
  it("does not initialize a run when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runAgent({} as any, "general-purpose", "go", {
      pi: {} as any,
      signal: controller.signal,
    })).rejects.toBe(controller.signal.reason);
  });

  it("does not resume a session when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = {
      messages: [],
      prompt: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    } as any;

    await expect(resumeAgent(session, "go", { signal: controller.signal }))
      .rejects.toBe(controller.signal.reason);
    expect(session.prompt).not.toHaveBeenCalled();
  });
});
