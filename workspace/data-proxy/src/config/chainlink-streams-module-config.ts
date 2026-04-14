import { Effect } from "effect";
import * as v from "valibot";
import { RouteSchema } from "./route-config";

// Module config for chainlink-streams in the "modules" array
export const ChainlinkStreamsModuleConfigSchema = v.strictObject({
	name: v.string(),
	type: v.literal("chainlink-streams"),
	apiKeyEnvKey: v.optional(v.string(), "CHAINLINK_STREAMS_API_KEY"),
	apiSecretEnvKey: v.optional(v.string(), "CHAINLINK_STREAMS_API_SECRET"),
	baseUrl: v.optional(
		v.string(),
		"https://api.testnet-dataengine.chain.link",
	),
});

export interface ChainlinkStreamsModuleConfig
	extends v.InferOutput<typeof ChainlinkStreamsModuleConfigSchema> {
	apiKey: string;
	apiSecret: string;
}

// Route config for chainlink-streams routes
export const ChainlinkStreamsModuleRouteSchema = v.strictObject({
	...RouteSchema.entries,
	type: v.literal("chainlink-streams"),
	moduleName: v.string(),
	// The upstream path to append to the base URL, supports {:param} syntax
	upstreamPath: v.string(),
});

export type ChainlinkStreamsModuleRoute = v.InferOutput<
	typeof ChainlinkStreamsModuleRouteSchema
>;

export const validateChainlinkStreamsModuleRoute = (
	route: ChainlinkStreamsModuleRoute,
) =>
	Effect.gen(function* () {
		// all is ok for now
		return yield* Effect.void;
	});
