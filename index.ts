import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import { SupermemoryClient } from "./client.ts"
import { registerCli } from "./commands/cli.ts"
import { registerCommands, registerStubCommands } from "./commands/slash.ts"
import { parseConfig, supermemoryConfigSchema } from "./config.ts"
import { buildCaptureHandler } from "./hooks/capture.ts"
import { buildRecallHandler } from "./hooks/recall.ts"
import { checkNpmUpdate, formatUpdateNotice } from "./lib/version-check.ts"
import { initLogger } from "./logger.ts"
import { buildMemoryRuntime, buildPromptSection } from "./runtime.ts"
import { registerForgetTool } from "./tools/forget.ts"
import { registerProfileTool } from "./tools/profile.ts"
import { registerSearchTool } from "./tools/search.ts"
import { registerStoreTool } from "./tools/store.ts"

const PLUGIN_VERSION = "2.1.14"
const UPDATE_COMMAND =
	"openclaw plugins install @supermemory/openclaw-supermemory"

try {
	const stateDir =
		process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw")
	const storePath = path.join(stateDir, "memory", "main.sqlite")
	if (!fs.existsSync(storePath)) {
		fs.mkdirSync(path.dirname(storePath), { recursive: true })
		fs.writeFileSync(storePath, "")
	}
} catch {}

export default {
	id: "openclaw-supermemory",
	name: "Supermemory",
	description: "OpenClaw powered by Supermemory plugin",
	kind: "memory" as const,
	configSchema: supermemoryConfigSchema,

	register(api: OpenClawPluginApi) {
		const cfg = parseConfig(api.pluginConfig)

		initLogger(api.logger, cfg.debug)

		if (!cfg.apiKey) {
			registerCli(api)
			api.logger.info(
				"supermemory: not configured - run 'openclaw supermemory setup'",
			)
			registerStubCommands(api)
			return
		}

		const client = new SupermemoryClient(
			cfg.apiKey,
			cfg.containerTag,
			cfg.baseUrl,
		)
		registerCli(api, client)

		const memoryRuntime = buildMemoryRuntime(client)
		const noopFlushPlan = () => null
		if (typeof api.registerMemoryCapability === "function") {
			api.registerMemoryCapability({
				runtime: memoryRuntime,
				promptBuilder: buildPromptSection,
				flushPlanResolver: noopFlushPlan,
			})
		} else {
			api.registerMemoryRuntime?.(memoryRuntime)
			api.registerMemoryPromptSection?.(buildPromptSection)
			api.registerMemoryFlushPlan?.(noopFlushPlan)
		}

		registerSearchTool(api, client, cfg)
		registerStoreTool(api, client, cfg)
		registerForgetTool(api, client, cfg)
		registerProfileTool(api, client, cfg)
		registerSearchTool(api, client, cfg, "supermemory-search")
		registerStoreTool(api, client, cfg, "supermemory-save")
		registerForgetTool(api, client, cfg, "supermemory-forget")
		registerProfileTool(api, client, cfg, "supermemory-profile")

		if (cfg.autoRecall) {
			api.on("before_prompt_build", buildRecallHandler(client, cfg))
		}

		if (cfg.autoCapture) {
			api.on("agent_end", buildCaptureHandler(client, cfg))
		}

		registerCommands(api, client, cfg)

		api.registerService({
			id: "openclaw-supermemory",
			start: () => {
				api.logger.info("supermemory: connected")
				void checkNpmUpdate(
					"@supermemory/openclaw-supermemory",
					PLUGIN_VERSION,
					UPDATE_COMMAND,
				).then((info) => {
					if (info) api.logger.info(formatUpdateNotice(info))
				})
			},
			stop: () => {
				api.logger.info("supermemory: stopped")
			},
		})
	},
}
