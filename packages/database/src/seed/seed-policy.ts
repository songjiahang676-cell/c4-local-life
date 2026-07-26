const allowedEnvironments = new Set(["local", "test", "dev", "preview"]);

export function assertSyntheticSeedAllowed(applicationEnvironment: string): void {
  if (!allowedEnvironments.has(applicationEnvironment)) {
    throw new Error(`Synthetic seed is disabled in APP_ENV=${applicationEnvironment}`);
  }
}
