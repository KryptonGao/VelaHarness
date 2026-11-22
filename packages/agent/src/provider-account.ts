import {
  InMemoryCredentialStore, lazyStream, normalizeContext,
  type AssistantMessage, type AssistantMessageEvent, type Provider, type TranscriptContext,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

function withProvider(message: AssistantMessage, provider: string): AssistantMessage {
  return { ...message, provider, ...(message.deferred && { deferred: { ...message.deferred, provider } }) };
}

async function* accountEvents(events: AsyncIterable<AssistantMessageEvent>, id: string): AsyncGenerator<AssistantMessageEvent> {
  for await (const event of events) {
    if (event.type === "done") yield { ...event, message: withProvider(event.message, id) };
    else if (event.type === "error") yield { ...event, error: withProvider(event.error, id) };
    else yield { ...event, partial: withProvider(event.partial, id) };
  }
}

/** Pi keys credentials and catalog caches by provider ID. Each account needs its own
 * provider object too, as some built-ins keep a key-specific model list in a closure. */
export async function createProviderAccount(builtinId: string, id: string, name: string): Promise<Provider> {
  const templates = await ModelRuntime.create({
    modelsPath: null, credentials: new InMemoryCredentialStore(), refreshOnCreate: false,
  });
  const base = templates.getProvider(builtinId);
  if (!base) throw new Error("找不到这个提供方");

  const apiKey = base.auth.apiKey;
  const wireContext = (context: TranscriptContext) => normalizeContext({
    messages: context.messages.map(message => {
      if (message.role !== "assistant") return message;
      if (message.provider === id) return withProvider(message, builtinId);
      // Messages from the primary account must still be treated as foreign by the transport.
      if (message.provider === builtinId) return withProvider(message, id);
      return message;
    }),
  });
  // The native transport needs its original provider ID (e.g. OpenAI OAuth).
  // Keep the account ID in Vela's catalog, assistant messages and deferred handles.
  return {
    ...base, id, name,
    auth: {
      oauth: base.auth.oauth,
      apiKey: apiKey && {
        ...apiKey,
        resolve: input => input.credential ? apiKey.resolve(input) : Promise.resolve(undefined),
        check: apiKey.check && (input => input.credential ? apiKey.check!(input) : Promise.resolve(undefined)),
      },
    },
    getModels: () => base.getModels().map(model => ({ ...model, provider: id })),
    getAllModels: () => (base.getAllModels?.() ?? base.getModels()).map(model => ({ ...model, provider: id })),
    stream: (model, context, options) => lazyStream(model, async () =>
      accountEvents(base.stream({ ...model, provider: builtinId }, wireContext(context), options), id)),
    streamSimple: (model, context, options) => lazyStream(model, async () =>
      accountEvents(base.streamSimple({ ...model, provider: builtinId }, wireContext(context), options), id)),
    fetchDeferred: base.fetchDeferred && ((model, handle, options) => lazyStream(model, async () =>
      accountEvents(base.fetchDeferred!({ ...model, provider: builtinId }, { ...handle, provider: builtinId }, options), id))),
    cancelDeferred: base.cancelDeferred && ((model, handle, options) =>
      base.cancelDeferred!({ ...model, provider: builtinId }, { ...handle, provider: builtinId }, options)),
    generateImages: base.generateImages && (async (model, context, options) => ({
      ...await base.generateImages!({ ...model, provider: builtinId }, context, options), provider: id,
    })),
    classify: base.classify && (async (model, context, options) => ({
      ...await base.classify!({ ...model, provider: builtinId }, context, options), provider: id,
    })),
  };
}
