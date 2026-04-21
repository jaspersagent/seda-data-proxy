import crypto from "node:crypto";
import { Clock, Effect, Layer } from "effect";
import type { ChainlinkStreamsModuleConfig } from "../../config/chainlink-streams-module-config";
import type { Route } from "../../config/config-parser";
import { createErrorResponse } from "../../controllers/create-error-response";
import { replaceParams } from "../../utils/replace-params";
import { FailedToHandleRequest, ModuleService } from "../module";
import { FailedToHandleChainlinkStreamsRequestError } from "./errors";

// Upstream request timeout — mirrors the resilience posture of the Pyth
// Lazer SDK's internal timeouts. Avoids stalling a proxy request forever
// when the Chainlink Data Streams endpoint hangs.
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Generate HMAC authentication headers for Chainlink Data Streams API.
 *
 * The signature is computed as:
 * stringToSign = "${method} ${path} ${bodyHash} ${apiKey} ${timestamp}"
 * signature = HMAC-SHA256(apiSecret, stringToSign)
 *
 * `timestamp` is passed in (rather than read via `Date.now()` here) so the
 * caller can source it from Effect's Clock — matches pyth-lazer's use of
 * `Clock.currentTimeMillis` and keeps the signing step mockable in tests.
 */
function generateHmacAuth(
	apiKey: string,
	apiSecret: string,
	method: string,
	path: string,
	body: string,
	timestamp: string,
): {
	authorization: string;
	timestamp: string;
	signature: string;
} {
	// Hash the body (empty string for GET requests)
	const bodyHash = crypto.createHash("sha256").update(body).digest("hex");

	// Create the string to sign: "METHOD PATH BODYHASH APIKEY TIMESTAMP"
	const stringToSign = `${method} ${path} ${bodyHash} ${apiKey} ${timestamp}`;

	// Generate HMAC-SHA256 signature
	const signature = crypto
		.createHmac("sha256", apiSecret)
		.update(stringToSign)
		.digest("hex");

	return {
		authorization: apiKey,
		timestamp,
		signature,
	};
}

export const ChainlinkStreamsModuleService = (
	config: ChainlinkStreamsModuleConfig,
) =>
	Layer.effect(
		ModuleService,
		Effect.gen(function* () {
			yield* Effect.logInfo("Initializing Chainlink Streams module", {
				name: config.name,
				baseUrl: config.baseUrl,
			});

			const start = () =>
				Effect.gen(function* () {
					yield* Effect.logInfo("Chainlink Streams module started", {
						name: config.name,
					});
				}).pipe(Effect.annotateLogs("_name", "chainlink-streams"));

			const handleRequest = (
				route: Route,
				params: Record<string, string>,
				request: Request,
			) =>
				Effect.gen(function* () {
					if (route.type !== "chainlink-streams") {
						return yield* Effect.fail(
							new FailedToHandleRequest({
								msg: "Route is not a Chainlink Streams module",
							}),
						);
					}

					// Build the upstream path with params replaced
					const upstreamPathBase = replaceParams(route.upstreamPath, params);

					// Get query params from the original request and append to path
					const requestUrl = new URL(request.url);
					const queryString = requestUrl.search; // includes the '?' if present
					const upstreamPath = `${upstreamPathBase}${queryString}`;
					const fullUrl = `${config.baseUrl}${upstreamPath}`;

					// Get request body - clone the request to read the body
					const body =
						request.method === "GET"
							? ""
							: yield* Effect.tryPromise({
									try: () => request.clone().text(),
									catch: () =>
										new FailedToHandleChainlinkStreamsRequestError({
											error: "Failed to read request body",
											status: 400,
										}),
								});

					// Source timestamp from Effect's Clock for testability (parity
					// with pyth-lazer's `Clock.currentTimeMillis` usage).
					const nowMs = yield* Clock.currentTimeMillis;
					const timestamp = nowMs.toString();

					// Generate HMAC authentication
					const auth = generateHmacAuth(
						config.chainlinkKey,
						config.chainlinkApiSecret,
						request.method,
						upstreamPath,
						body,
						timestamp,
					);

					yield* Effect.logDebug("Making Chainlink Streams request", {
						url: fullUrl,
						method: request.method,
						path: upstreamPath,
					});

					// Make the authenticated request with a hard timeout so a
					// hanging upstream can't stall the proxy.
					const response = yield* Effect.tryPromise({
						try: () => {
							const controller = new AbortController();
							const timeoutId = setTimeout(
								() => controller.abort(),
								FETCH_TIMEOUT_MS,
							);
							return fetch(fullUrl, {
								method: request.method,
								headers: {
									"Content-Type": "application/json",
									Accept: "application/json",
									Authorization: auth.authorization,
									"X-Authorization-Timestamp": auth.timestamp,
									"X-Authorization-Signature-SHA256": auth.signature,
								},
								body: body || undefined,
								signal: controller.signal,
							}).finally(() => clearTimeout(timeoutId));
						},
						catch: (error) => {
							const isAbort =
								error instanceof Error && error.name === "AbortError";
							return new FailedToHandleChainlinkStreamsRequestError({
								error: isAbort
									? `Chainlink Streams request timed out after ${FETCH_TIMEOUT_MS}ms`
									: `Failed to fetch from Chainlink: ${error}`,
								status: isAbort ? 504 : 502,
							});
						},
					});

					const responseBody = yield* Effect.tryPromise({
						try: () => response.text(),
						catch: (error) =>
							new FailedToHandleChainlinkStreamsRequestError({
								error: `Failed to read response: ${error}`,
								status: 500,
							}),
					});

					if (!response.ok) {
						yield* Effect.logError("Chainlink Streams request failed", {
							status: response.status,
							body: responseBody,
						});
					}

					// Preserve the upstream Content-Type so error bodies (often
					// text/plain) are not mis-labelled as application/json.
					const upstreamContentType =
						response.headers.get("content-type") ?? "application/json";

					return yield* Effect.succeed(
						new Response(responseBody, {
							status: response.status,
							headers: { "Content-Type": upstreamContentType },
						}),
					);
				}).pipe(
					Effect.withSpan("handleChainlinkStreamsRequest"),
					Effect.catchAll((error) => {
						// Both error branches
						// (`FailedToHandleChainlinkStreamsRequestError`,
						// `FailedToHandleRequest`) carry a `status` field — the
						// latter defaults to 500 on construction. Matches
						// pyth-lazer's `createErrorResponse(error, error.status)`.
						return Effect.succeed(createErrorResponse(error, error.status));
					}),
				);

			return {
				start,
				handleRequest,
			};
		}),
	);
