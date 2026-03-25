import { hostname } from "node:os"
import { DEFAULT_ENTITY_CONTEXT } from "./memory.ts"

export type CaptureMode = "everything" | "all"

export type CustomContainer = {
	tag: string
	description: string
}

export type SupermemoryConfig = {
	apiKey: string | undefined
	containerTag: string
	autoRecall: boolean
	autoCapture: boolean
	maxRecallResults: number
	profileFrequency: number
	captureMode: CaptureMode
	entityContext: string
	debug: boolean
	enableCustomContainerTags: boolean
	customContainers: CustomContainer[]
	customContainerInstructions: string
	allowedAgents?: string[]
}

const ALLOWED_KEYS = [
	"apiKey",
	"containerTag",
	"autoRecall",
	"autoCapture",
	"maxRecallResults",
	"profileFrequency",
	"captureMode",
	"entityContext",
	"debug",
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
			containerTag: { type: "string" },
			autoRecall: { type: "boolean" },
			autoCapture: { type: "boolean" },
			maxRecallResults: { type: "number" },
			profileFrequency: { type: "number" },
			captureMode: { type: "string", enum: ["all", "everything"] },
			entityContext: { type: "string" },
			debug: { type: "boolean" },
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
