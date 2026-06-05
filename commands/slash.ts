import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import type { SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"
import { buildDocumentId, detectCategory } from "../memory.ts"

function maskApiKey(apiKey: string | undefined): string {
	if (!apiKey) return "not configured"
	if (apiKey.length <= 12) return "configured"
	return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
}

function formatSupermemoryStatus(
	cfg: SupermemoryConfig,
	authenticated: boolean,
): string {
	const apiKeySource =
		cfg.apiKey && process.env.SUPERMEMORY_OPENCLAW_API_KEY === cfg.apiKey
			? "environment"
			: "plugin config"
	const customContainerState = cfg.enableCustomContainerTags
		? "enabled"
		: "disabled"
	const lines = [
		"Supermemory Status",
		"",
		`Authenticated: ${authenticated ? "yes" : "no"}`,
		`API key: ${maskApiKey(cfg.apiKey)}${cfg.apiKey ? ` (${apiKeySource})` : ""}`,
		`Container tag: ${cfg.containerTag}`,
		`Auto-recall: ${cfg.autoRecall}`,
		`Auto-capture: ${cfg.autoCapture}`,
		`Max recall results: ${cfg.maxRecallResults}`,
		`Profile frequency: ${cfg.profileFrequency}`,
		`Capture mode: ${cfg.captureMode}`,
		`Memory usage display: ${cfg.showMemoryUsage}`,
		`Custom container tags: ${customContainerState}`,
		`Custom container count: ${cfg.customContainers.length}`,
	]

	if (!authenticated) {
		lines.push("", "Run `openclaw supermemory setup` to connect Supermemory.")
	}

	return lines.join("\n")
}

export function registerStubCommands(
	api: OpenClawPluginApi,
	cfg: SupermemoryConfig,
): void {
	api.registerCommand({
		name: "supermemory-status",
		description: "Show Supermemory configuration status",
		acceptsArgs: false,
		requireAuth: false,
		handler: async () => {
			return { text: formatSupermemoryStatus(cfg, false) }
		},
	})

	api.registerCommand({
		name: "remember",
		description: "Save something to memory",
		acceptsArgs: true,
		requireAuth: true,
		handler: async () => {
			return {
				text: "Supermemory not configured. Run 'openclaw supermemory setup' first.",
			}
		},
	})

	api.registerCommand({
		name: "recall",
		description: "Search your memories",
		acceptsArgs: true,
		requireAuth: true,
		handler: async () => {
			return {
				text: "Supermemory not configured. Run 'openclaw supermemory setup' first.",
			}
		},
	})
}

export function registerCommands(
	api: OpenClawPluginApi,
	client: SupermemoryClient,
	cfg: SupermemoryConfig,
	getSessionKey: () => string | undefined,
): void {
	api.registerCommand({
		name: "memory-usage",
		description: "Toggle memory usage display on/off",
		acceptsArgs: true,
		requireAuth: false,
		handler: async (ctx: { args?: string }) => {
			const arg = ctx.args?.trim().toLowerCase()

			if (arg === "on" || arg === "true" || arg === "enable") {
				cfg.showMemoryUsage = true
				return {
					text: "Memory usage display enabled. The model will now show how many memories were used.",
				}
			}

			if (arg === "off" || arg === "false" || arg === "disable") {
				cfg.showMemoryUsage = false
				return {
					text: "Memory usage display disabled. The model will no longer show memory counts.",
				}
			}

			if (!arg) {
				cfg.showMemoryUsage = !cfg.showMemoryUsage
				const state = cfg.showMemoryUsage ? "enabled" : "disabled"
				return {
					text: `Memory usage display ${state}. Use /memory-usage on|off to set explicitly.`,
				}
			}

			return { text: "Usage: /memory-usage [on|off]" }
		},
	})

	api.registerCommand({
		name: "supermemory-status",
		description: "Show Supermemory configuration status",
		acceptsArgs: false,
		requireAuth: false,
		handler: async () => {
			return { text: formatSupermemoryStatus(cfg, true) }
		},
	})

	api.registerCommand({
		name: "remember",
		description: "Save something to memory",
		acceptsArgs: true,
		requireAuth: true,
		handler: async (ctx: { args?: string }) => {
			const text = ctx.args?.trim()
			if (!text) {
				return { text: "Usage: /remember <text to remember>" }
			}

			log.debug(`/remember command: "${text.slice(0, 50)}"`)

			try {
				const category = detectCategory(text)
				const sk = getSessionKey()
				const { status } = await client.addMemory(
					text,
					{ type: category, source: "openclaw_command" },
					sk ? buildDocumentId(sk) : undefined,
					undefined,
					cfg.entityContext,
				)

				const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text
				if (status === "failed") {
					return {
						text: `Memory store failed (server returned status="failed") for: "${preview}"`,
					}
				}
				return { text: `Remembered: "${preview}"` }
			} catch (err) {
				log.error("/remember failed", err)
				return { text: "Failed to save memory. Check logs for details." }
			}
		},
	})

	api.registerCommand({
		name: "recall",
		description: "Search your memories",
		acceptsArgs: true,
		requireAuth: true,
		handler: async (ctx: { args?: string }) => {
			const query = ctx.args?.trim()
			if (!query) {
				return { text: "Usage: /recall <search query>" }
			}

			log.debug(`/recall command: "${query}"`)

			try {
				const results = await client.search(query, cfg.maxRecallResults)

				if (results.length === 0) {
					return { text: `No memories found for: "${query}"` }
				}

				const lines = results.map((r, i) => {
					const score = r.similarity
						? ` (${(r.similarity * 100).toFixed(0)}%)`
						: ""
					return `${i + 1}. ${r.content || r.memory || ""}${score}`
				})

				return {
					text: `Found ${results.length} memories:\n\n${lines.join("\n")}`,
				}
			} catch (err) {
				log.error("/recall failed", err)
				return { text: "Failed to search memories. Check logs for details." }
			}
		},
	})
}
