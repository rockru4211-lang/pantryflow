// A revision is acknowledged only after the corresponding read was applied.
// A blocked/failed read stays pending, including after reconnecting.
export function createCountAutoSync(options: {
  enabled: () => boolean;
  canApply: () => boolean;
  readRevision: () => Promise<string>;
  refresh: () => Promise<boolean>;
  pending: (value: boolean) => void;
  unavailable: (value: boolean) => void;
}) {
  let revision: string | undefined;
  let running = false;
  let disposed = false;
  return {
    async check() {
      if (disposed || running || !options.enabled()) return;
      running = true;
      try {
        const next = await options.readRevision();
        if (disposed || !options.enabled()) return;
        if (next === revision) { options.pending(false); options.unavailable(false); return; }
        if (!options.canApply()) { options.pending(true); return; }
        if (await options.refresh()) {
          if (disposed) return;
          revision = next;
          options.pending(false);
          options.unavailable(false);
        }
      } catch {
        if (!disposed) options.unavailable(true);
      } finally { running = false; }
    },
    dispose() { disposed = true; },
  };
}
