import { createAgent, type Agent } from "./agent.js";
import {
  resolveCredential,
  describeCredential,
  applyDotEnvLocal,
  type ResolvedCredential,
} from "./auth.js";
import type { LoadedConfig } from "./config.js";
import { CheckpointStore, runId, type RunState } from "./checkpoint.js";
import { currentRef } from "./git.js";
import { ConfigError } from "./errors.js";
import { logger } from "./logger.js";

export interface StageContext {
  loaded: LoadedConfig;
  credential: ResolvedCredential;
  agent: Agent;
  store: CheckpointStore;
  state: RunState;
}

export async function openRun(loaded: LoadedConfig, bug: string): Promise<StageContext> {
  await applyDotEnvLocal(loaded.root);
  const credential = await resolveCredential(loaded.config.defaultAgent, loaded.root);
  logger.debug(`auth: ${describeCredential(credential)}`);
  const agent = createAgent(credential);

  const head = await currentRef(loaded.root);
  const id = runId(bug, head);
  const store = new CheckpointStore(loaded.dataDir, id);

  let state: RunState;
  if (store.exists()) {
    state = await store.load();
    logger.step("resume", `continuing run ${state.id} from last checkpoint`);
  } else {
    state = { id, bug, createdAt: new Date().toISOString(), backend: loaded.config.defaultAgent };
    await store.save(state);
  }

  return { loaded, credential, agent, store, state };
}

export async function resumeRun(loaded: LoadedConfig, id: string): Promise<StageContext> {
  await applyDotEnvLocal(loaded.root);
  const credential = await resolveCredential(loaded.config.defaultAgent, loaded.root);
  const agent = createAgent(credential);
  const store = new CheckpointStore(loaded.dataDir, id);
  if (!store.exists()) {
    throw new ConfigError(`no run with id ${id}`, 'run "replay run <bug>" first');
  }
  const state = await store.load();
  return { loaded, credential, agent, store, state };
}
