import { type RequestOptions, Supermemory } from "supermemory"
import LegacySupermemory from "supermemory-legacy"
import { type ApiVersion, resolveApiVersion, resolveBaseUrl } from "./config.ts"
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
	updatedAt?: string
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

export class SupermemoryClient {
	private client: Supermemory
	private legacy: LegacySupermemory | undefined
	private containerTag: string

	constructor(
		apiKey: string,
		containerTag: string,
		baseUrl?: string,
		apiVersion?: ApiVersion,
	) {
		const keyCheck = validateApiKeyFormat(apiKey)
		if (!keyCheck.valid) {
			throw new Error(`invalid API key: ${keyCheck.reason}`)
		}

		const tagCheck = validateContainerTag(containerTag)
		if (!tagCheck.valid) {
			log.warn(`container tag warning: ${tagCheck.reason}`)
		}

		const endpoint = resolveBaseUrl(baseUrl)
		const version = resolveApiVersion(apiVersion, endpoint)
		this.client = new Supermemory({
			apiKey,
			baseUrl: endpoint,
			headers: { "x-sm-source": "openclaw" },
			timeoutInSeconds: 60,
			maxRetries: 2,
		})
		if (version === "legacy") {
			this.legacy = new LegacySupermemory({
				apiKey,
				baseURL: endpoint,
				defaultHeaders: { "x-sm-source": "openclaw" },
				timeout: 60_000,
				maxRetries: 2,
			})
		}
		this.containerTag = containerTag
		log.info(
			`initialized (container: ${containerTag}, endpoint: ${new URL(endpoint).origin}, API: ${version})`,
		)
	}

	private requestOptions(): RequestOptions {
		return { timeoutInSeconds: 60, maxRetries: 2 }
	}

	async addMemory(
		content: string,
		metadata?: Record<string, string | number | boolean>,
		customId?: string,
		containerTag?: string,
		entityContext?: string,
	): Promise<{ id: string; status: string }> {
		const cleaned = sanitizeContent(content)
		const tag = containerTag ?? this.containerTag

		const mergedMetadata: Record<string, string | number | boolean> = {
			sm_source: "openclaw",
			...(metadata ?? {}),
		}

		log.debugRequest("add", {
			contentLength: cleaned.length,
			customId,
			metadata: mergedMetadata,
			containerTag: tag,
		})

		const clampedCtx = entityContext
			? clampEntityContext(entityContext)
			: undefined

		const result = this.legacy
			? await this.legacy.add({
					content: cleaned,
					containerTag: tag,
					metadata: mergedMetadata,
					...(customId && { customId }),
					...(clampedCtx && { entityContext: clampedCtx }),
				})
			: await this.client.add(
					tag,
					{
						content: cleaned,
						metadata: mergedMetadata,
						...(customId && { id: customId }),
						...(clampedCtx && { supportingContext: clampedCtx }),
						taskType: "memory",
						dreaming: "dynamic",
					},
					this.requestOptions(),
				)

		if (
			typeof result.id !== "string" ||
			!result.id.trim() ||
			typeof result.status !== "string" ||
			!result.status.trim() ||
			result.status === "failed" ||
			(!this.legacy &&
				![
					"queued",
					"extracting",
					"chunking",
					"embedding",
					"indexing",
					"done",
				].includes(result.status))
		) {
			throw new Error(
				"Memory store did not return a valid processing acceptance",
			)
		}

		log.debugResponse("add", { id: result.id, status: result.status })

		return { id: result.id, status: result.status }
	}

	async search(
		query: string,
		limit = 5,
		containerTag?: string,
	): Promise<SearchResult[]> {
		const tag = containerTag ?? this.containerTag

		log.debugRequest("search.memories", {
			query,
			limit,
			containerTag: tag,
		})

		const response = this.legacy
			? await this.legacy.search.memories({
					q: query,
					containerTag: tag,
					limit,
				})
			: await this.client.search(
					tag,
					{
						query,
						limit,
						searchMode: "memories",
						threshold: 0.6,
						rerank: "none",
						rewriteQuery: false,
					},
					this.requestOptions(),
				)

		const results: SearchResult[] = (response.results ?? []).map((r) => {
			const system = "system" in r ? r.system : undefined
			return {
				id: r.id,
				content: r.memory ?? "",
				memory: r.memory,
				similarity: r.similarity,
				metadata: r.metadata ?? undefined,
				updatedAt: system?.updatedAt,
			}
		})

		log.debugResponse("search.memories", { count: results.length })
		return results
	}

