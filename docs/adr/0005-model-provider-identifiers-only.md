# Model providers carry identifiers only; credentials stay local

Inngest persists event payloads and step results, so only identifiers cross it. ChatGPT credentials live on the local machine behind a filesystem lock, and each provider adapter derives from one SDK-independent tool contract. These rules were code comments.

## Decisions

- `src/features/chatgpt/lib/local-account.ts` (`const host = request.headers.get("host");`): Next's dev server can normalize 127.0.0.1 to localhost in request.url.
- `src/features/chatgpt/lib/local-account.ts` (`async function locked<T>(`): A filesystem lock also serializes rotating refresh tokens across Next workers.
- `src/features/chatgpt/lib/local-account.ts` (`export async function getChatGPTCallbackRedirect(request: Request) {`): Return to the initiating host so its Clerk session can bind account linking.
- `src/features/chatgpt/lib/local-account.ts` (`const consumed = '${pendingPath(state)}.${randomUUID()}.used';`): Rename atomically so a callback can only be consumed once across workers.
- `src/features/chatgpt/lib/local-account.ts` (`const MODEL_CACHE_MS = 60_000;`): Keyed on the connection so a disconnect or reconnect never reuses a catalog. Failures are not stored, which keeps "Retry loading models" a fresh request.
- `src/features/chatgpt/lib/local-account.ts` (`async function connectionIdForModel(userId: string, model: string) {`): Validates outside the lock because listModels acquires it for credentials.
- `src/features/chatgpt/lib/local-account.ts` (`if (validatedConnectionId && account.connectionId !== validatedConnect`): A reconnect or disconnect during validation invalidates the catalog check.
- `src/features/chatgpt/lib/local-account.ts` (`export async function getChatGPTReviewSelection(`): A review explicitly chooses its provider independently of the coding preference.
- `src/features/chatgpt/lib/local-account.ts` (`await save(accountPath(userId), {`): Retain registration identity and host ID for a later sign-in, clear all tokens.
- `src/features/chatgpt/lib/responses.ts` (`export function functionDefinition(`): Non-strict: schemas Zod emits are not guaranteed to satisfy strict mode.
- `src/features/chatgpt/lib/responses.ts` (`if (error instanceof OpenAI.APIError)`): SDK errors can carry request metadata. Return only a user-facing reason.
- `src/features/chatgpt/lib/tool-loop.ts` (`export class ToolInputError extends Error {}`): Arguments the model can correct; the loop reports it back instead of failing the run.
- `src/features/chatgpt/lib/tool-loop.ts` (`export async function runToolLoop<Value = unknown>({`): Runs a ChatGPT Responses tool loop. Native output items, including encrypted reasoning, are replayed across turns. Investigation ends when the model stops calling tools, the budget leaves no room for another turn, or `maxTurns` is reached. A text finish forces a tool-free answer on the last turn; a structured finish makes a final call that must return `finish.name`, whose parsed arguments are `value` (undefined when malformed).
- `src/features/chatgpt/lib/tool-loop.ts` (`runStep(name, async () => {`): Resolve credentials inside the step, never as serialized step output.
- `src/features/chatgpt/lib/tool-loop.ts` (`input.push(...(response.output as ResponseInput));`): Responses output is valid replay input, even after JSON serialization.
- `src/features/chatgpt/lib/tool-loop.ts` (`budget?.record(response, []);`): Invalid structured responses still consume provider budget. Never retry transport or stream errors: they escape from infer above.
- `src/features/chatgpt/lib/types.ts` (`export interface ChatGPTSelection {`): Only identifiers travel through Inngest; credentials stay on this machine.
- `src/features/model-provider/model-provider.ts` (`export type ModelProvider =`): Which Model provider a run uses. Only identifiers, so it can travel in Inngest events; credentials stay on this machine. OpenRouter model ids are persisted with the conversation or Review, so they are not repeated here.
- `src/features/model-provider/model-provider.ts` (`export async function resolveModelProvider(`): Resolves the Model provider for a request, or the 400 to return. A Review passes its chosen model id; a conversation turn follows the owner's ChatGPT preference.
- `src/features/reviews/components/reviews-workspace.tsx` (`const model = [`): The selection can outlive its provider, such as after ChatGPT disconnects.
- `src/features/reviews/components/reviews-workspace.tsx` (`window.addEventListener("focus", refresh);`): OAuth can return in another tab; refresh access when this workspace regains focus.
- `src/features/reviews/inngest/review-pull-request.ts` (`provider?: ModelProvider;`): Absent on events queued before Model providers; those use OpenRouter.
- `src/features/reviews/lib/review-tools.ts` (`export type ReviewToolCall = { callId: string; signal: AbortSignal };`): SDK-independent contract for read-only review tools. Provider adapters (AI SDK, ChatGPT Responses) derive their definitions from these fields and dispatch calls through `execute`, which validates arguments first.
- `src/lib/github.ts` (`export const createUserOctokit = async (userId: string) => {`): Builds an Octokit for the user inside an Inngest step. Call it in each step that needs GitHub and never return the token: event payloads and step results are persisted by Inngest.
- `src/features/chatgpt/components/chatgpt-provider.tsx`: Keep the form mounted while the browser performs its native submission.
