import { Effect } from "effect";
import * as v from "valibot";
import { RouteSchema } from "./route-config";

// Module config for chainlink-streams in the "modules" array.
//
// Naming mirrors pyth-lazer: env-var keys are required, resolved secret
// values land on the runtime interface. `baseUrl` is ALSO required — unlike
// an SDK-managed upstream (pyth), Chainlink exposes both testnet and
// mainnet endpoints and picking the wrong one silently is a production
// footgun. Fail loud if it's not configured.
export const ChainlinkStreamsModuleConfigSchema = v.strictObject({
	name: v.string(),
	type: v.literal("chainlink-streams"),
	chainlinkKeyEnvKey: v.string(),
	chainlinkApiSecretEnvKey: v.string(),
	baseUrl: v.string(),
});

export interface ChainlinkStreamsModuleConfig
	extends v.InferOutput<typeof ChainlinkStreamsModuleConfigSchema> {
	chainlinkKey: string;
	chainlinkApiSecret: string;
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
