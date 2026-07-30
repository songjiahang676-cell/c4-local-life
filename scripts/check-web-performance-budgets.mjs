import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const chunkRoot = join(repositoryRoot, "apps", "web", ".next", "static", "chunks");
const maximumLargestChunkGzipBytes = 100_000;
const maximumAllChunksGzipBytes = 500_000;

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return javascriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    }),
  );
  return files.flat();
}

let files;
try {
  files = await javascriptFiles(chunkRoot);
} catch {
  throw new Error("Web performance budgets require a completed apps/web production build");
}
if (files.length === 0) {
  throw new Error("Web production build emitted no JavaScript chunks");
}

const chunks = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(file);
    return {
      file: relative(chunkRoot, file).replaceAll("\\", "/"),
      gzipBytes: gzipSync(source, { level: 9 }).byteLength,
    };
  }),
);
chunks.sort((left, right) => right.gzipBytes - left.gzipBytes);
const totalGzipBytes = chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0);
const largest = chunks[0];

if (!largest) throw new Error("Web production build emitted no measurable JavaScript chunks");
if (largest.gzipBytes > maximumLargestChunkGzipBytes) {
  throw new Error(
    `Largest Web JavaScript chunk ${largest.file} is ${largest.gzipBytes} gzip bytes; budget is ${maximumLargestChunkGzipBytes}`,
  );
}
if (totalGzipBytes > maximumAllChunksGzipBytes) {
  throw new Error(
    `All Web JavaScript chunks total ${totalGzipBytes} gzip bytes; budget is ${maximumAllChunksGzipBytes}`,
  );
}

console.log(
  `Web performance budgets passed: ${chunks.length} chunks, largest ${largest.gzipBytes}/${maximumLargestChunkGzipBytes} gzip bytes, total ${totalGzipBytes}/${maximumAllChunksGzipBytes}.`,
);
