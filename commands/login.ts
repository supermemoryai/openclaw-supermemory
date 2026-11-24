import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
	CREDENTIALS_FILE,
	clearCredentials,
	getAccessToken,
	getOAuthConfig,
	hasOAuthCredentials,
	loadCredentialData,
	type OAuthConfig,
	startAuthFlow,
} from "../auth.ts"
import { resolveApiKey, resolveBaseUrl } from "../config.ts"

export const OPENCLAW_CONFIG_PATH = path.join(
	os.homedir(),
	".openclaw",
	"openclaw.json",
)
const PLUGIN_ID = "openclaw-supermemory"
const RESTART_HINT = "Restart OpenClaw to apply: openclaw gateway restart"

// Hyphenated names are current; snake_case is deprecated and removed in 3.0.
const SUPERMEMORY_TOOL_NAMES = [
	"supermemory-save",
	"supermemory-search",
	"supermemory-forget",
	"supermemory-profile",
	"supermemory_store",
	"supermemory_search",
	"supermemory_forget",
	"supermemory_profile",
]

function appendUniqueStrings(value: unknown, entries: string[]): string[] {
	const current = Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: []
	return Array.from(new Set([...current, ...entries]))
}

export function ensureSupermemoryToolsAllowed(
	config: Record<string, unknown>,
): void {
	if (
		!config.tools ||
		typeof config.tools !== "object" ||
		Array.isArray(config.tools)
	) {
		config.tools = {}
	}

	const tools = config.tools as Record<string, unknown>
	tools.alsoAllow = appendUniqueStrings(tools.alsoAllow, SUPERMEMORY_TOOL_NAMES)

	if (Array.isArray(tools.allow)) {
		tools.allow = appendUniqueStrings(tools.allow, SUPERMEMORY_TOOL_NAMES)
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

export function readPluginConfig(): Record<string, unknown> {
	try {
		const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf-8"))
		return asRecord(asRecord(config?.plugins?.entries?.[PLUGIN_ID]).config)
	} catch {
		return {}
	}
}

export function maskKey(key: string): string {
	return key.length <= 12 ? "****" : `${key.slice(0, 8)}...${key.slice(-4)}`
}

function apiKeySource(pluginConfig: Record<string, unknown>): string {
	return typeof pluginConfig.apiKey === "string" && pluginConfig.apiKey
		? "config"
		: "SUPERMEMORY_OPENCLAW_API_KEY"
}

// Enables the plugin like setup does, but keeps existing plugin options and never adds an apiKey.
function enablePlugin(): boolean {
	let config: Record<string, unknown> = {}
	if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
		try {
			config = asRecord(
				JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf-8")),
			)
		} catch {
			return false
		}
	}
	const before = JSON.stringify(config)
	const plugins = asRecord(config.plugins)
	const entries = asRecord(plugins.entries)
	const slots = asRecord(plugins.slots)
	const entry = asRecord(entries[PLUGIN_ID])
	config.plugins = plugins
	plugins.entries = entries
	plugins.slots = slots
	slots.memory = PLUGIN_ID
	entries[PLUGIN_ID] = {
		...entry,
		enabled: true,
		hooks: {
			...asRecord(entry.hooks),
			allowPromptInjection: true,
			allowConversationAccess: true,
		},
		config: asRecord(entry.config),
	}
	ensureSupermemoryToolsAllowed(config)
	if (JSON.stringify(config) === before) return true
	fs.mkdirSync(path.dirname(OPENCLAW_CONFIG_PATH), { recursive: true })
	fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2))
	return true
}

function finishLogin(pluginConfig: Record<string, unknown>): void {
	if (!enablePlugin()) {
		console.log(
			`Could not update ${OPENCLAW_CONFIG_PATH}. Enable the "${PLUGIN_ID}" plugin and set plugins.slots.memory to it manually.`,
		)
	}
	if (resolveApiKey(pluginConfig)) {
		console.log(
			`An API key from ${apiKeySource(pluginConfig)} still takes precedence. Remove it to use OAuth.`,
		)
	}
	console.log(RESTART_HINT)
}

