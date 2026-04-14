import crypto from "node:crypto";
import { Data, Effect, Layer } from "effect";
import type { Route } from "../../config/config-parser";
import type { ChainlinkStreamsModuleConfig } from "../../config/chainlink-streams-module-config";
import { createErrorResponse } from "../../controllers/create-error-response";
import { replaceParams } from "../../utils/replace-params";
import { FailedToHandleRequest, ModuleService } from "../module";

export class ChainlinkStreamsError extends Data.TaggedError(
	"ChainlinkStreamsError",
)<{ error: string; status: number }> {
	message = `Chainlink Streams error: ${this.error}`;
}

/**
 * Generate HMAC authentication headers for Chainlink Data Streams API.
 *
 * The signature is computed as:
 * stringToSign = "${method} ${path} ${bodyHash} ${apiKey} ${timestamp}"
 * signature = HMAC-SHA256(apiSecret, stringToSign)
 */
function generateHmacAuth(
	apiKey: string,
	apiSecret: string,
	method: string,
	path: string,
	body: string,
): {
	authorization: string;
	timestamp: string;
	signature: string;
} {
	const timestamp = Date.now().toString();

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
								msg: "Route is not a Chainlink Streams module route",
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
					const body = request.method === "GET" ? "" : yield* Effect.tryPromise({
						try: () => request.clone().text(),
						catch: () => new ChainlinkStreamsError({ error: "Failed to read request body", status: 400 }),
					});

					// Generate HMAC authentication
					const auth = generateHmacAuth(
						config.apiKey,
						config.apiSecret,
						request.method,
						upstreamPath,
						body,
					);

					yield* Effect.logDebug("Making Chainlink Streams request", {
						url: fullUrl,
						method: request.method,
						path: upstreamPath,
					});

					// Make the authenticated request
					const response = yield* Effect.tryPromise({
						try: () =>
							fetch(fullUrl, {
								method: request.method,
								headers: {
									"Content-Type": "application/json",
									Accept: "application/json",
									Authorization: auth.authorization,
									"X-Authorization-Timestamp": auth.timestamp,
									"X-Authorization-Signature-SHA256": auth.signature,
								},
								body: body || undefined,
							}),
						catch: (error) =>
							new ChainlinkStreamsError({
								error: `Failed to fetch from Chainlink: ${error}`,
								status: 502,
							}),
					});

					const responseBody = yield* Effect.tryPromise({
						try: () => response.text(),
						catch: (error) =>
							new ChainlinkStreamsError({
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

					return yield* Effect.succeed(
						new Response(responseBody, {
							status: response.status,
							headers: { "Content-Type": "application/json" },
						}),
					);
				}).pipe(
					Effect.withSpan("handleChainlinkStreamsRequest"),
					Effect.catchAll((error) => {
						return Effect.succeed(
							createErrorResponse(error, (error as any).status ?? 500),
						);
					}),
				);

			return {
				start,
				handleRequest,
			};
		}),
	);
