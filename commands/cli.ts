import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import type { SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"

export function registerCliSetup(api: OpenClawPluginApi): void {
	api.registerCli(
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		({ program }: { program: any }) => {
			const cmd = program
				.command("supermemory")
				.description("Supermemory long-term memory commands")

			cmd
				.command("setup")
				.description("Configure Supermemory API key")
				.action(async () => {
					const configDir = path.join(os.homedir(), ".openclaw")
					const configPath = path.join(configDir, "openclaw.json")

					console.log("\n🧠 Supermemory Setup\n")
					console.log("Get your API key from: https://console.supermemory.ai\n")

					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					})

					const apiKey = await new Promise<string>((resolve) => {
						rl.question("Enter your Supermemory API key: ", resolve)
					})
					rl.close()

					if (!apiKey.trim()) {
						console.log("\nNo API key provided. Setup cancelled.")
						return
					}

					if (!apiKey.startsWith("sm_")) {
						console.log("\nWarning: API key should start with 'sm_'")
					}

					let config: Record<string, unknown> = {}
					if (fs.existsSync(configPath)) {
						try {
							config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
						} catch {
							config = {}
						}
					}

					if (!config.plugins) config.plugins = {}
					const plugins = config.plugins as Record<string, unknown>
					if (!plugins.entries) plugins.entries = {}
					const entries = plugins.entries as Record<string, unknown>

					entries["openclaw-supermemory"] = {
						enabled: true,
						config: {
							apiKey: apiKey.trim(),
						},
					}

					if (!fs.existsSync(configDir)) {
						fs.mkdirSync(configDir, { recursive: true })
					}

					fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

					console.log("\n✓ API key saved to ~/.openclaw/openclaw.json")
					console.log(
						"  Restart OpenClaw to apply changes: openclaw gateway --force\n",
					)
				})

			cmd
				.command("setup-advanced")
				.description("Configure Supermemory with all options")
				.action(async () => {
					const configDir = path.join(os.homedir(), ".openclaw")
					const configPath = path.join(configDir, "openclaw.json")
					const defaultTag = os.hostname().replace(/[^a-zA-Z0-9_]/g, "_")

					console.log("\n🧠 Supermemory Advanced Setup\n")
					console.log("Press Enter to use default values shown in [brackets]\n")
					console.log("Get your API key from: https://console.supermemory.ai\n")

					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					})

					const ask = (question: string): Promise<string> =>
						new Promise((resolve) => rl.question(question, resolve))

					const apiKey = await ask("API key (required): ")
					if (!apiKey.trim()) {
						console.log("\nNo API key provided. Setup cancelled.")
						rl.close()
						return
					}

					if (!apiKey.startsWith("sm_")) {
						console.log("Warning: API key should start with 'sm_'\n")
					}

					const containerTag = await ask(
						`Container tag [openclaw_${defaultTag}]: `,
					)

					console.log("\nAuto-recall:")
					console.log(
						"  true  - Inject relevant memories before each AI response (recommended)",
					)
					console.log("  false - Disable automatic memory recall")
					const autoRecallInput = await ask("Auto-recall (true/false) [true]: ")
					let autoRecall = true
					if (autoRecallInput.trim().toLowerCase() === "false") {
						autoRecall = false
					} else if (
						autoRecallInput.trim() &&
						autoRecallInput.trim().toLowerCase() !== "true"
					) {
						console.log("  Invalid value, using default: true")
					}

					console.log("\nAuto-capture:")
					console.log(
						"  true  - Save conversations to memory after each AI response (recommended)",
					)
					console.log("  false - Disable automatic conversation capture")
					const autoCaptureInput = await ask(
						"Auto-capture (true/false) [true]: ",
					)
					let autoCapture = true
					if (autoCaptureInput.trim().toLowerCase() === "false") {
						autoCapture = false
					} else if (
						autoCaptureInput.trim() &&
						autoCaptureInput.trim().toLowerCase() !== "true"
					) {
						console.log("  Invalid value, using default: true")
					}

					const maxResultsInput = await ask(
						"Max memories to recall per turn (1-20) [10]: ",
					)
					let maxRecallResults = 10
					const parsedMax = Number.parseInt(maxResultsInput.trim(), 10)
					if (maxResultsInput.trim()) {
						if (parsedMax >= 1 && parsedMax <= 20) {
							maxRecallResults = parsedMax
						} else {
							console.log("  Invalid value, using default: 10")
						}
					}

					const profileFreqInput = await ask(
						"Inject full profile every N turns (1-500) [50]: ",
					)
					let profileFrequency = 50
					const parsedFreq = Number.parseInt(profileFreqInput.trim(), 10)
					if (profileFreqInput.trim()) {
						if (parsedFreq >= 1 && parsedFreq <= 500) {
							profileFrequency = parsedFreq
						} else {
							console.log("  Invalid value, using default: 50")
						}
					}

					console.log("\nCapture mode:")
					console.log(
						"  all        - Filter short texts and context blocks (recommended)",
					)
					console.log("  everything - Capture all messages without filtering")
					const captureModeInput = await ask(
						"Capture mode (all/everything) [all]: ",
					)
					let captureMode: "all" | "everything" = "all"
					if (captureModeInput.trim().toLowerCase() === "everything") {
						captureMode = "everything"
					} else if (
						captureModeInput.trim() &&
						captureModeInput.trim().toLowerCase() !== "all"
					) {
						console.log("  Invalid value, using default: all")
					}

					console.log("\n--- Custom Container Tags (Advanced) ---")
					console.log("Define custom containers for AI-driven memory routing.")
					const enableCustomContainerTagsInput = await ask(
						"Enable custom container tags? (true/false) [false]: ",
					)
					let enableCustomContainerTags = false
					if (enableCustomContainerTagsInput.trim().toLowerCase() === "true") {
						enableCustomContainerTags = true
					} else if (
						enableCustomContainerTagsInput.trim() &&
						enableCustomContainerTagsInput.trim().toLowerCase() !== "false"
					) {
						console.log("  Invalid value, using default: false")
					}

					console.log(
						"\nAdd custom containers (tag:description). Leave blank when done.",
					)
					const customContainers: Array<{ tag: string; description: string }> =
						[]
					while (true) {
						const containerInput = await ask(
							"Container (e.g. work:Work projects): ",
						)
						if (!containerInput.trim()) break
						const [tag, ...descParts] = containerInput.split(":")
						const description = descParts.join(":").trim()
						if (tag && description) {
							customContainers.push({
								tag: tag.trim().replace(/[^a-zA-Z0-9_]/g, "_"),
								description,
							})
							console.log(`  Added: ${tag.trim()} → ${description}`)
						} else {
							console.log("  Invalid format. Use tag:description")
						}
					}

					const customContainerInstructions = await ask(
						"Custom container tag instructions (optional): ",
					)

					rl.close()

					let config: Record<string, unknown> = {}
					if (fs.existsSync(configPath)) {
						try {
							config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
						} catch {
							config = {}
						}
					}

					if (!config.plugins) config.plugins = {}
					const plugins = config.plugins as Record<string, unknown>
					if (!plugins.entries) plugins.entries = {}
					const entries = plugins.entries as Record<string, unknown>

					const pluginConfig: Record<string, unknown> = {
						apiKey: apiKey.trim(),
					}

					if (containerTag.trim()) {
						pluginConfig.containerTag = containerTag
							.trim()
							.replace(/[^a-zA-Z0-9_]/g, "_")
					}
					if (!autoRecall) pluginConfig.autoRecall = false
					if (!autoCapture) pluginConfig.autoCapture = false
					if (maxRecallResults !== 10)
						pluginConfig.maxRecallResults = maxRecallResults
					if (profileFrequency !== 50)
						pluginConfig.profileFrequency = profileFrequency
					if (captureMode !== "all") pluginConfig.captureMode = captureMode
					if (enableCustomContainerTags)
						pluginConfig.enableCustomContainerTags = true
					if (customContainerInstructions.trim()) {
						pluginConfig.customContainerInstructions =
							customContainerInstructions.trim()
					}
					if (customContainers.length > 0) {
						pluginConfig.customContainers = customContainers
					}

					entries["openclaw-supermemory"] = {
						enabled: true,
						config: pluginConfig,
					}

					if (!fs.existsSync(configDir)) {
						fs.mkdirSync(configDir, { recursive: true })
					}

					fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

					console.log("\n✓ Configuration saved to ~/.openclaw/openclaw.json")
					console.log("\nSettings:")
					console.log(
						`  API key:          ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
					)
					console.log(
						`  Container tag:    ${containerTag.trim() || `openclaw_${defaultTag}`}`,
					)
					console.log(`  Auto-recall:      ${autoRecall}`)
					console.log(`  Auto-capture:     ${autoCapture}`)
					console.log(`  Max results:      ${maxRecallResults}`)
					console.log(`  Profile freq:     ${profileFrequency}`)
					console.log(`  Capture mode:     ${captureMode}`)
					console.log(
						`  Custom containers: ${enableCustomContainerTags ? "enabled" : "disabled"}`,
					)
					console.log(`  Custom containers: ${customContainers.length}`)
					if (customContainerInstructions.trim()) {
						console.log(
							`  Routing instructions: "${customContainerInstructions.trim().slice(0, 50)}${customContainerInstructions.length > 50 ? "..." : ""}"`,
						)
					}
					console.log("\nRestart OpenClaw to apply: openclaw gateway --force\n")
				})

			cmd
				.command("status")
				.description("Check Supermemory configuration status")
				.action(async () => {
					const configPath = path.join(
						os.homedir(),
						".openclaw",
						"openclaw.json",
					)
					const envKey = process.env.SUPERMEMORY_OPENCLAW_API_KEY
					const defaultTag = `openclaw_${os.hostname().replace(/[^a-zA-Z0-9_]/g, "_")}`

					console.log("\n🧠 Supermemory Status\n")

					let apiKeySource = ""
					let apiKeyDisplay = ""
					let pluginConfig: Record<string, unknown> = {}
					let enabled = true

					if (envKey) {
						apiKeySource = "environment"
						apiKeyDisplay = `${envKey.slice(0, 8)}...${envKey.slice(-4)}`
					}

					if (fs.existsSync(configPath)) {
						try {
							const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
							const entry = config?.plugins?.entries?.["openclaw-supermemory"]
							if (entry) {
								enabled = entry.enabled ?? true
								pluginConfig = entry.config ?? {}
								if (pluginConfig.apiKey && !envKey) {
									const key = pluginConfig.apiKey as string
									apiKeySource = "config"
									apiKeyDisplay = `${key.slice(0, 8)}...${key.slice(-4)}`
								}
							}
						} catch {
							console.log("✗ Could not read config file\n")
							return
						}
					}

					if (!apiKeyDisplay) {
						console.log("✗ No API key configured")
						console.log("  Run: openclaw supermemory setup\n")
						return
					}

					const customContainers = Array.isArray(pluginConfig.customContainers)
						? pluginConfig.customContainers
						: []

					console.log(
						`✓ API key:         ${apiKeyDisplay} (from ${apiKeySource})`,
					)
					console.log(`  Enabled:          ${enabled}`)
					console.log(
						`  Container tag:    ${pluginConfig.containerTag ?? defaultTag}`,
					)
					console.log(`  Auto-recall:      ${pluginConfig.autoRecall ?? true}`)
					console.log(`  Auto-capture:     ${pluginConfig.autoCapture ?? true}`)
					console.log(
						`  Max results:      ${pluginConfig.maxRecallResults ?? 10}`,
					)
					console.log(
						`  Profile freq:     ${pluginConfig.profileFrequency ?? 50}`,
					)
					console.log(
						`  Capture mode:     ${pluginConfig.captureMode ?? "all"}`,
					)
					console.log(
						`  Custom containers: ${pluginConfig.enableCustomContainerTags ? "enabled" : "disabled"}`,
					)
					console.log(`  Custom containers: ${customContainers.length}`)
					console.log("")
				})
		},
		{ commands: ["supermemory"] },
	)
}

export function registerCli(
	api: OpenClawPluginApi,
	client: SupermemoryClient,
	_cfg: SupermemoryConfig,
): void {
	api.registerCli(
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		({ program }: { program: any }) => {
			const cmd = program.commands.find(
				// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
				(c: any) => c.name() === "supermemory",
			)
			if (!cmd) return

			cmd
				.command("search")
				.argument("<query>", "Search query")
				.option("--limit <n>", "Max results", "5")
				.action(async (query: string, opts: { limit: string }) => {
					const limit = Number.parseInt(opts.limit, 10) || 5
					log.debug(`cli search: query="${query}" limit=${limit}`)

					const results = await client.search(query, limit)

					if (results.length === 0) {
						console.log("No memories found.")
						return
					}

					for (const r of results) {
						const score = r.similarity
							? ` (${(r.similarity * 100).toFixed(0)}%)`
							: ""
						console.log(`- ${r.content || r.memory || ""}${score}`)
					}
				})

			cmd
				.command("profile")
				.option("--query <q>", "Optional query to focus the profile")
				.action(async (opts: { query?: string }) => {
					log.debug(`cli profile: query="${opts.query ?? "(none)"}"`)

					const profile = await client.getProfile(opts.query)

					if (profile.static.length === 0 && profile.dynamic.length === 0) {
						console.log("No profile information available yet.")
						return
					}

					if (profile.static.length > 0) {
						console.log("Stable Preferences:")
						for (const f of profile.static) console.log(`  - ${f}`)
					}

					if (profile.dynamic.length > 0) {
						console.log("Recent Context:")
						for (const f of profile.dynamic) console.log(`  - ${f}`)
					}
				})

			cmd
				.command("wipe")
				.description("Delete ALL memories for this container tag")
				.action(async () => {
					const tag = client.getContainerTag()
					const rl = readline.createInterface({
						input: process.stdin,
						output: process.stdout,
					})

					const answer = await new Promise<string>((resolve) => {
						rl.question(
							`This will permanently delete all memories in "${tag}". Type "yes" to confirm: `,
							resolve,
						)
					})
					rl.close()

					if (answer.trim().toLowerCase() !== "yes") {
						console.log("Aborted.")
						return
					}

					log.debug(`cli wipe: container="${tag}"`)
					const result = await client.wipeAllMemories()
					console.log(`Wiped ${result.deletedCount} memories from "${tag}".`)
				})
		},
		{ commands: ["supermemory"] },
	)
}
