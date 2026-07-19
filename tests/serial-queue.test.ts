import { describe, expect, it } from "vitest";
import { SerialTaskQueue } from "../src/serial-queue";

describe("SerialTaskQueue", () => {
  it("runs tasks in submission order", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    const queue = new SerialTaskQueue();

    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return 1;
    });
    const second = queue.run(async () => {
      events.push("second");
      return 2;
    });
    await Promise.resolve();

    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("does not pass a task rejection to later tasks", async () => {
    const queue = new SerialTaskQueue();
    const failed = queue.run(async () => {
      throw new Error("failed");
    });
    const succeeded = queue.run(async () => "ok");

    await expect(failed).rejects.toThrow("failed");
    await expect(succeeded).resolves.toBe("ok");
  });
});
