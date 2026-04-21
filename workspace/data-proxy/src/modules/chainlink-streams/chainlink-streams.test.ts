import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import * as v from "valibot";
import { ChainlinkStreamsModuleConfigSchema } from "../../config/chainlink-streams-module-config";
import { FailedToHandleChainlinkStreamsRequestError } from "./errors";

// Reference implementation of the Chainlink Data Streams HMAC signing scheme.
// Spec: https://docs.chain.link/data-streams/reference/data-streams-api/authentication
function referenceGenerateHmacAuth(
	apiKey: string,
	apiSecret: string,
	method: string,
	path: string,
	body: string,
	timestamp: string,
) {
	const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
	const stringToSign = `${method} ${path} ${bodyHash} ${apiKey} ${timestamp}`;
	const signature = crypto
		.createHmac("sha256", apiSecret)
		.update(stringToSign)
		.digest("hex");
	return { authorization: apiKey, timestamp, signature };
}

describe("chainlink-streams HMAC auth", () => {
	it("produces a deterministic SHA256 HMAC for a known GET request", () => {
		const apiKey = "test-api-key-uuid";
		const apiSecret = "test-api-secret";
		const method = "GET";
		const path = "/api/v1/reports/latest?feedID=0xabc";
		const body = "";
		const timestamp = "1700000000000";

		const result = referenceGenerateHmacAuth(
			apiKey,
			apiSecret,
			method,
			path,
			body,
			timestamp,
		);

		expect(result.signature).toMatch(/^[0-9a-f]{64}$/);
		expect(result.authorization).toBe(apiKey);
		expect(result.timestamp).toBe(timestamp);

		const second = referenceGenerateHmacAuth(
			apiKey,
			apiSecret,
			method,
			path,
			body,
			timestamp,
		);
		expect(second.signature).toBe(result.signature);
	});

	it("produces different signatures when the timestamp changes", () => {
		const base = referenceGenerateHmacAuth(
			"k",
			"s",
			"GET",
			"/x",
			"",
			"1700000000000",
		);
		const shifted = referenceGenerateHmacAuth(
			"k",
			"s",
			"GET",
			"/x",
			"",
			"1700000000001",
		);
		expect(base.signature).not.toBe(shifted.signature);
	});

	it("produces different signatures when the path changes", () => {
		const base = referenceGenerateHmacAuth(
			"k",
			"s",
			"GET",
			"/x",
			"",
			"1700000000000",
		);
		const shifted = referenceGenerateHmacAuth(
			"k",
			"s",
			"GET",
			"/y",
			"",
			"1700000000000",
		);
		expect(base.signature).not.toBe(shifted.signature);
	});

	it("hashes the body for POST requests (empty body vs non-empty differs)", () => {
		const empty = referenceGenerateHmacAuth(
			"k",
			"s",
			"POST",
			"/x",
			"",
			"1700000000000",
		);
		const withBody = referenceGenerateHmacAuth(
			"k",
			"s",
			"POST",
			"/x",
			'{"a":1}',
			"1700000000000",
		);
		expect(empty.signature).not.toBe(withBody.signature);
	});
});

describe("chainlink-streams module config schema", () => {
	it("accepts a valid config", () => {
		const input = {
			name: "chainlinkStreams",
			type: "chainlink-streams",
			chainlinkKeyEnvKey: "CHAINLINK_KEY",
			chainlinkApiSecretEnvKey: "CHAINLINK_API_SECRET",
			baseUrl: "https://api.dataengine.chain.link",
		};
		const parsed = v.parse(ChainlinkStreamsModuleConfigSchema, input);
		expect(parsed.name).toBe("chainlinkStreams");
		expect(parsed.chainlinkKeyEnvKey).toBe("CHAINLINK_KEY");
		expect(parsed.chainlinkApiSecretEnvKey).toBe("CHAINLINK_API_SECRET");
		expect(parsed.baseUrl).toBe("https://api.dataengine.chain.link");
	});

	it("rejects a config missing chainlinkKeyEnvKey", () => {
		const input = {
			name: "chainlinkStreams",
			type: "chainlink-streams",
			chainlinkApiSecretEnvKey: "CHAINLINK_API_SECRET",
			baseUrl: "https://api.dataengine.chain.link",
		};
		expect(() => v.parse(ChainlinkStreamsModuleConfigSchema, input)).toThrow();
	});

	it("rejects a config missing chainlinkApiSecretEnvKey", () => {
		const input = {
			name: "chainlinkStreams",
			type: "chainlink-streams",
			chainlinkKeyEnvKey: "CHAINLINK_KEY",
			baseUrl: "https://api.dataengine.chain.link",
		};
		expect(() => v.parse(ChainlinkStreamsModuleConfigSchema, input)).toThrow();
	});

	it("rejects a config missing baseUrl", () => {
		const input = {
			name: "chainlinkStreams",
			type: "chainlink-streams",
			chainlinkKeyEnvKey: "CHAINLINK_KEY",
			chainlinkApiSecretEnvKey: "CHAINLINK_API_SECRET",
		};
		expect(() => v.parse(ChainlinkStreamsModuleConfigSchema, input)).toThrow();
	});
});

describe("FailedToHandleChainlinkStreamsRequestError", () => {
	it("carries status and error, and stringifies with a prefix", () => {
		const err = new FailedToHandleChainlinkStreamsRequestError({
			error: "upstream 502",
			status: 502,
		});
		expect(err._tag).toBe("FailedToHandleChainlinkStreamsRequestError");
		expect(err.error).toBe("upstream 502");
		expect(err.status).toBe(502);
		expect(err.message).toContain("Chainlink Streams error");
	});
});
