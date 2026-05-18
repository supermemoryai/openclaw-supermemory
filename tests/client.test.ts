import { describe, expect, it } from "bun:test"
import type { SearchResult } from "../client.ts"
import { SupermemoryClient } from "../client.ts"

const API_KEY = "sm_12345678901234567890"

describe("SupermemoryClient", () => {
	it("ranks exact literal matches ahead of higher-similarity fuzzy matches", async () => {
		const query = "OPENCLAW_SUPERMEMORY_HEALTHCHECK_2026-03-14_1459"
		const client = new SupermemoryClient(API_KEY, "test_container")

		Reflect.set(client as object, "client", {
			search: {
				memories: async () => ({
					results: [
						{
							id: "allowlist",
							memory: "openclaw-supermemory allowlist note",
							similarity: 0.97,
							metadata: null,
						},
						{
							id: "exact",
							memory: query,
							similarity: 0.25,
							metadata: null,
						},
					],
				}),
			},
		})

		const results = await client.search(query)

		expect(results[0]?.id).toBe("exact")
	})

	it("prefers an exact textual match when forgetting by query", async () => {
		const query = "OPENCLAW_SUPERMEMORY_HEALTHCHECK_2026-03-14_1459"
		const client = new SupermemoryClient(API_KEY, "test_container")
		const deletedIds: string[] = []

		Reflect.set(
			client as object,
			"search",
			async (): Promise<SearchResult[]> => [
				{
					id: "allowlist",
					content: "openclaw-supermemory allowlist note",
					similarity: 0.99,
				},
				{
					id: "exact",
					content: query,
					similarity: 0.21,
				},
			],
		)
		Reflect.set(client as object, "deleteMemory", async (id: string) => {
			deletedIds.push(id)
			return { id, forgotten: true }
		})

		const result = await client.forgetByQuery(query)

		expect(deletedIds).toEqual(["exact"])
		expect(result).toEqual({ success: true, message: `Forgot: "${query}"` })
	})

	it("does not claim success when the delete result cannot be confirmed", async () => {
		const query = "OPENCLAW_SUPERMEMORY_HEALTHCHECK_2026-03-14_1459"
		const client = new SupermemoryClient(API_KEY, "test_container")

		Reflect.set(
			client as object,
			"search",
			async (): Promise<SearchResult[]> => [
				{
					id: "exact",
					content: query,
					similarity: 0.42,
				},
			],
		)
		Reflect.set(client as object, "deleteMemory", async (id: string) => ({
			id,
			forgotten: false,
		}))

		const result = await client.forgetByQuery(query)

		expect(result.success).toBe(false)
		expect(result.message).toContain("Unable to confirm forgetting")
	})
})
