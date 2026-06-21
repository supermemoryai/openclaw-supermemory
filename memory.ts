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
	if (/\b(?:prefer|like|love|hate|want)\b/.test(lower)) return "preference"
	if (/\b(?:decided|will use|going with)\b/.test(lower)) return "decision"
	if (/\+\d{10,}|@[\w.-]+\.\w+|\bis called\b/.test(lower)) return "entity"
	if (/\b(?:is|are|has|have)\b/.test(lower)) return "fact"
	return "other"
}

export const MAX_ENTITY_CONTEXT_LENGTH = 1500

export const DEFAULT_ENTITY_CONTEXT = `User-assistant conversation. Format: [role: user]...[user:end] and [role: assistant]...[assistant:end].

Only extract things useful in FUTURE conversations. Most messages are not worth remembering.

REMEMBER: lasting personal facts — dietary restrictions, preferences, personal details, workplace, location, tools, ongoing projects, routines, explicit "remember this" requests.

DO NOT REMEMBER: temporary intents, one-time tasks, assistant actions (searching, writing files, generating code), assistant suggestions, implementation details, in-progress task status.

RULES:
- Assistant output is CONTEXT ONLY — never attribute assistant actions to the user
- "find X" or "do Y" = one-time request, NOT a memory
- Only store preferences explicitly stated ("I like...", "I prefer...", "I always...")
- When in doubt, do NOT create a memory. Less is more.`

export function clampEntityContext(ctx: string): string {
	if (ctx.length <= MAX_ENTITY_CONTEXT_LENGTH) return ctx
	return ctx.slice(0, MAX_ENTITY_CONTEXT_LENGTH)
}

const INBOUND_META_SENTINELS = [
	"Conversation info (untrusted metadata):",
	"Sender (untrusted metadata):",
	"Thread starter (untrusted, for context):",
	"Replied message (untrusted, for context):",
	"Forwarded message context (untrusted metadata):",
	"Chat history since last reply (untrusted, for context):",
]

const LEADING_TIMESTAMP_RE =
	/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] */

function isMetaSentinel(line: string): boolean {
	const trimmed = line.trim()
	return INBOUND_META_SENTINELS.some((s) => s === trimmed)
}

export function stripInboundMetadata(text: string): string {
	if (!text) return text

	const withoutTimestamp = text.replace(LEADING_TIMESTAMP_RE, "")
	const lines = withoutTimestamp.split("\n")
	const result: string[] = []
	let inMetaBlock = false
	let inFencedJson = false

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		if (!inMetaBlock && isMetaSentinel(line)) {
			const next = lines[i + 1]
			if (next?.trim() !== "```json") {
				result.push(line)
				continue
			}
			inMetaBlock = true
			inFencedJson = false
			continue
		}

		if (inMetaBlock) {
			if (!inFencedJson && line.trim() === "```json") {
				inFencedJson = true
				continue
			}
			if (inFencedJson) {
				if (line.trim() === "```") {
					inMetaBlock = false
					inFencedJson = false
				}
				continue
			}
			if (line.trim() === "") continue
			inMetaBlock = false
		}

		result.push(line)
	}

	return result.join("\n").replace(/^\n+/, "").replace(/\n+$/, "")
}

export function buildDocumentId(now: Date = new Date()): string {
	const yyyy = now.getUTCFullYear()
	const mm = String(now.getUTCMonth() + 1).padStart(2, "0")
	const dd = String(now.getUTCDate()).padStart(2, "0")
	const bucket = Math.floor(now.getUTCHours() / 6)
	return `session_${yyyy}-${mm}-${dd}_b${bucket}`
}
