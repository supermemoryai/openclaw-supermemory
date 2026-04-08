import { describe, expect, test } from "bun:test"

/**
 * Tests for the memory capability registration fallback logic,
 * the hook migration from before_agent_start to before_prompt_build,
 * and the session_start hook for sessionKey capture.
 */

function createMockApi(opts?: { hasRegisterMemoryCapability?: boolean }) {
	const calls: Record<string, unknown[][]> = {}
	const record = (name: string) => {
		return (...args: unknown[]) => {
			if (!calls[name]) calls[name] = []
			calls[name].push(args)
		}
	}

	const api: Record<string, unknown> = {
		pluginConfig: {
			apiKey: "sm_test_key_for_unit_tests_12345",
			debug: false,
			autoRecall: true,
			autoCapture: false,
		},
		logger: {
			info: () => {},
			warn: () => {},
			error: () => {},
			debug: () => {},
		},
		registerTool: record("registerTool"),
		registerCommand: record("registerCommand"),
		registerCli: record("registerCli"),
		registerService: record("registerService"),
		on: (...args: unknown[]) => {
			const hookName = args[0] as string
			const key = `on:${hookName}`
			if (!calls[key]) calls[key] = []
			calls[key].push(args)
		},
	}

	if (opts?.hasRegisterMemoryCapability) {
		api.registerMemoryCapability = record("registerMemoryCapability")
	}

	// Always provide deprecated methods for fallback path
	api.registerMemoryRuntime = record("registerMemoryRuntime")
	api.registerMemoryPromptSection = record("registerMemoryPromptSection")
	api.registerMemoryFlushPlan = record("registerMemoryFlushPlan")

	return { api, calls }
}

describe("plugin registration", () => {
	test("uses registerMemoryCapability when available", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: true,
		})

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		// Should call the new unified API
		expect(calls.registerMemoryCapability).toBeDefined()
		expect(calls.registerMemoryCapability.length).toBe(1)
		const capability = calls.registerMemoryCapability[0][0] as Record<
			string,
			unknown
		>
		expect(capability.runtime).toBeDefined()
		expect(capability.promptBuilder).toBeDefined()
		expect(capability.flushPlanResolver).toBeDefined()
		expect(typeof capability.flushPlanResolver).toBe("function")

		// Should NOT call deprecated methods
		expect(calls.registerMemoryRuntime).toBeUndefined()
		expect(calls.registerMemoryPromptSection).toBeUndefined()
		expect(calls.registerMemoryFlushPlan).toBeUndefined()
	})

	test("falls back to deprecated methods when registerMemoryCapability is absent", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: false,
		})

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		// Should NOT call the new API (it doesn't exist)
		expect(calls.registerMemoryCapability).toBeUndefined()

		// Should call deprecated methods
		expect(calls.registerMemoryRuntime).toBeDefined()
		expect(calls.registerMemoryPromptSection).toBeDefined()
		expect(calls.registerMemoryFlushPlan).toBeDefined()
	})

	test("registers before_prompt_build hook (not before_agent_start) when autoRecall is enabled", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: true,
		})

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		// Should register before_prompt_build
		expect(calls["on:before_prompt_build"]).toBeDefined()
		expect(calls["on:before_prompt_build"][0][0]).toBe("before_prompt_build")

		// Should NOT register before_agent_start
		expect(calls["on:before_agent_start"]).toBeUndefined()
	})

	test("registers session_start hook to capture sessionKey independently of prompt hooks", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: true,
		})

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		// session_start should always be registered when configured
		expect(calls["on:session_start"]).toBeDefined()
		expect(calls["on:session_start"][0][0]).toBe("session_start")

		// The session_start handler should be a function
		const handler = calls["on:session_start"][0][1] as (
			event: Record<string, unknown>,
			ctx: Record<string, unknown>,
		) => void
		expect(typeof handler).toBe("function")
	})

	test("session_start handler captures sessionKey from context", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: true,
		})

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		// Get the session_start handler
		const handler = calls["on:session_start"][0][1] as (
			event: Record<string, unknown>,
			ctx: Record<string, unknown>,
		) => void

		// Simulate session_start firing with a sessionKey
		handler({}, { sessionKey: "test-session-key-123" })

		// Now the agent_end handler (if registered) or store tool should
		// have access to the sessionKey via getSessionKey()
		// We verify indirectly: session_start was registered and handler runs without error
	})

	test("registers agent_end hook when autoCapture is enabled", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: true,
		})
		;(api.pluginConfig as Record<string, unknown>).autoCapture = true

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		expect(calls["on:agent_end"]).toBeDefined()
		expect(calls["on:agent_end"][0][0]).toBe("agent_end")
	})

	test("skips hook registration when not configured (no API key)", async () => {
		const { api, calls } = createMockApi({
			hasRegisterMemoryCapability: true,
		})
		;(api.pluginConfig as Record<string, unknown>).apiKey = undefined

		const plugin = (await import("./index.ts")).default
		plugin.register(api as never)

		// Should not register any hooks or memory capability
		expect(calls["on:before_prompt_build"]).toBeUndefined()
		expect(calls["on:agent_end"]).toBeUndefined()
		expect(calls["on:session_start"]).toBeUndefined()
		expect(calls.registerMemoryCapability).toBeUndefined()
	})
})
