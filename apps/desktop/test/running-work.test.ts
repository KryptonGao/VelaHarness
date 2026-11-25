import assert from "node:assert/strict";
import { it } from "node:test";
import { hasRunningWork } from "../src/main/running-work.ts";

it("accepts uninitialized owners and checks each independent source at the moment of quit", () => {
  assert.equal(hasRunningWork({ runtimeHost: null, residentSupervisor: null, taskScheduler: null, taskRecipes: null, raceHost: null }), false);
  let active = "";
  const source = (name: string) => ({ hasRunningWork: () => active === name });
  const owners = {
    runtimeHost: { runtime: source("chat"), backgroundShells: source("shell") }, residentSupervisor: source("resident"),
    taskScheduler: source("schedule"), taskRecipes: source("recipe"), raceHost: source("race"),
  };
  for (const name of ["chat", "shell", "resident", "schedule", "recipe", "race"]) {
    active = name;
    assert.equal(hasRunningWork(owners), true, name);
    active = "";
    assert.equal(hasRunningWork(owners), false);
  }
});
