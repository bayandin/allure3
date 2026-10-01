import { ReadStream, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { epic, feature, label, story } from "allure-js-commons";
import { extension } from "mime-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BufferResultFile, PathResultFile } from "../src/index.js";
import { buildResourcePath, readResource, resources } from "./utils.js";

const originalExistsSync = vi.hoisted(() => ({
  value: undefined as typeof existsSync | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  originalExistsSync.value = original.existsSync;

  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
  };
});

class VirtualContentPathResultFile extends PathResultFile {
  constructor(
    path: string,
    private readonly content: Uint8Array,
  ) {
    super(path);
  }

  protected override getContent(): ReadStream {
    return ReadStream.from(this.content) as ReadStream;
  }
}

beforeEach(async () => {
  await epic("coverage");
  await feature("reading");
  await story("resultFile");
  await label("coverage", "reading");
});

afterEach(() => {
  vi.mocked(existsSync).mockImplementation(originalExistsSync.value!);
});

describe("BufferResultFile", () => {
  it.each(resources)("should detect type %s as %s by magic header", async (resource, expectedType) => {
    const buffer = await readResource(resource);
    const resultFile = new BufferResultFile(buffer, "without-extension");

    const result = resultFile.getContentType();
    expect(result).toEqual(expectedType);
  });

  it.each(resources)("should detect type %s as %s by file extension with higher priority", async (resource) => {
    const buffer = await readResource(resource);
    const resultFile = new BufferResultFile(buffer, "with-extension.mp4");

    const result = resultFile.getContentType();
    expect(result).toEqual("video/mp4");
  });

  it.each(resources)(
    "should return extension according to detected type %s as %s by magic header",
    async (resource, expectedType) => {
      const buffer = await readResource(resource);
      const resultFile = new BufferResultFile(buffer, "without-extension");

      const result = resultFile.getExtension();
      expect(result).toEqual(`.${extension(expectedType)}`);
    },
  );

  it.each(resources)("should preserve extension ignoring detected type %s as %s by magic header", async (resource) => {
    const buffer = await readResource(resource);
    const resultFile = new BufferResultFile(buffer, "with-extension.mp4");

    const result = resultFile.getExtension();
    expect(result).toEqual(".mp4");
  });

  it("should return the same bytes when read as buffer", async () => {
    const inputBuffer = await readResource("sample.png");
    const resultFile = new BufferResultFile(inputBuffer, "sample.png");

    const outputBuffer = await resultFile.asBuffer();

    expect(outputBuffer?.equals(inputBuffer)).toBeTruthy();
  });
});

describe("PathResultFile", () => {
  it("should parse path-backed JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "allure-reader-api-result-file-"));
    const path = join(directory, "result.json");
    await writeFile(path, '{"status":"passed","steps":[{"name":"step"}]}', "utf8");

    try {
      const resultFile = new PathResultFile(path);
      const readContent = vi.spyOn(resultFile, "readContent");

      await expect(resultFile.asJson()).resolves.toEqual({ status: "passed", steps: [{ name: "step" }] });
      expect(readContent).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should return undefined for a missing path-backed JSON file", async () => {
    const resultFile = new PathResultFile(buildResourcePath("missing.json"));

    await expect(resultFile.asJson()).resolves.toBeUndefined();
  });

  it("should reject when path-backed JSON is malformed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "allure-reader-api-result-file-"));
    const path = join(directory, "malformed.json");
    await writeFile(path, "{ malformed", "utf8");

    try {
      const resultFile = new PathResultFile(path);

      await expect(resultFile.asJson()).rejects.toThrow(SyntaxError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should read a path result file as a buffer", async () => {
    const path = buildResourcePath("sample.png");
    const resultFile = new PathResultFile(path, "sample.png");
    const readContent = vi.spyOn(resultFile, "readContent");

    const outputBuffer = await resultFile.asBuffer();

    expect(outputBuffer?.equals(await readResource("sample.png"))).toBeTruthy();
    expect(readContent).not.toHaveBeenCalled();
  });

  it("should return undefined for a missing path result file", async () => {
    const resultFile = new PathResultFile(buildResourcePath("missing.txt"));

    await expect(resultFile.asBuffer()).resolves.toBeUndefined();
  });

  it("should read an existing exact path even when existsSync reports it missing", async () => {
    const path = buildResourcePath("sample.png");
    const resultFile = new PathResultFile(path, "sample.png");
    vi.mocked(existsSync).mockReturnValue(false);

    const outputBuffer = await resultFile.asBuffer();

    expect(outputBuffer?.equals(await readResource("sample.png"))).toBe(true);
  });

  it("should parse existing exact JSON even when existsSync reports it missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "allure-reader-api-result-file-"));
    const path = join(directory, "result.json");
    await writeFile(path, '{"status":"passed"}', "utf8");
    vi.mocked(existsSync).mockReturnValue(false);

    try {
      await expect(new PathResultFile(path).asJson()).resolves.toEqual({ status: "passed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should parse JSON from custom content when the path is missing", async () => {
    const resultFile = new VirtualContentPathResultFile(
      buildResourcePath("missing.json"),
      Buffer.from('{"status":"passed"}'),
    );

    await expect(resultFile.asJson()).resolves.toEqual({ status: "passed" });
  });

  it("should read custom content as a buffer when the path is missing", async () => {
    const content = Buffer.from("virtual content");
    const resultFile = new VirtualContentPathResultFile(buildResourcePath("missing.txt"), content);

    await expect(resultFile.asBuffer()).resolves.toEqual(content);
  });

  it.each(resources)("should detect type %s as %s by magic header", async (resource, expectedType) => {
    const path = buildResourcePath(resource);
    const resultFile = new PathResultFile(path, "without-extension");

    const result = resultFile.getContentType();
    expect(result).toEqual(expectedType);
  });

  it.each(resources)("should detect type %s as %s by file extension with higher priority", async (resource) => {
    const path = buildResourcePath(resource);
    const resultFile = new PathResultFile(path, "with-extension.mp4");

    const result = resultFile.getContentType();
    expect(result).toEqual("video/mp4");
  });

  it.each(resources)(
    "should return extension according to detected type %s as %s by magic header",
    async (resource, expectedType) => {
      const path = buildResourcePath(resource);
      const resultFile = new PathResultFile(path, "without-extension");

      const result = resultFile.getExtension();
      expect(result).toEqual(`.${extension(expectedType)}`);
    },
  );

  it.each(resources)("should preserve extension ignoring detected type %s as %s by magic header", async (resource) => {
    const path = buildResourcePath(resource);
    const resultFile = new PathResultFile(path, "with-extension.mp4");

    const result = resultFile.getExtension();
    expect(result).toEqual(".mp4");
  });
});
