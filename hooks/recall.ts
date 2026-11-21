import type {
	ProfileSearchResult,
	SearchResult,
	SupermemoryClient,
} from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"
import { stripInboundMetadata } from "../memory.ts"
import { isInteractiveTrigger } from "./trigger.ts"

const RECALL_BUDGET_MS = 3000
const MAX_SEEN_SESSIONS = 100
const MAX_SEEN_PER_SESSION = 500

const MEMORY_GUIDANCE =
	"<supermemory-context> blocks in user messages hold background context about the user from long-term memory. Use this context silently to inform your understanding — only reference it when the user's message is directly related to something in these memories. Memories shown earlier in the conversation still apply. Do not proactively bring up memories. Only use them when the conversation naturally calls for it."

type SeenMemories = { turn: number; ids: Set<string> }

function formatRelativeTime(isoTimestamp: string): string {
	try {
		const dt = new Date(isoTimestamp)
		const now = new Date()
		const seconds = (now.getTime() - dt.getTime()) / 1000
		const minutes = seconds / 60
		const hours = seconds / 3600
		const days = seconds / 86400

		if (minutes < 30) return "just now"
		if (minutes < 60) return `${Math.floor(minutes)}mins ago`
		if (hours < 24) return `${Math.floor(hours)} hrs ago`
		if (days < 7) return `${Math.floor(days)}d ago`

		const month = dt.toLocaleString("en", { month: "short" })
		if (dt.getFullYear() === now.getFullYear()) {
			return `${dt.getDate()} ${month}`
		}
		return `${dt.getDate()} ${month}, ${dt.getFullYear()}`
	} catch {
		return ""
	}
}

function deduplicateMemories(
	staticFacts: string[],
	dynamicFacts: string[],
	searchResults: ProfileSearchResult[],
): {
	static: string[]
	dynamic: string[]
	searchResults: ProfileSearchResult[]
} {
	const seen = new Set<string>()

	const uniqueStatic = staticFacts.filter((m) => {
		if (seen.has(m)) return false
		seen.add(m)
		return true
	})

	const uniqueDynamic = dynamicFacts.filter((m) => {
		if (seen.has(m)) return false
		seen.add(m)
		return true
	})

	const uniqueSearch = searchResults.filter((r) => {
		const memory = r.memory ?? ""
		if (!memory || seen.has(memory)) return false
		seen.add(memory)
		return true
	})

	return {
		static: uniqueStatic,
		dynamic: uniqueDynamic,
		searchResults: uniqueSearch,
	}
}

function formatContext(
	staticFacts: string[],
	dynamicFacts: string[],
	searchResults: ProfileSearchResult[],
	maxResults: number,
	showMemoryUsage = true,
): string | null {
	const deduped = deduplicateMemories(staticFacts, dynamicFacts, searchResults)
	const statics = deduped.static.slice(0, maxResults)
	const dynamics = deduped.dynamic.slice(0, maxResults)
	const search = deduped.searchResults.slice(0, maxResults)

	if (statics.length === 0 && dynamics.length === 0 && search.length === 0)
		return null

	const totalMemories = statics.length + dynamics.length + search.length

	const sections: string[] = []

	if (statics.length > 0) {
		sections.push(
			"## User Profile (Persistent)\n" +
				statics.map((f) => `- ${f}`).join("\n"),
		)
	}

	if (dynamics.length > 0) {
		sections.push(
			`## Recent Context\n${dynamics.map((f) => `- ${f}`).join("\n")}`,
		)
	}

	if (search.length > 0) {
		const lines = search.map((r) => {
			const memory = r.memory ?? ""
			const timeStr = r.updatedAt ? formatRelativeTime(r.updatedAt) : ""
			const pct =
				r.similarity != null ? `[${Math.round(r.similarity * 100)}%]` : ""
			const prefix = timeStr ? `[${timeStr}]` : ""
			return `- ${prefix}${memory} ${pct}`.trim()
		})
		sections.push(
			`## Relevant Memories (with relevance %)\n${lines.join("\n")}`,
		)
	}

	let memoryUsageInstruction = ""
	if (showMemoryUsage) {
		memoryUsageInstruction = `\n\nIMPORTANT: At the very beginning of your response, include a brief note indicating how many memories from Supermemory were used to inform your response. Format it as: "[Supermemory: ${totalMemories} memories loaded]" — this helps the user understand that OpenClaw is using their long-term memory. If none of the memories are relevant to the current message, say "[Supermemory: ${totalMemories} memories loaded, 0 used]".`
	}

	return `<supermemory-context>\n${sections.join("\n\n")}${memoryUsageInstruction}\n</supermemory-context>`
}

function countUserTurns(messages: unknown[]): number {
	let count = 0
	for (const msg of messages) {
		if (
			msg &&
			typeof msg === "object" &&
			(msg as Record<string, unknown>).role === "user"
		) {
			count++
		}
	}
	return count
}

function memoryKey(result: SearchResult): string {
	return result.id || result.memory || ""
}

