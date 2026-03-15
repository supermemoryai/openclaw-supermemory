import { hostname } from "node:os"
import { DEFAULT_ENTITY_CONTEXT } from "./memory.ts"

export type CaptureMode = "everything" | "all"

export type CustomContainer = {
	tag: string
	description: string
}

export type SupermemoryConfig = {
	apiKey: string | undefined
	baseUrl: string
	containerTag: string
	autoRecall: boolean
	autoCapture: boolean
	maxRecallResults: number
	profileFrequency: number
	captureMode: CaptureMode
	entityContext: string
	debug: boolean
	showMemoryUsage: boolean
	enableCustomContainerTags: boolean
	customContainers: CustomContainer[]
	customContainerInstructions: string
	allowedAgents?: string[]
}

const ALLOWED_KEYS = [
	"apiKey",
	"baseUrl",
	"containerTag",
	"autoRecall",
	"autoCapture",
	"maxRecallResults",
	"profileFrequency",
	"captureMode",
	"entityContext",
	"debug",
	"showMemoryUsage",
	"enableCustomContainerTags",
	"customContainers",
	"customContainerInstructions",
	"allowedAgents",
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

export const DEFAULT_BASE_URL = "https://api.supermemory.ai"

// Resolve the API endpoint. Precedence: explicit config `baseUrl` (supports
// `${ENV}` interpolation) > SUPERMEMORY_BASE_URL env var > the Supermemory
// cloud default. Anything that isn't a valid http(s) URL falls back to the
// default so a typo can never silently break startup — the client logs the
// resolved endpoint so a misconfiguration is visible.
export function resolveBaseUrl(raw: unknown): string {
	let value: string | undefined
	if (typeof raw === "string" && raw.trim()) {
		try {
			value = resolveEnvVars(raw.trim())
		} catch {
			value = undefined
		}
	}
	if (!value) value = process.env.SUPERMEMORY_BASE_URL
	if (!value) return DEFAULT_BASE_URL

	const trimmed = value.trim().replace(/\/+$/, "")
	try {
		const url = new URL(trimmed)
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return DEFAULT_BASE_URL
		}
		return trimmed
	} catch {
		return DEFAULT_BASE_URL
	}
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

	let apiKey: string | undefined
	try {
		apiKey =
			typeof cfg.apiKey === "string" && cfg.apiKey.length > 0
				? resolveEnvVars(cfg.apiKey)
				: process.env.SUPERMEMORY_OPENCLAW_API_KEY
	} catch {
		apiKey = undefined
	}

	const customContainers: CustomContainer[] = []
	if (Array.isArray(cfg.customContainers)) {
		for (const c of cfg.customContainers) {
			if (
				c &&
				typeof c === "object" &&
				typeof (c as Record<string, unknown>).tag === "string" &&
				typeof (c as Record<string, unknown>).description === "string"
			) {
				customContainers.push({
					tag: sanitizeTag((c as Record<string, unknown>).tag as string),
					description: (c as Record<string, unknown>).description as string,
				})
			}
		}
	}

	const allowedAgents = Array.isArray(cfg.allowedAgents)
		? cfg.allowedAgents.filter(
				(agentId): agentId is string =>
					typeof agentId === "string" && agentId.trim().length > 0,
			)
		: undefined

	return {
		apiKey,
		baseUrl: resolveBaseUrl(cfg.baseUrl),
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
		entityContext:
			typeof cfg.entityContext === "string" && cfg.entityContext.trim()
				? cfg.entityContext.trim()
				: DEFAULT_ENTITY_CONTEXT,
		debug: (cfg.debug as boolean) ?? false,
		showMemoryUsage: (cfg.showMemoryUsage as boolean) ?? true,
		enableCustomContainerTags:
			(cfg.enableCustomContainerTags as boolean) ?? false,
		customContainers,
		customContainerInstructions:
			typeof cfg.customContainerInstructions === "string"
				? cfg.customContainerInstructions
				: "",
		allowedAgents,
	}
}

export const supermemoryConfigSchema = {
	jsonSchema: {
		type: "object",
		additionalProperties: false,
		properties: {
			apiKey: { type: "string" },
			baseUrl: { type: "string" },
			containerTag: { type: "string" },
			autoRecall: { type: "boolean" },
			autoCapture: { type: "boolean" },
			maxRecallResults: { type: "number" },
			profileFrequency: { type: "number" },
			captureMode: { type: "string", enum: ["all", "everything"] },
			entityContext: { type: "string" },
			debug: { type: "boolean" },
			showMemoryUsage: { type: "boolean" },
			enableCustomContainerTags: { type: "boolean" },
			customContainers: {
				type: "array",
				items: {
					type: "object",
					properties: {
						tag: { type: "string" },
						description: { type: "string" },
					},
					required: ["tag", "description"],
				},
			},
			customContainerInstructions: { type: "string" },
			allowedAgents: {
				type: "array",
				items: { type: "string" },
			},
		},
	},
	parse: parseConfig,
}
