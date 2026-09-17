import type { SupermemoryClient } from "./client.ts"
import { log } from "./logger.ts"

type MemoryProviderStatus = {
	backend: "builtin" | "qmd"
	provider: string
	model?: string
	files?: number
	chunks?: number
	custom?: Record<string, unknown>
}

type MemoryEmbeddingProbeResult = {
	ok: boolean
	error?: string
}

type MemorySyncProgressUpdate = {
	completed: number
	total: number
	label?: string
}

type RegisteredMemorySearchManager = {
	status(): MemoryProviderStatus
	probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>
	probeVectorAvailability(): Promise<boolean>
	sync?(params?: {
		reason?: string
		force?: boolean
		sessionFiles?: string[]
		progress?: (update: MemorySyncProgressUpdate) => void
	}): Promise<void>
	close?(): Promise<void>
}

type MemoryRuntimeBackendConfig =
	| { backend: "builtin" }
	| { backend: "qmd"; qmd?: { command?: string } }

type MemoryPluginRuntime = {
	getMemorySearchManager(params: {
		cfg: unknown
		agentId: string
		purpose?: "default" | "status"
	}): Promise<{
		manager: RegisteredMemorySearchManager | null
		error?: string
	}>
	resolveMemoryBackendConfig(params: {
		cfg: unknown
		agentId: string
	}): MemoryRuntimeBackendConfig
	closeAllMemorySearchManagers?(): Promise<void>
}

function createSearchManager(
	client: SupermemoryClient,
): RegisteredMemorySearchManager {
	return {
		status() {
			return {
				backend: "builtin" as const,
				provider: "supermemory",
				model: "supermemory-remote",
				files: 0,
				chunks: 0,
				custom: {
					containerTag: client.getContainerTag(),
					transport: "remote",
				},
			}
		},

		async probeEmbeddingAvailability() {
			try {
				await client.search("connection-probe", 1)
				return { ok: true }
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "supermemory unreachable"
				log.warn(`embedding probe failed: ${message}`)
				return { ok: false, error: message }
			}
		},

		async probeVectorAvailability() {
			return true
		},

		async sync() {},

		async close() {},
	}
}

export function buildMemoryRuntime(
	client: SupermemoryClient,
): MemoryPluginRuntime {
	return {
		async getMemorySearchManager() {
			return { manager: createSearchManager(client) }
		},

		resolveMemoryBackendConfig() {
			return { backend: "builtin" as const }
		},
	}
}

export function buildPromptSection(params: {
	availableTools: Set<string>
}): string[] {
	// Prefer the hyphenated names; fall back to the deprecated snake_case ones.
	const pick = (hyphen: string, snake: string): string | null => {
		if (params.availableTools.has(hyphen)) return hyphen
		if (params.availableTools.has(snake)) return snake
		return null
	}

	const searchTool = pick("supermemory-search", "supermemory_search")
	const storeTool = pick("supermemory-save", "supermemory_store")
	if (!searchTool && !storeTool) return []

	const lines: string[] = [
		"## Memory (Supermemory)",
		"",
		"Memory is managed by Supermemory (cloud). Do not read or write local memory files like MEMORY.md or memory/*.md — they do not exist.",
		"Relevant memories are automatically injected at the start of each conversation.",
		"",
	]

	if (searchTool) {
		lines.push(
			`Use ${searchTool} to look up prior conversations, preferences, and facts.`,
		)
	}
	if (storeTool) {
		lines.push(
			`Use ${storeTool} to save important information the user asks you to remember.`,
			"The user can run /supermemory-index (or the supermemory-index skill) to index a project.",
		)
	}

	return lines
}
