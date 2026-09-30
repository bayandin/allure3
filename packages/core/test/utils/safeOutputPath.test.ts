import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { join as joinPosix } from "node:path/posix";
import { Readable } from "node:stream";

import type { ReportFiles, ResultFile } from "@allurereport/plugin-api";
import { epic, feature, label, story } from "allure-js-commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileSystemReportFiles, PluginFiles } from "../../src/plugin.js";
import {
  isPathContainedInDir,
  resolvePathUnderOutputRoot,
  UnsafeReportOutputPathError,
} from "../../src/utils/safeOutputPath.js";
import { isWindows } from "../../src/utils/windows.js";

const FOUR_MIB = 4 * 1024 * 1024;

const createResultFile = (
  content: Buffer | undefined,
  contentLength = content?.length,
  options: {
    asBuffer?: ResultFile["asBuffer"];
    readContent?: ResultFile["readContent"];
    unknownLength?: boolean;
  } = {},
): ResultFile => {
  const asBuffer = options.asBuffer ?? vi.fn(async () => content);
  const readContent =
    options.readContent ??
    (async <T>(transform: (stream: Readable) => Promise<T | undefined>) =>
      content === undefined ? undefined : transform(Readable.from([content])));

  return {
    readContent,
    getOriginalFileName: () => "attachment.txt",
    getExtension: () => ".txt",
    getContentType: () => "text/plain",
    getContentLength: vi.fn(() => (options.unknownLength ? undefined : contentLength)),
    asJson: async () => undefined,
    asUtf8String: async () => content?.toString("utf8"),
    asBuffer,
    writeTo: async () => {},
  };
};

beforeEach(async () => {
  await epic("coverage");
  await feature("report-engine");
  await story("safeOutputPath");
  await label("coverage", "report-engine");
});

describe("resolvePathUnderOutputRoot", () => {
  const root = resolve("/tmp/allure-output-test-root");

  it("resolves normal relative paths under root", () => {
    expect(resolvePathUnderOutputRoot(root, "widgets/a.json")).toBe(resolve(root, "widgets/a.json"));
  });

  it("rejects traversal via .. segments", () => {
    expect(() => resolvePathUnderOutputRoot(root, "../outside.txt")).toThrow(UnsafeReportOutputPathError);
  });

  it("rejects NUL in path", () => {
    expect(() => resolvePathUnderOutputRoot(root, "a\0b")).toThrow(UnsafeReportOutputPathError);
  });

  it("rejects absolute paths outside root", () => {
    expect(() => resolvePathUnderOutputRoot(root, "/etc/passwd")).toThrow(UnsafeReportOutputPathError);
  });

  it.skipIf(!isWindows())("rejects Windows absolute paths outside root on win32", () => {
    const winRoot = resolve("C:\\temp\\allure-out");
    expect(() => resolvePathUnderOutputRoot(winRoot, "D:\\other.txt")).toThrow(UnsafeReportOutputPathError);
  });
});

