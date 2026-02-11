import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import { SupermemoryClient } from "./client.ts"
import { ClientManager } from "./client-manager.ts"
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

		const globalClient = new SupermemoryClient(cfg.apiKey, cfg.containerTag)
		const clientManager = new ClientManager(globalClient, cfg)

		// Helpers to track current agent context for tools and commands
		let currentAgentId: string | undefined
		let sessionKey: string | undefined
		const getSessionKey = () => sessionKey
		const getClient = () => clientManager.getClient(currentAgentId)

		registerSearchTool(api, getClient, cfg)
		registerStoreTool(api, getClient, cfg, getSessionKey)
		registerForgetTool(api, getClient, cfg)
		registerProfileTool(api, getClient, cfg)

		if (cfg.autoRecall) {
			api.on(
				"before_agent_start",
				(event: Record<string, unknown>, ctx: Record<string, unknown>) => {
					if (ctx.agentId) currentAgentId = ctx.agentId as string
					if (ctx.sessionKey) sessionKey = ctx.sessionKey as string
					const client = clientManager.getClient(currentAgentId)
					return buildRecallHandler(client, cfg)(event)
				},
			)
		}

		if (cfg.autoCapture) {
			api.on(
				"agent_end",
				(event: Record<string, unknown>, ctx: Record<string, unknown>) => {
					if (ctx.agentId) currentAgentId = ctx.agentId as string
					if (ctx.sessionKey) sessionKey = ctx.sessionKey as string
					const client = clientManager.getClient(currentAgentId)
					return buildCaptureHandler(client, cfg, getSessionKey)(event)
				},
			)
		}

		// Commands and CLI use the global client (no agent context in CLI)
		registerCommands(api, globalClient, cfg, getSessionKey)
		registerCli(api, globalClient, cfg)

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