	async getProfile(
		query?: string,
		containerTag?: string,
	): Promise<ProfileResult> {
		const tag = containerTag ?? this.containerTag

		log.debugRequest("profile", { containerTag: tag, query })

		let result: ProfileResult
		if (this.legacy) {
			const response = await this.legacy.profile({
				containerTag: tag,
				...(query && { q: query }),
			})
			result = {
				static: response.profile?.static ?? [],
				dynamic: response.profile?.dynamic ?? [],
				searchResults: (response.searchResults?.results ??
					[]) as ProfileSearchResult[],
			}
		} else {
			const [response, searchResults] = await Promise.all([
				this.client.profile(tag, {}, this.requestOptions()),
				query ? this.search(query, 10, tag) : Promise.resolve([]),
			])
			result = {
				static: (response.profile?.static ?? []).map((fact) => fact.memory),
				dynamic: (response.profile?.dynamic ?? []).map((fact) => fact.memory),
				searchResults,
			}
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
		if (!this.legacy) {
			const response = await this.client.memories.forget(
				tag,
				{ ids: [id] },
				this.requestOptions(),
			)
			if (
				response.count !== 1 ||
				!Array.isArray(response.errors) ||
				response.errors.length !== 0 ||
				!Array.isArray(response.matches) ||
				response.matches.length !== 1 ||
				!response.matches[0] ||
				typeof response.matches[0] !== "object" ||
				typeof response.matches[0].id !== "string" ||
				!response.matches[0].id.trim() ||
				typeof response.matches[0].memory !== "string" ||
				response.matches[0].id !== id
			) {
				throw new Error("Memory forget did not confirm the requested ID")
			}
			return { id, forgotten: true }
		}
		const result = await this.legacy.memories.forget({ containerTag: tag, id })
		log.debugResponse("memories.delete", result)
		return result
	}

	async forgetByQuery(
		query: string,
		containerTag?: string,
	): Promise<{ success: boolean; message: string }> {
		log.debugRequest("forgetByQuery", { query, containerTag })

		const results = await this.search(query, 5, containerTag)
		if (results.length === 0) {
			return { success: false, message: "No matching memory found to forget." }
		}

		const target = results[0]
		await this.deleteMemory(target.id, containerTag)

		const preview = limitText(target.content || target.memory || "", 100)
		return { success: true, message: `Forgot: "${preview}"` }
	}

	async wipeAllMemories(): Promise<{ deletedCount: number }> {
		log.debugRequest("wipe", { containerTag: this.containerTag })

		const allIds: string[] = []
		const uniqueIds = new Set<string>()
		let totalItems: number | undefined
		let page = 1

		while (true) {
			const response = this.legacy
				? await this.legacy.documents.list({
						containerTags: [this.containerTag],
						limit: 100,
						page,
					})
				: await this.client.list(
						this.containerTag,
						"documents",
						{ limit: 100, page, sort: "createdAt", order: "desc" },
						this.requestOptions(),
					)
			if (!this.legacy && !("documents" in response)) {
				throw new Error("Document list did not return documents; wipe stopped")
			}
			const documents =
				"documents" in response ? response.documents : response.memories
			if ("documents" in response) {
				const pagination = response.pagination
				const limit = 100
				if (
					!Array.isArray(documents) ||
					!pagination ||
					pagination.currentPage !== page ||
					(pagination.limit !== undefined && pagination.limit !== limit) ||
					!Number.isSafeInteger(pagination.totalItems) ||
					pagination.totalItems < 0 ||
					!Number.isSafeInteger(pagination.totalPages) ||
					pagination.totalPages < 0 ||
					(pagination.totalItems === 0
						? pagination.totalPages > 1
						: pagination.totalPages !==
							Math.ceil(pagination.totalItems / limit)) ||
					documents.length !==
						Math.min(
							limit,
							Math.max(0, pagination.totalItems - (page - 1) * limit),
						) ||
					(totalItems !== undefined && pagination.totalItems !== totalItems) ||
					documents.some(
						(doc) =>
							!doc ||
							typeof doc !== "object" ||
							typeof doc.id !== "string" ||
							!doc.id.trim(),
					)
				) {
					throw new Error(
						"Document list did not return a valid page; wipe stopped",
					)
				}
				totalItems = pagination.totalItems
				for (const doc of documents) {
					if (uniqueIds.has(doc.id)) {
						throw new Error(
							"Document list returned duplicate IDs; wipe stopped",
						)
					}
					uniqueIds.add(doc.id)
				}
			}
			if (!documents || documents.length === 0) break

			for (const doc of documents) {
				if (doc.id) allIds.push(doc.id)
			}

			if (
				!response.pagination?.totalPages ||
				page >= response.pagination.totalPages
			)
				break
			page++
		}
		if (!this.legacy && uniqueIds.size !== totalItems) {
			throw new Error("Document list was incomplete; wipe stopped")
		}

		if (allIds.length === 0) {
			log.debug("wipe: no documents found")
			return { deletedCount: 0 }
		}

		log.debug(`wipe: found ${allIds.length} documents, deleting in batches`)

		let deletedCount = 0
		for (let i = 0; i < allIds.length; i += 100) {
			const batch = allIds.slice(i, i + 100)
			const response = this.legacy
				? await this.legacy.documents.deleteBulk({ ids: batch })
				: await this.client.documents.delete(
						this.containerTag,
						{ ids: batch },
						this.requestOptions(),
					)
			const count = "count" in response ? response.count : response.deletedCount
			if (
				count !== batch.length ||
				("count" in response && !Array.isArray(response.errors)) ||
				(response.errors?.length ?? 0) !== 0 ||
				("success" in response && !response.success)
			) {
				throw new Error(
					`Document wipe was incomplete (${deletedCount + (Number.isInteger(count) && count >= 0 && count <= batch.length ? count : 0)} confirmed deletions); successful deletions are not rolled back`,
				)
			}
			deletedCount += count
		}

		log.debugResponse("wipe", { deletedCount })
		return { deletedCount }
	}

	getContainerTag(): string {
		return this.containerTag
	}
}