describe("FileSystemReportFiles", () => {
  let outDir: string;

  afterEach(async () => {
    if (outDir) {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("writes under output and refuses path traversal", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    await files.addFile("ok.txt", Buffer.from("hi", "utf8"));
    expect(await readFile(join(outDir, "ok.txt"), "utf8")).toBe("hi");

    await expect(files.addFile("../evil.txt", Buffer.from("x"))).rejects.toThrow(UnsafeReportOutputPathError);
    await expect(files.addFile(join("..", "evil2.txt"), Buffer.from("x"))).rejects.toThrow(UnsafeReportOutputPathError);
  });

  it("rejects traversal from PluginFiles-style paths (pluginId + relative file key)", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const pluginStylePath = joinPosix("awesome", "../../outside.txt");

    await expect(files.addFile(pluginStylePath, Buffer.from("x"))).rejects.toThrow(UnsafeReportOutputPathError);
  });

  // Catches choosing the streaming path at the inclusive buffering boundary.
  it("buffers a file whose effective length is exactly 4 MiB", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const content = Buffer.from("buffered");
    const asBuffer = vi.fn().mockResolvedValue(content);
    const readContent = vi.fn();
    const file = createResultFile(content, FOUR_MIB, { asBuffer, readContent });

    await files.addFileFrom("exact.bin", file);

    expect(asBuffer).toHaveBeenCalledTimes(1);
    expect(readContent).not.toHaveBeenCalled();
    expect(await readFile(join(outDir, "exact.bin"))).toEqual(content);
  });

  // Catches buffering files just above the threshold and thereby defeating path-backed transfer.
  it("streams a file whose effective length is one byte above 4 MiB", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const content = Buffer.from("streamed");
    const asBuffer = vi.fn(() => {
      throw new Error("unexpected buffering");
    });
    const readContent = vi.fn(async <T>(transform: (stream: Readable) => Promise<T | undefined>) =>
      transform(Readable.from([content])),
    );
    const file = createResultFile(content, FOUR_MIB + 1, { asBuffer, readContent });

    await files.addFileFrom("large.bin", file);

    expect(asBuffer).not.toHaveBeenCalled();
    expect(readContent).toHaveBeenCalledTimes(1);
    expect(await readFile(join(outDir, "large.bin"))).toEqual(content);
  });

  // Catches treating unknown metadata as a small file and eagerly materializing its content.
  it("streams a file when its content length is unknown", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const content = Buffer.from("unknown-length");
    const asBuffer = vi.fn(() => {
      throw new Error("unexpected buffering");
    });
    const readContent = vi.fn(async <T>(transform: (stream: Readable) => Promise<T | undefined>) =>
      transform(Readable.from([content])),
    );
    const file = createResultFile(content, content.length, { asBuffer, readContent, unknownLength: true });

    await files.addFileFrom("unknown.bin", file);

    expect(asBuffer).not.toHaveBeenCalled();
    expect(readContent).toHaveBeenCalledTimes(1);
    expect(await readFile(join(outDir, "unknown.bin"))).toEqual(content);
  });

  // Catches ignoring a caller's trusted length and re-reading metadata that selects the wrong transfer path.
  it("uses a supplied known length instead of the result file metadata", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const content = Buffer.from("known-length");
    const asBuffer = vi.fn().mockResolvedValue(content);
    const readContent = vi.fn();
    const file = createResultFile(content, FOUR_MIB + 1, { asBuffer, readContent });

    await files.addFileFrom("known.bin", file, FOUR_MIB);

    expect(asBuffer).toHaveBeenCalledTimes(1);
    expect(readContent).not.toHaveBeenCalled();
    expect(await readFile(join(outDir, "known.bin"))).toEqual(content);
  });

  // Catches renaming a partially written stream over an existing destination or leaking its temporary file.
  it("preserves an existing destination and removes the temporary file after a stream failure", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const targetPath = join(outDir, "attachment.txt");
    await writeFile(targetPath, "existing", "utf8");
    const files = new FileSystemReportFiles(outDir);
    const readContent = async <T>(transform: (stream: Readable) => Promise<T | undefined>) =>
      transform(
        Readable.from(
          (async function* () {
            yield Buffer.from("partial", "utf8");
            throw new Error("stream failed");
          })(),
        ),
      );
    const file = createResultFile(undefined, FOUR_MIB + 1, { readContent });

    await expect(files.addFileFrom("attachment.txt", file)).rejects.toThrow("stream failed");

    expect(await readFile(targetPath, "utf8")).toBe("existing");
    expect(await readdir(outDir)).toEqual(["attachment.txt"]);
  });

  // Catches bypassing the shared output-root guard for path-aware writes.
  it("rejects traversal for path-aware writes", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const file = createResultFile(Buffer.from("unsafe"));

    await expect(files.addFileFrom(joinPosix("..", "evil.txt"), file)).rejects.toThrow(UnsafeReportOutputPathError);
  });

  // Catches treating a missing path-backed source as an empty attachment and creating a destination anyway.
  it("does not create a destination when the source content is missing", async () => {
    outDir = await mkdtemp(join(tmpdir(), "allure-fs-report-"));
    const files = new FileSystemReportFiles(outDir);
    const file = createResultFile(undefined);

    await expect(files.addFileFrom("missing.txt", file)).resolves.toBeUndefined();
    await expect(readFile(join(outDir, "missing.txt"))).rejects.toThrow();
  });
});

describe("PluginFiles", () => {
  // Catches breaking plugins whose parent report-file implementation predates addFileFrom.
  it("falls back to buffering for path-aware writes on legacy parents", async () => {
    const parent = {
      addFile: vi.fn().mockResolvedValue("/report/awesome/data/attachment.txt"),
    } as unknown as ReportFiles;
    const callback = vi.fn();
    const files = new PluginFiles(parent, "awesome", callback);
    const content = Buffer.from("legacy");
    const asBuffer = vi.fn().mockResolvedValue(content);
    const file = createResultFile(content, content.length, { asBuffer });

    const resultPath = await files.addFileFrom("data/attachment.txt", file, content.length);

    expect(asBuffer).toHaveBeenCalledTimes(1);
    expect(parent.addFile).toHaveBeenCalledWith("awesome/data/attachment.txt", content);
    expect(callback).toHaveBeenCalledWith("data/attachment.txt", resultPath);
  });

  // Catches dropping the known-length hint while adapting a plugin path to its parent.
  it("forwards the known length to path-aware parents", async () => {
    const parent = {
      addFile: vi.fn(),
      addFileFrom: vi.fn().mockResolvedValue("/report/awesome/data/attachment.txt"),
    } as unknown as ReportFiles;
    const callback = vi.fn();
    const files = new PluginFiles(parent, "awesome", callback);
    const file = createResultFile(Buffer.from("streamed"), FOUR_MIB + 1);

    const resultPath = await files.addFileFrom("data/attachment.txt", file, FOUR_MIB);

    expect(parent.addFileFrom).toHaveBeenCalledWith("awesome/data/attachment.txt", file, FOUR_MIB);
    expect(callback).toHaveBeenCalledWith("data/attachment.txt", resultPath);
  });

  // Catches invoking a callback or legacy write after the authoritative parent reports missing content.
  it("skips callback and write when a path-aware parent reports missing content", async () => {
    const parent = {
      addFile: vi.fn(),
      addFileFrom: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReportFiles;
    const callback = vi.fn();
    const files = new PluginFiles(parent, "awesome", callback);
    const asBuffer = vi.fn(() => {
      throw new Error("unexpected buffering");
    });
    const file = createResultFile(Buffer.from("missing"), undefined, { asBuffer });

    await expect(files.addFileFrom("data/attachment.txt", file)).resolves.toBeUndefined();

    expect(parent.addFileFrom).toHaveBeenCalledWith("awesome/data/attachment.txt", file, undefined);
    expect(asBuffer).not.toHaveBeenCalled();
    expect(parent.addFile).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("isPathContainedInDir", () => {
  it("does not treat a unrelated prefix as containment (prefix trap)", () => {
    const root = resolve("/tmp/allure-not-prefix");
    expect(isPathContainedInDir(root, resolve("/tmp/allure-not-prefix-evil/file"))).toBe(false);
  });
});
