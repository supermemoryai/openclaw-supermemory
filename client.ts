import Supermemory from "supermemory"
import {
	sanitizeContent,
	validateApiKeyFormat,
	validateContainerTag,
} from "./lib/validate.js"
import { log } from "./logger.ts"
import { clampEntityContext } from "./memory.ts"

export type SearchResult = {
	id: string
	content: string
	memory?: string
	similarity?: number
	metadata?: Record<string, unknown>
}

export type ProfileSearchResult = {
	memory?: string
	updatedAt?: string
	similarity?: number
	[key: string]: unknown
}

export type ProfileResult = {
	static: string[]
	dynamic: string[]
	searchResults: ProfileSearchResult[]
}

function limitText(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text
}

export function normalizeMemoryText(text: string | undefined): string {
	return sanitizeContent(text ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
}

function getQueryTokens(normalizedQuery: string): string[] {
	if (!normalizedQuery) return []
	return normalizedQuery.split(/\s+/).filter(Boolean)
}

function getTokenCoverage(
	normalizedText: string,
	queryTokens: string[],
): number {
	if (queryTokens.length === 0) return 0
	const matched = queryTokens.filter((token) =>
		normalizedText.includes(token),
	).length
	return matched / queryTokens.length
}

export function findExactContentMatch(
	results: SearchResult[],
	query: string,
): SearchResult | undefined {
	const normalizedQuery = normalizeMemoryText(query)
	if (!normalizedQuery) return undefined

	return results.find(
		(result) =>
			normalizeMemoryText(result.content || result.memory) === normalizedQuery,
	)
}

export function rerankSearchResults(
	query: string,
	results: SearchResult[],
): SearchResult[] {
	const normalizedQuery = normalizeMemoryText(query)
	if (!normalizedQuery || results.length <= 1) return results

	const queryTokens = getQueryTokens(normalizedQuery)

	return [...results]
		.map((result, index) => {
			const normalizedContent = normalizeMemoryText(
				result.content || result.memory,
			)
			return {
				index,
				result,
				exact: normalizedContent === normalizedQuery ? 1 : 0,
				contains: normalizedContent.includes(normalizedQuery) ? 1 : 0,
				tokenCoverage: getTokenCoverage(normalizedContent, queryTokens),
				similarity: result.similarity ?? 0,
				contentLength: normalizedContent.length || Number.MAX_SAFE_INTEGER,
			}
		})
		.sort((a, b) => {
			if (b.exact !== a.exact) return b.exact - a.exact
			if (b.contains !== a.contains) return b.contains - a.contains
			if (b.tokenCoverage !== a.tokenCoverage) {
				return b.tokenCoverage - a.tokenCoverage
			}
			if (b.similarity !== a.similarity) return b.similarity - a.similarity
			if (a.contentLength !== b.contentLength) {
				return a.contentLength - b.contentLength
			}
			return a.index - b.index
		})
		.map(({ result }) => result)
}

export class SupermemoryClient {
	private client: Supermemory
	private containerTag: string

	constructor(apiKey: string, containerTag: string) {
		const keyCheck = validateApiKeyFormat(apiKey)
		if (!keyCheck.valid) {
			throw new Error(`invalid API key: ${keyCheck.reason}`)
		}

		const tagCheck = validateContainerTag(containerTag)
		if (!tagCheck.valid) {
			log.warn(`container tag warning: ${tagCheck.reason}`)
		}

		this.client = new Supermemory({ apiKey })
		this.containerTag = containerTag
		log.info(`initialized (container: ${containerTag})`)
	}

	async addMemory(
		content: string,
		metadata?: Record<string, string | number | boolean>,
		customId?: string,
		containerTag?: string,
		entityContext?: string,
	): Promise<{ id: string }> {
		const cleaned = sanitizeContent(content)
		const tag = containerTag ?? this.containerTag

		log.debugRequest("add", {
			contentLength: cleaned.length,
			customId,
			metadata,
			containerTag: tag,
		})

		const clampedCtx = entityContext
			? clampEntityContext(entityContext)
			: undefined

		const result = await this.client.add({
			content: cleaned,
			containerTag: tag,
			...(metadata && { metadata }),
			...(customId && { customId }),
			...(clampedCtx && { entityContext: clampedCtx }),
		})

		log.debugResponse("add", { id: result.id })
		return { id: result.id }
	}

	async search(
		query: string,
		limit = 5,
		containerTag?: string,
	): Promise<SearchResult[]> {
		const cleanedQuery = sanitizeContent(query)
		const tag = containerTag ?? this.containerTag

		log.debugRequest("search.memories", {
			query: cleanedQuery,
			limit,
			containerTag: tag,
		})

		const response = await this.client.search.memories({
			q: cleanedQuery,
			containerTag: tag,
			limit,
			rerank: true,
			rewriteQuery: false,
		})

		const rawResults: SearchResult[] = (response.results ?? []).map((r) => ({
			id: r.id,
			content: r.memory ?? "",
			memory: r.memory,
			similarity: r.similarity,
			metadata: r.metadata ?? undefined,
		}))
		const results = rerankSearchResults(cleanedQuery, rawResults)

		log.debugResponse("search.memories", { count: results.length })
		return results
	}

	async getProfile(
		query?: string,
		containerTag?: string,
	): Promise<ProfileResult> {
		const tag = containerTag ?? this.containerTag

		log.debugRequest("profile", { containerTag: tag, query })

		const response = await this.client.profile({
			containerTag: tag,
			...(query && { q: query }),
		})

		log.debugResponse("profile.raw", response)

		const result: ProfileResult = {
			static: response.profile?.static ?? [],
			dynamic: response.profile?.dynamic ?? [],
			searchResults: (response.searchResults?.results ??
				[]) as ProfileSearchResult[],
		}

		log.debugResponse("profile", {
			staticCount: result.static.length,
			dynamicCount: result.dynamic.length,
			searchCount: result.searchResults.length,
		})
		return result
	}

	async deleteMemory(
		id: string,
		containerTag?: string,
	): Promise<{ id: string; forgotten: boolean }> {
		const tag = containerTag ?? this.containerTag

		log.debugRequest("memories.delete", {
			id,
			containerTag: tag,
		})
		const result = await this.client.memories.forget({
			containerTag: tag,
			id,
		})
		log.debugResponse("memories.delete", result)
		return result
	}

	async forgetByQuery(
		query: string,
		containerTag?: string,
	): Promise<{ success: boolean; message: string }> {
		const cleanedQuery = sanitizeContent(query)
		log.debugRequest("forgetByQuery", { query: cleanedQuery, containerTag })

		const results = await this.search(cleanedQuery, 10, containerTag)
		if (results.length === 0) {
			return { success: false, message: "No matching memory found to forget." }
		}

		const target = findExactContentMatch(results, cleanedQuery) ?? results[0]
		const deleted = await this.deleteMemory(target.id, containerTag)

		const preview = limitText(target.content || target.memory || "", 100)
		if (!deleted.forgotten) {
			return {
				success: false,
				message: `Unable to confirm forgetting: "${preview}"`,
			}
		}

		return { success: true, message: `Forgot: "${preview}"` }
	}

	async wipeAllMemories(): Promise<{ deletedCount: number }> {
		log.debugRequest("wipe", { containerTag: this.containerTag })

		const allIds: string[] = []
		let page = 1

		while (true) {
			const response = await this.client.documents.list({
				containerTags: [this.containerTag],
				limit: 100,
				page,
			})

			if (!response.memories || response.memories.length === 0) break

			for (const doc of response.memories) {
				if (doc.id) allIds.push(doc.id)
			}

			if (
				!response.pagination?.totalPages ||
				page >= response.pagination.totalPages
			)
				break
			page++
		}

		if (allIds.length === 0) {
			log.debug("wipe: no documents found")
			return { deletedCount: 0 }
		}

		log.debug(`wipe: found ${allIds.length} documents, deleting in batches`)

		let deletedCount = 0
		for (let i = 0; i < allIds.length; i += 100) {
			const batch = allIds.slice(i, i + 100)
			await this.client.documents.deleteBulk({ ids: batch })
			deletedCount += batch.length
		}

		log.debugResponse("wipe", { deletedCount })
		return { deletedCount }
	}

	getContainerTag(): string {
		return this.containerTag
	}
}
