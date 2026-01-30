import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import { SupermemoryClient } from "./client.ts"
import { registerCli } from "./commands/cli.ts"
import { registerCommands } from "./commands/slash.ts"
import { parseConfig, supermemoryConfigSchema } from "./config.ts"
import { buildCaptureHandler } from "./hooks/capture.ts"
import { buildRecallHandler } from "./hooks/recall.ts"
import { initLogger } from "./logger.ts"
import { registerForgetTool } from "./tools/forget.ts"
import { registerProfileTool } from "./tools/profile.ts"
import { registerSearchTool } from "./tools/search.ts"
import { registerStoreTool } from "./tools/store.ts"

export default {
	id: "openclaw-supermemory",
	name: "Supermemory",
	description: "OpenClaw powered by Supermemory plugin",
	kind: "memory" as const,
	configSchema: supermemoryConfigSchema,

	register(api: OpenClawPluginApi) {
		const cfg = parseConfig(api.pluginConfig)

		initLogger(api.logger, cfg.debug)

		const client = new SupermemoryClient(cfg.apiKey, cfg.containerTag)

		let sessionKey: string | undefined
		const getSessionKey = () => sessionKey

		registerSearchTool(api, client, cfg)
		registerStoreTool(api, client, cfg, getSessionKey)
		registerForgetTool(api, client, cfg)
		registerProfileTool(api, client, cfg)

		if (cfg.autoRecall) {
			const recallHandler = buildRecallHandler(client, cfg)
			api.on(
				"before_agent_start",
				(event: Record<string, unknown>, ctx: Record<string, unknown>) => {
					if (ctx.sessionKey) sessionKey = ctx.sessionKey as string
					return recallHandler(event)
				},
			)
		}

		if (cfg.autoCapture) {
			api.on("agent_end", buildCaptureHandler(client, cfg, getSessionKey))
		}

		registerCommands(api, client, cfg, getSessionKey)
		registerCli(api, client, cfg)

		api.registerService({
			id: "openclaw-supermemory",
			start: () => {
				api.logger.info("supermemory: connected")
			},
			stop: () => {
				api.logger.info("supermemory: stopped")
			},
		})
	},
}
