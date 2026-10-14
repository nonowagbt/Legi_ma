import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Persistence } from "../src/core/knowledge";

/** Enregistre la base locale dans un fichier JSON (écriture atomique). */
export function filePersistence(path: string): Persistence {
  return {
    async load() {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async save(data) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.tmp`, data);
      await rename(`${path}.tmp`, path);
    },
  };
}
