import { createHash } from "node:crypto"

export const MEMORY_CATEGORIES = [
	"preference",
	"fact",
	"decision",
	"entity",
	"other",
] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export function detectCategory(text: string): MemoryCategory {
	const lower = text.toLowerCase()
	if (/prefer|like|love|hate|want/i.test(lower)) return "preference"
	if (/decided|will use|going with/i.test(lower)) return "decision"
	if (/\+\d{10,}|@[\w.-]+\.\w+|is called/i.test(lower)) return "entity"
	if (/is|are|has|have/i.test(lower)) return "fact"
	return "other"
}

/**
 * Build a unique document ID for a memory entry.
 * 
 * BREAKING CHANGE: Previously, all facts from a session were stored in a single
 * document (session_{key}), making individual deletion impossible.
 * 
 * Now each fact gets a unique ID based on content hash + timestamp, enabling:
 * - Individual fact deletion via supermemory_forget
 * - Better deduplication (same content = same hash prefix)
 * - Granular memory management
 * 
 * @param sessionKey - The session key for namespace grouping
 * @param content - Optional content to generate unique hash (for standalone facts)
 * @returns Unique document ID
 */
export function buildDocumentId(sessionKey: string, content?: string): string {
	const sanitized = sessionKey
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")

	// If no content provided, return session-based ID (for conversation capture)
	if (!content) {
		return `session_${sanitized}`
	}

	// For explicit fact storage, create unique ID per fact
	const contentHash = createHash("md5").update(content).digest("hex").slice(0, 8)
	const timestamp = Date.now()
	return `fact_${sanitized}_${timestamp}_${contentHash}`
}

/**
 * Build a document ID for session-level conversation capture.
 * Maintains backward compatibility with existing session documents.
 */
export function buildSessionDocumentId(sessionKey: string): string {
	const sanitized = sessionKey
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
	return `session_${sanitized}`
}
