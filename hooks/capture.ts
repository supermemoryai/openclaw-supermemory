import type { SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"
import { buildDocumentId } from "../memory.ts"

const SKIPPED_PROVIDERS = ["exec-event", "cron-event", "heartbeat"]
const MEMORY_TOOL_PREFIX = "supermemory_"
const MEMORY_COMMAND_PREFIXES = ["/remember", "/recall"]
const MEMORY_TOOL_RESPONSE_PATTERNS = [
	/^Stored:\s*"/i,
	/^Forgot:\s*"/i,
	/^Found \d+ memories:/i,
	/^No relevant memories found\.?$/i,
	/^No matching memory found to forget\.?$/i,
	/^Memory forgotten\.?$/i,
	/^Provide a query or memoryId to forget\.?$/i,
]

function getLastTurn(messages: unknown[]): unknown[] {
	let lastUserIdx = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (
			msg &&
			typeof msg === "object" &&
			(msg as Record<string, unknown>).role === "user"
		) {
			lastUserIdx = i
			break
		}
	}
	return lastUserIdx >= 0 ? messages.slice(lastUserIdx) : messages
}

function collectTextParts(content: unknown): string[] {
	const parts: string[] = []

	if (typeof content === "string") {
		parts.push(content)
		return parts
	}

	if (!Array.isArray(content)) return parts

	for (const block of content) {
		if (!block || typeof block !== "object") continue
		const b = block as Record<string, unknown>
		if (b.type === "text" && typeof b.text === "string") {
			parts.push(b.text)
		}
	}

	return parts
}

function messageReferencesSupermemoryTool(
	msgObj: Record<string, unknown>,
): boolean {
	for (const key of ["name", "toolName"]) {
		if (
			typeof msgObj[key] === "string" &&
			(msgObj[key] as string).startsWith(MEMORY_TOOL_PREFIX)
		) {
			return true
		}
	}

	const content = msgObj.content
	if (!Array.isArray(content)) return false

	for (const block of content) {
		if (!block || typeof block !== "object") continue
		const b = block as Record<string, unknown>
		if (typeof b.name === "string" && b.name.startsWith(MEMORY_TOOL_PREFIX)) {
			return true
		}
		if (
			typeof b.toolName === "string" &&
			b.toolName.startsWith(MEMORY_TOOL_PREFIX)
		) {
			return true
		}
	}

	return false
}

export function isSupermemoryManagementTurn(messages: unknown[]): boolean {
	for (const msg of messages) {
		if (!msg || typeof msg !== "object") continue
		const msgObj = msg as Record<string, unknown>

		if (messageReferencesSupermemoryTool(msgObj)) {
			return true
		}

		for (const text of collectTextParts(msgObj.content)) {
			const trimmed = text.trim()
			const lower = trimmed.toLowerCase()
			if (
				MEMORY_COMMAND_PREFIXES.some(
					(prefix) => lower === prefix || lower.startsWith(`${prefix} `),
				)
			) {
				return true
			}
			if (
				MEMORY_TOOL_RESPONSE_PATTERNS.some((pattern) => pattern.test(trimmed))
			) {
				return true
			}
		}
	}

	return false
}

export function buildCaptureHandler(
	client: SupermemoryClient,
	cfg: SupermemoryConfig,
	getSessionKey: () => string | undefined,
) {
	return async (
		event: Record<string, unknown>,
		ctx: Record<string, unknown>,
	) => {
		log.info(
			`agent_end fired: provider="${ctx.messageProvider}" success=${event.success}`,
		)
		const provider = ctx.messageProvider as string
		if (SKIPPED_PROVIDERS.includes(provider)) {
			return
		}

		if (
			!event.success ||
			!Array.isArray(event.messages) ||
			event.messages.length === 0
		)
			return

		const lastTurn = getLastTurn(event.messages)
		if (isSupermemoryManagementTurn(lastTurn)) {
			log.debug("capture: skipping supermemory management turn")
			return
		}

		const texts: string[] = []
		for (const msg of lastTurn) {
			if (!msg || typeof msg !== "object") continue
			const msgObj = msg as Record<string, unknown>
			const role = msgObj.role
			if (role !== "user" && role !== "assistant") continue

			const parts = collectTextParts(msgObj.content)

			if (parts.length > 0) {
				texts.push(`[role: ${role}]\n${parts.join("\n")}\n[${role}:end]`)
			}
		}

		const captured =
			cfg.captureMode === "all"
				? texts
						.map((t) =>
							t
								.replace(
									/<supermemory-context>[\s\S]*?<\/supermemory-context>\s*/g,
									"",
								)
								.replace(
									/<supermemory-containers>[\s\S]*?<\/supermemory-containers>\s*/g,
									"",
								)
								.trim(),
						)
						.filter((t) => t.length >= 10)
				: texts

		if (captured.length === 0) return

		const content = captured.join("\n\n")
		const sk = getSessionKey()
		const customId = sk ? buildDocumentId(sk) : undefined

		log.debug(
			`capturing ${captured.length} texts (${content.length} chars) → ${customId ?? "no-session-key"}`,
		)

		try {
			await client.addMemory(
				content,
				{ source: "openclaw", timestamp: new Date().toISOString() },
				customId,
				undefined,
				cfg.entityContext,
			)
		} catch (err) {
			log.error("capture failed", err)
		}
	}
}
