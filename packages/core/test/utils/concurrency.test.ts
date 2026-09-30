import { epic, feature, label, story } from "allure-js-commons";
import { beforeEach, describe, expect, it } from "vitest";

import { forEachConcurrently } from "../../src/utils/concurrency.js";

const createSignal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

beforeEach(async () => {
  await epic("coverage");
  await feature("report-engine");
  await story("concurrency");
  await label("coverage", "report-engine");
});

describe("forEachConcurrently", () => {
  it("does not acquire queued items before a worker is available", async () => {
    const values = [0, 1, 2, 3, 4];
    const acquired: number[] = [];
    const items = new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) {
          acquired.push(Number(property));
        }

        return Reflect.get(target, property, receiver);
      },
    });
    const visitStarted = createSignal();
    const releaseVisits = createSignal();
    const started: number[] = [];
    const processing = forEachConcurrently(items, 2, async (item) => {
      started.push(item);

      if (started.length === 2) {
        visitStarted.resolve();
      }

      await releaseVisits.promise;
    });

    try {
      await visitStarted.promise;
      expect(started).toEqual([0, 1]);
      expect(acquired).toEqual([0, 1]);
    } finally {
      releaseVisits.resolve();
      await processing;
    }

    expect([...started].sort((a, b) => a - b)).toEqual(values);
  });
});
