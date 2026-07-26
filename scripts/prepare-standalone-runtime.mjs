import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async function copyIfPresent(source, destination) {
  try {
    await stat(source);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  return true;
}

const applications = ["web", "admin"];
const prepared = [];
for (const application of applications) {
  const applicationRoot = resolve("apps", application);
  const runtimeRoot = resolve(applicationRoot, ".next", "standalone", "apps", application);
  const staticCopied = await copyIfPresent(
    resolve(applicationRoot, ".next", "static"),
    resolve(runtimeRoot, ".next", "static"),
  );
  const publicCopied = await copyIfPresent(
    resolve(applicationRoot, "public"),
    resolve(runtimeRoot, "public"),
  );
  if (!staticCopied) {
    throw new Error(`${application} standalone build is missing .next/static`);
  }
  prepared.push({ application, publicCopied, staticCopied });
}

console.log(JSON.stringify({ event: "standalone.runtime.prepared", applications: prepared }));
