import type { ProfileSearchResult, SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"

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
): string | null {
	const deduped = deduplicateMemories(staticFacts, dynamicFacts, searchResults)
	const statics = deduped.static.slice(0, maxResults)
	const dynamics = deduped.dynamic.slice(0, maxResults)
	const search = deduped.searchResults.slice(0, maxResults)

	if (statics.length === 0 && dynamics.length === 0 && search.length === 0)
		return null

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

	const intro =
		"The following is recalled context about the user. Reference it only when relevant to the conversation."
	const disclaimer =
		"Use these memories naturally when relevant — including indirect connections — but don't force them into every response or make assumptions beyond what's stated."

	return `<supermemory-context>\n${intro}\n\n${sections.join("\n\n")}\n\n${disclaimer}\n</supermemory-context>`
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

export function buildRecallHandler(
	client: SupermemoryClient,
	cfg: SupermemoryConfig,
) {
	return async (
		event: Record<string, unknown>,
		ctx?: Record<string, unknown>,
	) => {
		const prompt = event.prompt as string | undefined
		if (!prompt || prompt.length < 5) return

		const messages = Array.isArray(event.messages) ? event.messages : []
		const turn = countUserTurns(messages)
		const includeProfile = turn <= 1 || turn % cfg.profileFrequency === 0
		const messageProvider = ctx?.messageProvider as string | undefined

		log.debug(`recalling for turn ${turn} (profile: ${includeProfile})`)

		try {
			const profile = await client.getProfile(prompt)
			const memoryContext = formatContext(
				includeProfile ? profile.static : [],
				includeProfile ? profile.dynamic : [],
				profile.searchResults,
				cfg.maxRecallResults,
			)

			const containerContext = formatContainerMetadata(cfg, messageProvider)

			const contextParts: string[] = []
			if (memoryContext) contextParts.push(memoryContext)
			if (containerContext) {
				contextParts.push(
					`<supermemory-containers>\n${containerContext}\n</supermemory-containers>`,
				)
			}

			if (contextParts.length === 0) {
				log.debug("no profile data to inject")
				return
			}

			const finalContext = contextParts.join("\n\n")
			log.debug(`injecting context (${finalContext.length} chars, turn ${turn})`)
			return { prependContext: finalContext }
		} catch (err) {
			log.error("recall failed", err)
			return
		}
	}
}