// A new or compacted session (fewer user messages than last time) starts with an empty seen-set.
function sessionSeenIds(
	sessions: Map<string, SeenMemories>,
	key: string,
	turn: number,
): Set<string> {
	let state = sessions.get(key)
	sessions.delete(key)
	if (!state || turn === 0 || turn < state.turn) {
		state = { turn, ids: new Set() }
	}
	state.turn = turn
	sessions.set(key, state)
	if (sessions.size > MAX_SEEN_SESSIONS) {
		sessions.delete(sessions.keys().next().value as string)
	}
	return state.ids
}

function formatContainerMetadata(
	cfg: SupermemoryConfig,
	messageProvider?: string,
): string | null {
	if (!cfg.enableCustomContainerTags || cfg.customContainers.length === 0)
		return null

	const lines: string[] = []

	lines.push(`Root container: \`${cfg.containerTag}\``)
	lines.push("")
	lines.push("Custom memory containers:")
	for (const c of cfg.customContainers) {
		lines.push(`- \`${c.tag}\`: ${c.description}`)
	}

	if (messageProvider) {
		lines.push("")
		lines.push(`Current channel: ${messageProvider}`)
	}

	if (cfg.customContainerInstructions) {
		lines.push("")
		lines.push(cfg.customContainerInstructions)
	}

	lines.push("")
	lines.push(
		"Use containerTag parameter to store in a specific container, otherwise stores to root.",
	)

	return lines.join("\n")
}

// Guidance is returned on every path, even on errors, so the system prompt stays byte-identical across turns.
export function buildRecallHandler(
	client: SupermemoryClient,
	cfg: SupermemoryConfig,
) {
	const seenBySession = new Map<string, SeenMemories>()

	const recall = async (
		event: Record<string, unknown>,
		ctx: Record<string, unknown> | undefined,
		signal: AbortSignal,
	): Promise<string | undefined> => {
		const trigger = ctx?.trigger as string | undefined
		if (!isInteractiveTrigger(trigger)) {
			return
		}

		const rawPrompt = event.prompt as string | undefined
		if (!rawPrompt || rawPrompt.length < 5) return

		const messages = Array.isArray(event.messages) ? event.messages : []
		const turn = countUserTurns(messages)
		const isNewSession = turn === 0
		const includeProfile = isNewSession || turn % cfg.profileFrequency === 0
		const messageProvider = ctx?.messageProvider as string | undefined
		const query = isNewSession ? undefined : stripInboundMetadata(rawPrompt)
		const sessionKey = (ctx?.sessionId ?? ctx?.sessionKey) as string | undefined

		log.debug(
			`recalling for turn ${turn} (profile: ${includeProfile}, newSession: ${isNewSession})`,
		)

		const [profile, search] = await Promise.allSettled([
			includeProfile
				? client.getProfile(undefined, undefined, signal)
				: Promise.resolve(undefined),
			query ? client.search(query, 10, undefined, signal) : Promise.resolve([]),
		])
		if (signal.aborted) return
		if (profile.status === "rejected") {
			log.error("profile recall failed", profile.reason)
		}
		if (search.status === "rejected") {
			log.error("recall failed", search.reason)
		}

		const seen = sessionKey
			? sessionSeenIds(seenBySession, sessionKey, turn)
			: undefined
		const fresh = (search.status === "fulfilled" ? search.value : [])
			.filter((r) => !seen?.has(memoryKey(r)))
			.slice(0, cfg.maxRecallResults)
		const profileData =
			profile.status === "fulfilled" ? profile.value : undefined

		const memoryContext = formatContext(
			profileData?.static ?? [],
			profileData?.dynamic ?? [],
			fresh,
			cfg.maxRecallResults,
			cfg.showMemoryUsage,
		)
		if (memoryContext && seen) {
			for (const r of fresh) {
				seen.add(memoryKey(r))
				if (seen.size > MAX_SEEN_PER_SESSION) {
					seen.delete(seen.values().next().value as string)
				}
			}
		}

		const containerContext = formatContainerMetadata(cfg, messageProvider)

		const contextParts: string[] = []
		if (memoryContext) contextParts.push(memoryContext)
		if (containerContext) {
			contextParts.push(
				`<supermemory-containers>\n${containerContext}\n</supermemory-containers>`,
			)
		}

		if (contextParts.length === 0) {
			log.debug("no new memories to inject")
			return
		}

		const finalContext = contextParts.join("\n\n")
		log.debug(`injecting context (${finalContext.length} chars, turn ${turn})`)
		return finalContext
	}

	return async (
		event: Record<string, unknown>,
		ctx?: Record<string, unknown>,
	) => {
		const signal = AbortSignal.timeout(RECALL_BUDGET_MS)
		const deadline = new Promise<undefined>((resolve) =>
			signal.addEventListener("abort", () => resolve(undefined), {
				once: true,
			}),
		)
		const prependContext = await Promise.race([
			recall(event, ctx, signal).catch((err) => {
				log.error("recall failed", err)
				return undefined
			}),
			deadline,
		])
		if (signal.aborted)
			log.warn("recall skipped: Supermemory did not answer in time")
		return prependContext
			? { prependContext, appendSystemContext: MEMORY_GUIDANCE }
			: { appendSystemContext: MEMORY_GUIDANCE }
	}
}
