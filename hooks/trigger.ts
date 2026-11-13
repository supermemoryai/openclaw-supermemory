import type { SupermemoryConfig } from "../config.ts"

const INTERACTIVE_TRIGGERS = new Set(["user", "manual"])

// Session-key prefixes, after `agent:<id>:`, of the sessions OpenClaw spawns itself.
const HELPER_SESSION_PREFIXES = [
	"subagent:",
	"helper:incognito-",
	"update-repair:",
	"internal-session-effects:",
	"dreaming-narrative-",
]

// Active-memory recall forks end in `:active-memory:<12 hex>` (memory-core RECALL_SESSION_KEY).
const ACTIVE_MEMORY_SESSION_KEY = /:active-memory:[a-f0-9]{12}$/i

export function isInteractiveTrigger(trigger: string | undefined): boolean {
	// Keep this allowlist in sync with OpenClaw's agent trigger values.
	// "user" and "manual" are interactive; automated triggers such as
	// "heartbeat", "cron", and "memory" must not recall or capture. Missing
	// triggers stay interactive for compatibility with OpenClaw hosts that do not
	// provide ctx.trigger yet.
	return !trigger || INTERACTIVE_TRIGGERS.has(trigger)
}

// Mirrors OpenClaw's isSubagentSessionKey: only the part after `agent:<id>:` is matched, so user-named keys stay interactive.
export function isHelperSessionKey(sessionKey: string): boolean {
	const key = sessionKey.trim().toLowerCase()
	const rest = /^agent:[^:]+:(.*)$/.exec(key)?.[1] ?? key
	return (
		HELPER_SESSION_PREFIXES.some((prefix) => rest.startsWith(prefix)) ||
		ACTIVE_MEMORY_SESSION_KEY.test(key)
	)
}

// Mirrors OpenClaw's isHostGeneratedInputProvenance (src/sessions/input-provenance.ts).
export function isHostGeneratedInput(provenance: unknown): boolean {
	const kind = (provenance as { kind?: unknown } | undefined)?.kind
	return kind === "inter_session" || kind === "internal_system"
}

// Headless runs (openclaw agent exec) carry no channel; hosts without ctx.trigger keep legacy behavior.
export function skippedSessionReason(
	cfg: Pick<SupermemoryConfig, "captureSubagents" | "captureHeadless">,
	ctx: Record<string, unknown> | undefined,
): "subagent" | "headless" | undefined {
	const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : ""
	if (!cfg.captureSubagents && isHelperSessionKey(sessionKey)) {
		return "subagent"
	}
	if (
		!cfg.captureHeadless &&
		ctx?.trigger !== undefined &&
		!ctx.messageProvider &&
		!ctx.channel
	) {
		return "headless"
	}
	return undefined
}
