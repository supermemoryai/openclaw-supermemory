import type { SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"
import { buildDocumentId } from "../memory.ts"

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

export function buildCaptureHandler(
	client: SupermemoryClient,
	cfg: SupermemoryConfig,
	getSessionKey: () => string | undefined,
) {
	return async (event: Record<string, unknown>) => {
		if (
			!event.success ||
			!Array.isArray(event.messages) ||
			event.messages.length === 0
		)
			return

		const lastTurn = getLastTurn(event.messages)

		const texts: string[] = []
		for (const msg of lastTurn) {
			if (!msg || typeof msg !== "object") continue
			const msgObj = msg as Record<string, unknown>
			const role = msgObj.role
			if (role !== "user" && role !== "assistant") continue

			const content = msgObj.content

			const parts: string[] = []

			if (typeof content === "string") {
				parts.push(content)
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (!block || typeof block !== "object") continue
					const b = block as Record<string, unknown>
					if (b.type === "text" && typeof b.text === "string") {
						parts.push(b.text)
					}
				}
			}

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
			)
		} catch (err) {
			log.error("capture failed", err)
		}
	}
}
