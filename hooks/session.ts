import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { SupermemoryClient } from "../client.ts"
import { log } from "../logger.ts"

const TAIL_SIZE = 32

type SessionCursor = {
	generation: number
	offset: number
	tail: string[]
}

type SessionDelta = {
	raw: string
	generation: number
	offset: number
	count: number
	commit: () => void
}

function sessionDir(): string {
	return join(homedir(), ".supermemory-openclaw", "sessions")
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex")
}

function cursorPath(sessionId: string): string {
	return join(sessionDir(), `${hash(sessionId)}.json`)
}

function readCursor(sessionId: string): SessionCursor {
	try {
		const cursor = JSON.parse(
			fs.readFileSync(cursorPath(sessionId), "utf-8"),
		) as Partial<SessionCursor>
		if (
			Number.isSafeInteger(cursor.generation) &&
			Number.isSafeInteger(cursor.offset) &&
			Array.isArray(cursor.tail)
		) {
			return {
				generation: cursor.generation as number,
				offset: cursor.offset as number,
				tail: cursor.tail.filter((id) => typeof id === "string"),
			}
		}
	} catch {}
	return { generation: 0, offset: 0, tail: [] }
}

function writeCursor(sessionId: string, cursor: SessionCursor): void {
	fs.mkdirSync(sessionDir(), { recursive: true, mode: 0o700 })
	const file = cursorPath(sessionId)
	const temporary = `${file}.${randomUUID()}.tmp`
	try {
		fs.writeFileSync(temporary, JSON.stringify(cursor), {
			mode: 0o600,
			flag: "wx",
		})
		fs.renameSync(temporary, file)
	} finally {
		fs.rmSync(temporary, { force: true })
	}
}

function messageId(message: unknown): string {
	if (message && typeof message === "object") {
		const { role, timestamp, toolCallId } = message as Record<string, unknown>
		if (typeof role === "string" && typeof timestamp === "number") {
			return hash(
				JSON.stringify([
					role,
					timestamp,
					typeof toolCallId === "string" ? toolCallId : null,
				]),
			)
		}
	}
	return hash(JSON.stringify(message) ?? "")
}

function resumeIndex(ids: string[], tail: string[]): number {
	for (let i = tail.length - 1; i >= 0; i--) {
		const index = ids.lastIndexOf(tail[i])
		if (index >= 0) return index + 1
	}
	return -1
}

function buildSessionDelta(
	sessionId: string,
	messages: readonly unknown[],
): SessionDelta | null {
	const previous = readCursor(sessionId)
	const ids = messages.map(messageId)
	let generation = previous.generation
	let offset = previous.offset
	let tail = previous.tail
	let start = 0
	if (offset > 0) {
		start = resumeIndex(ids, tail)
		if (start < 0) {
			generation += 1
			offset = 0
			tail = []
			start = 0
		}
	}
	if (messages.length <= start) return null

	const sent = messages.slice(start)
	const raw = `${sent.map((message) => JSON.stringify(message)).join("\n")}\n`
	const cursor: SessionCursor = {
		generation,
		offset: offset + sent.length,
		tail: [...tail, ...ids.slice(start)].slice(-TAIL_SIZE),
	}
	return {
		raw,
		generation,
		offset,
		count: sent.length,
		commit: () => writeCursor(sessionId, cursor),
	}
}

const pending = new Map<string, Promise<boolean>>()

async function sendSession(options: {
	client: SupermemoryClient
	sessionId: string
	messages: readonly unknown[]
	metadata?: Record<string, string | number | boolean>
	entityContext?: string
}): Promise<boolean> {
	const { client, sessionId } = options
	try {
		const delta = buildSessionDelta(sessionId, options.messages)
		if (!delta) return true
		await client.addSession(
			delta.raw,
			sessionId,
			{ generation: delta.generation, offset: delta.offset },
			options.metadata,
			options.entityContext,
		)
		delta.commit()
		log.debug(
			`session ${sessionId} sent ${delta.count} messages (g${delta.generation}, offset ${delta.offset}, ${delta.raw.length} chars)`,
		)
		return true
	} catch (err) {
		log.error("session capture failed", err)
		return false
	}
}

export function captureSession(
	options: Parameters<typeof sendSession>[0],
): Promise<boolean> {
	const previous = pending.get(options.sessionId) ?? Promise.resolve(true)
	const run = previous.then(() => sendSession(options))
	pending.set(options.sessionId, run)
	void run.then(() => {
		if (pending.get(options.sessionId) === run)
			pending.delete(options.sessionId)
	})
	return run
}
