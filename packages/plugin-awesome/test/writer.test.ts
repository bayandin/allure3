import type { ResultFile } from "@allurereport/plugin-api";
import { epic, feature, label, story } from "allure-js-commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryReportDataWriter, ReportFileDataWriter } from "../src/writer.js";

beforeEach(async () => {
  await epic("coverage");
  await feature("report-output");
  await story("writer");
  await label("coverage", "report-output");
});

describe("InMemoryReportDataWriter", () => {
  it("should store normalized POSIX keys for report data", async () => {
    const writer = new InMemoryReportDataWriter();
    const attachment: ResultFile = {
      asBuffer: vi.fn().mockResolvedValue(Buffer.from("attachment")),
      writeTo: vi.fn(),
      getOriginalFileName: vi.fn(),
      getExtension: vi.fn(),
      getContentType: vi.fn(),
      getContentLength: vi.fn(),
    } as unknown as ResultFile;

    await writer.writeData("history\\entry.json", { id: 1 });
    await writer.writeWidget("allure_environment.json", []);
    await writer.writeWidget("default\\tree.json", { id: 2 });
    await writer.writeTestCase({ id: "tr-1" } as any);
    await writer.writeAttachment("foo\\bar.txt", attachment);

    const names = writer.reportFiles().map((file) => file.name);

    expect(names).toContain("data/history/entry.json");
    expect(names).toContain("widgets/allure_environment.json");
    expect(names).toContain("widgets/default/tree.json");
    expect(names).toContain("data/test-results/tr-1.json");
    expect(names).toContain("data/attachments/foo/bar.txt");
  });
});

describe("ReportFileDataWriter", () => {
  // Catches eagerly buffering attachments even when the report-file boundary can transfer them by path.
  it("uses path-aware transfer without buffering and forwards a known length", async () => {
    const addFileFrom = vi.fn().mockResolvedValue("/report/data/attachments/attachment.txt");
    const addFile = vi.fn();
    const writer = new ReportFileDataWriter({ addFile, addFileFrom });
    const asBuffer = vi.fn(() => {
      throw new Error("unexpected buffering");
    });
    const attachment: ResultFile = {
      asBuffer,
      readContent: vi.fn(),
      writeTo: vi.fn(),
      getOriginalFileName: vi.fn(),
      getExtension: vi.fn(),
      getContentType: vi.fn(),
      getContentLength: vi.fn(),
      asJson: vi.fn(),
      asUtf8String: vi.fn(),
    };

    await writer.writeAttachment("attachment.txt", attachment, 123);

    expect(addFileFrom).toHaveBeenCalledTimes(1);
    expect(addFileFrom).toHaveBeenCalledWith("data/attachments/attachment.txt", attachment, 123);
    expect(asBuffer).not.toHaveBeenCalled();
    expect(addFile).not.toHaveBeenCalled();
  });

  // Catches regressing legacy report-file implementations that only support buffered writes.
  it("falls back to buffering when path-aware transfer is unavailable", async () => {
    const addFile = vi.fn().mockResolvedValue("/report/data/attachments/attachment.txt");
    const writer = new ReportFileDataWriter({ addFile });
    const content = Buffer.from("legacy");
    const attachment: ResultFile = {
      asBuffer: vi.fn().mockResolvedValue(content),
      readContent: vi.fn(),
      writeTo: vi.fn(),
      getOriginalFileName: vi.fn(),
      getExtension: vi.fn(),
      getContentType: vi.fn(),
      getContentLength: vi.fn(),
      asJson: vi.fn(),
      asUtf8String: vi.fn(),
    };

    await writer.writeAttachment("attachment.txt", attachment);

    expect(addFile).toHaveBeenCalledWith("data/attachments/attachment.txt", content);
  });
});
