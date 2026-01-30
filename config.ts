import { hostname } from "node:os"

export type CaptureMode = "everything" | "all"

export type SupermemoryConfig = {
	apiKey: string
	containerTag: string
	autoRecall: boolean
	autoCapture: boolean
	maxRecallResults: number
	profileFrequency: number
	captureMode: CaptureMode
	debug: boolean
}

const ALLOWED_KEYS = [
	"apiKey",
	"containerTag",
	"autoRecall",
	"autoCapture",
	"maxRecallResults",
	"profileFrequency",
	"captureMode",
	"debug",
]

function assertAllowedKeys(
	value: Record<string, unknown>,
	allowed: string[],
	label: string,
): void {
	const unknown = Object.keys(value).filter((k) => !allowed.includes(k))
	if (unknown.length > 0) {
		throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`)
	}
}

function resolveEnvVars(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
		const envValue = process.env[envVar]
		if (!envValue) {
			throw new Error(`Environment variable ${envVar} is not set`)
		}
		return envValue
	})
}

function sanitizeTag(raw: string): string {
	return raw
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
}

function defaultContainerTag(): string {
	return sanitizeTag(`openclaw_${hostname()}`)
}

export function parseConfig(raw: unknown): SupermemoryConfig {
	const cfg =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {}

	if (Object.keys(cfg).length > 0) {
		assertAllowedKeys(cfg, ALLOWED_KEYS, "supermemory config")
	}

	const apiKey =
		typeof cfg.apiKey === "string" && cfg.apiKey.length > 0
			? resolveEnvVars(cfg.apiKey)
			: process.env.SUPERMEMORY_OPENCLAW_API_KEY

	if (!apiKey) {
		throw new Error(
			"supermemory: apiKey is required (set in plugin config or SUPERMEMORY_OPENCLAW_API_KEY env var)",
		)
	}

	return {
		apiKey,
		containerTag: cfg.containerTag
			? sanitizeTag(cfg.containerTag as string)
			: defaultContainerTag(),
		autoRecall: (cfg.autoRecall as boolean) ?? true,
		autoCapture: (cfg.autoCapture as boolean) ?? true,
		maxRecallResults: (cfg.maxRecallResults as number) ?? 10,
		profileFrequency: (cfg.profileFrequency as number) ?? 50,
		captureMode:
			cfg.captureMode === "everything"
				? ("everything" as const)
				: ("all" as const),
		debug: (cfg.debug as boolean) ?? false,
	}
}

export const supermemoryConfigSchema = {
	parse: parseConfig,
}
