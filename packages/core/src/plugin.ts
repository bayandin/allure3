import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { join as joinPosix } from "node:path/posix";
import { pipeline } from "node:stream/promises";

import type { PluginState, ReportFiles, ResultFile } from "@allurereport/plugin-api";

import { resolvePathUnderOutputRoot } from "./utils/safeOutputPath.js";

const MAX_BUFFERED_FILE_SIZE = 4 * 1024 * 1024;

export class DefaultPluginState implements PluginState {
  readonly #state: Record<string, any>;

  constructor(state: Record<string, any>) {
    this.#state = state;
  }

  set = async (key: string, value: any): Promise<void> => {
    this.#state[key] = value;
  };
  get = async <T>(key: string): Promise<T> => {
    return this.#state[key];
  };
  unset = async (key: string): Promise<void> => {
    delete this.#state[key];
  };
}

export class PluginFiles implements ReportFiles {
  readonly #parent: ReportFiles;
  readonly #pluginId: string;

  constructor(
    parent: ReportFiles,
    pluginId: string,
    readonly callback?: (key: string, path: string) => void | Promise<void>,
  ) {
    this.#parent = parent;
    this.#pluginId = pluginId;
  }

  addFile = async (key: string, data: Buffer): Promise<string> => {
    const filepath = await this.#parent.addFile(joinPosix(this.#pluginId, key), data);

    await this.callback?.(key, filepath);

    return filepath;
  };

  addFileFrom = async (key: string, file: ResultFile, knownContentLength?: number): Promise<string | undefined> => {
    const path = joinPosix(this.#pluginId, key);
    let filepath: string | undefined;

    if (this.#parent.addFileFrom) {
      filepath = await this.#parent.addFileFrom(path, file, knownContentLength);
    } else {
      const data = await file.asBuffer();

      if (!data) {
        return undefined;
      }

      filepath = await this.#parent.addFile(path, data);
    }

    if (filepath !== undefined) {
      await this.callback?.(key, filepath);
    }

    return filepath;
  };
}

export class InMemoryReportFiles implements ReportFiles {
  #state: Record<string, Buffer> = {};

  addFile = async (path: string, data: Buffer): Promise<string> => {
    this.#state[path] = data;

    return path;
  };
}

export class FileSystemReportFiles implements ReportFiles {
  readonly #output: string;
  readonly #createdDirs = new Map<string, Promise<string | undefined>>();

  constructor(output: string) {
    this.#output = resolve(output);
  }

  addFile = async (path: string, data: Buffer): Promise<string> => {
    const targetPath = resolvePathUnderOutputRoot(this.#output, path);
    const targetDirPath = dirname(targetPath);

    let createdDir = this.#createdDirs.get(targetDirPath);

    if (!createdDir) {
      createdDir = mkdir(targetDirPath, { recursive: true });
      this.#createdDirs.set(targetDirPath, createdDir);
    }

    await createdDir;
    await writeFile(targetPath, data, { encoding: "utf-8" });

    return targetPath;
  };

  addFileFrom = async (path: string, file: ResultFile, knownContentLength?: number): Promise<string | undefined> => {
    const targetPath = resolvePathUnderOutputRoot(this.#output, path);
    const contentLength = knownContentLength ?? file.getContentLength();

    if (contentLength !== undefined && contentLength <= MAX_BUFFERED_FILE_SIZE) {
      const data = await file.asBuffer();

      if (!data) {
        return undefined;
      }

      return await this.addFile(path, data);
    }

    const targetDirPath = dirname(targetPath);
    const temporaryPath = resolvePathUnderOutputRoot(this.#output, `${path}.${randomUUID()}.tmp`);

    let createdDir = this.#createdDirs.get(targetDirPath);

    if (!createdDir) {
      createdDir = mkdir(targetDirPath, { recursive: true });
      this.#createdDirs.set(targetDirPath, createdDir);
    }

    await createdDir;

    try {
      return await file.readContent(async (stream) => {
        await pipeline(stream, createWriteStream(temporaryPath, { flags: "wx" }));
        await rename(temporaryPath, targetPath);
        return targetPath;
      });
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  };
}
