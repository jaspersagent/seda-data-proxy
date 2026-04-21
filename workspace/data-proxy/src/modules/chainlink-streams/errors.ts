import { Data } from "effect";

/**
 * Error raised while handling a Chainlink Data Streams upstream request.
 *
 * Mirrors `FailedToHandlePythLazerRequestError` in `modules/pyth-lazer/errors.ts`:
 * carries an HTTP-style `status` used by `createErrorResponse` in `catchAll`.
 */
export class FailedToHandleChainlinkStreamsRequestError extends Data.TaggedError(
	"FailedToHandleChainlinkStreamsRequestError",
)<{ error: string; status: number }> {
	message = `Chainlink Streams error: ${this.error}`;
}
