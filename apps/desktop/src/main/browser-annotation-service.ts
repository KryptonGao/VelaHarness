import type { BrowserAnnotationCall, BrowserAnnotationService } from '@vela/agent';
import type { BrowserHost, BrowserInvocation } from './browser-host';
import type { AgentAnnotationListing, AgentAnnotationReview } from '../../../../packages/shared/src/browser-annotation';

type AnnotationHost = Pick<BrowserHost, 'agentAnnotations' | 'resolveWindow'>;

/** Agent annotation tools over the shared Browser Host: window routing here, ownership and revocation in the Host. */
export function createBrowserAnnotationService(host: AnnotationHost): BrowserAnnotationService {
  const context = (call: BrowserAnnotationCall): BrowserInvocation => ({
    windowId: host.resolveWindow(call.conversationId),
    conversationId: call.conversationId, agentId: call.agentId, turnId: call.turnId, invocationId: call.invocationId, signal: call.signal,
  });
  return {
    list: async input => await host.agentAnnotations(context(input), { type: 'list', ref: input.ref, screenshot: input.screenshot }) as AgentAnnotationListing,
    resolve: async input => await host.agentAnnotations(context(input), { type: 'resolve', ref: input.ref, summary: input.summary, settleMs: input.settleMs }) as AgentAnnotationReview,
  };
}
