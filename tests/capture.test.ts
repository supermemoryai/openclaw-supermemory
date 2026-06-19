import { describe, expect, it } from "bun:test"
import type { SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import {
	buildCaptureHandler,
	isSupermemoryManagementTurn,
} from "../hooks/capture.ts"

const cfg: SupermemoryConfig = {
	apiKey: undefined,
	containerTag: "test_container",
	autoRecall: true,
	autoCapture: true,
	maxRecallResults: 10,
	profileFrequency: 50,
	captureMode: "all",
	entityContext: "test context",
	debug: false,
	enableCustomContainerTags: false,
	customContainers: [],
	customContainerInstructions: "",
}

type CaptureArgs = [
	content: string,
	metadata?: Record<string, string | number | boolean>,
	customId?: string,
	containerTag?: string,
	entityContext?: string,
]

type CaptureClient = Pick<SupermemoryClient, "addMemory">

describe("capture hook", () => {
	it("detects turns that manage supermemory directly", () => {
		const turn = [
			{ role: "user", content: "Please forget this memory." },
			{
				role: "assistant",
				content: [
					{
						type: "tool_call",
						name: "supermemory_forget",
						arguments: { query: "foo" },
					},
				],
			},
			{ role: "assistant", content: 'Forgot: "foo"' },
		]

		expect(isSupermemoryManagementTurn(turn)).toBe(true)
	})

	it("skips capturing turns that used supermemory tools", async () => {
		const calls: CaptureArgs[] = []
		const client: CaptureClient = {
			addMemory: async (...args) => {
				calls.push(args)
				return { id: "memory_1" }
			},
		}
		const handler = buildCaptureHandler(
			client as unknown as SupermemoryClient,
			cfg,
			() => "session-123",
		)

		await handler(
			{
				success: true,
				messages: [
					{ role: "user", content: "Please forget this memory." },
					{
						role: "assistant",
						content: [
							{
								type: "tool_call",
								name: "supermemory_forget",
								arguments: { query: "foo" },
							},
						],
					},
					{ role: "assistant", content: 'Forgot: "foo"' },
				],
			},
			{ messageProvider: "discord" },
		)

		expect(calls.length).toBe(0)
	})

	it("still captures normal conversational turns", async () => {
		const calls: CaptureArgs[] = []
		const client: CaptureClient = {
			addMemory: async (...args) => {
				calls.push(args)
				return { id: "memory_1" }
			},
		}
		const handler = buildCaptureHandler(
			client as unknown as SupermemoryClient,
			cfg,
			() => "session-123",
		)

		await handler(
			{
				success: true,
				messages: [
					{ role: "user", content: "My favorite editor is Helix." },
					{ role: "assistant", content: "Got it." },
				],
			},
			{ messageProvider: "discord" },
		)

		expect(calls.length).toBe(1)
		const [content, metadata, customId] = calls[0]
		expect(content).toContain("My favorite editor is Helix.")
		expect(content).toContain("Got it.")
		expect(metadata).toEqual(expect.objectContaining({ source: "openclaw" }))
		expect(customId).toBe("session_session_123")
	})
})
