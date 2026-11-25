interface WorkSource { hasRunningWork(): boolean }

interface WorkSources {
  runtimeHost: { runtime: WorkSource; backgroundShells: WorkSource } | null;
  residentSupervisor: WorkSource | null;
  taskScheduler: WorkSource | null;
  taskRecipes: WorkSource | null;
  raceHost: WorkSource | null;
}

/** Synchronous quit-time snapshot. Read the current owners before any shutdown/disposal starts. */
export function hasRunningWork({ runtimeHost, residentSupervisor, taskScheduler, taskRecipes, raceHost }: WorkSources): boolean {
  return Boolean(runtimeHost?.runtime.hasRunningWork() || runtimeHost?.backgroundShells.hasRunningWork()
    || residentSupervisor?.hasRunningWork() || taskScheduler?.hasRunningWork()
    || taskRecipes?.hasRunningWork() || raceHost?.hasRunningWork());
}
