import { describe, expect, it, mock } from "bun:test"
import { parseConfig } from "./config.ts"
import { buildCaptureHandler } from "./hooks/capture.ts"
import { buildRecallHandler } from "./hooks/recall.ts"

describe("allowedAgents config", () => {
	it("parses allowedAgents from config", () => {
		const cfg = parseConfig({
			apiKey: "test-key",
			allowedAgents: ["navi", "heimerdinger"],
		})

		expect(cfg.allowedAgents).toEqual(["navi", "heimerdinger"])
	})

	it("skips capture when sessionKey does not match allowedAgents", async () => {
		const addMemory = mock(async () => undefined)
		const handler = buildCaptureHandler(
			{ addMemory } as never,
			parseConfig({ apiKey: "test-key", allowedAgents: ["navi"] }),
			() => "agent:heimerdinger:main",
		)

		await handler(
			{
				success: true,
				messages: [{ role: "user", content: "hello" }],
			},
			{ messageProvider: "discord", sessionKey: "agent:heimerdinger:main" },
		)

		expect(addMemory).not.toHaveBeenCalled()
	})

	it("skips recall when sessionKey does not match allowedAgents", async () => {
		const getProfile = mock(async () => ({
			static: ["persistent fact"],
			dynamic: [],
			searchResults: [],
		}))
		const handler = buildRecallHandler(
			{ getProfile } as never,
			parseConfig({ apiKey: "test-key", allowedAgents: ["navi"] }),
		)

		const result = await handler(
			{
				prompt: "Tell me what you remember about me",
				messages: [{ role: "user", content: "hello" }],
			},
			{ messageProvider: "discord", sessionKey: "agent:heimerdinger:main" },
		)

		expect(result).toBeUndefined()
		expect(getProfile).not.toHaveBeenCalled()
	})
})