export async function login(
	pluginConfig: Record<string, unknown>,
	{ printUrl = false }: { printUrl?: boolean } = {},
): Promise<number> {
	let config: OAuthConfig
	try {
		config = getOAuthConfig(resolveBaseUrl(pluginConfig.baseUrl))
	} catch (error) {
		console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
		return 1
	}
	if (hasOAuthCredentials(config)) {
		console.log(
			"Already signed in to Supermemory. Run logout first to switch accounts.",
		)
		finishLogin(pluginConfig)
		return 0
	}
	try {
		await startAuthFlow(config, { printUrl })
	} catch (error) {
		console.error(
			`✗ Sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		return 1
	}
	console.log(
		`✓ Signed in to Supermemory. Credentials saved to ${CREDENTIALS_FILE}`,
	)
	finishLogin(pluginConfig)
	return 0
}

export async function logout(
	pluginConfig: Record<string, unknown>,
): Promise<number> {
	let cleared: Awaited<ReturnType<typeof clearCredentials>>
	try {
		cleared = await clearCredentials()
	} catch (error) {
		console.error(
			`✗ Sign-out failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		console.error(
			"Saved credentials were kept. Try again when the network is available.",
		)
		return 1
	}
	console.log(
		cleared
			? "✓ Signed out. The refresh token was revoked and saved credentials were removed."
			: "No saved Supermemory sign-in found.",
	)
	if (resolveApiKey(pluginConfig)) {
		console.log(
			`An API key from ${apiKeySource(pluginConfig)} is still configured, so the plugin keeps using it.`,
		)
	}
	console.log(RESTART_HINT)
	return 0
}

async function fetchAccount(
	baseUrl: string,
	token: string,
): Promise<string | undefined> {
	for (const route of ["/session", "/v3/session"]) {
		try {
			const response = await fetch(`${baseUrl}${route}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					"x-sm-source": "openclaw",
				},
				signal: AbortSignal.timeout(5000),
			})
			if (!response.ok) continue
			const data = asRecord(await response.json())
			const email = asRecord(data.user).email
			const org = asRecord(data.org).name
			if (typeof email !== "string") continue
			return typeof org === "string" ? `${email} (${org})` : email
		} catch {}
	}
	return undefined
}

// Returns status lines and whether any credential is usable, mirroring the runtime precedence.
export async function describeAuth(
	pluginConfig: Record<string, unknown>,
): Promise<{ configured: boolean; lines: string[] }> {
	const baseUrl = resolveBaseUrl(pluginConfig.baseUrl)
	const apiKey = resolveApiKey(pluginConfig)
	let token = apiKey
	const lines: string[] = []
	if (apiKey) {
		lines.push(
			`✓ Auth:            API key ${maskKey(apiKey)} (from ${apiKeySource(pluginConfig)})`,
		)
	} else {
		let config: OAuthConfig | undefined
		try {
			config = getOAuthConfig(baseUrl)
		} catch {}
		if (!config || !hasOAuthCredentials(config)) {
			lines.push(
				loadCredentialData()
					? "✗ Auth:            OAuth sign-in expired or for another endpoint"
					: "✗ Auth:            not configured",
				"  Run: openclaw supermemory login (or setup to use an API key)",
			)
			return { configured: false, lines }
		}
		try {
			token = await getAccessToken(config, 10_000)
		} catch (error) {
			lines.push(
				"✗ Auth:            OAuth sign-in could not be refreshed",
				`  ${error instanceof Error ? error.message : String(error)}`,
			)
			return { configured: false, lines }
		}
		lines.push(`✓ Auth:            OAuth (${CREDENTIALS_FILE})`)
	}
	const account = token ? await fetchAccount(baseUrl, token) : undefined
	lines.push(`  Account:          ${account ?? "unavailable"}`)
	return { configured: true, lines }
}
