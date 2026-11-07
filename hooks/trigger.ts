import type { SupermemoryConfig } from "../config.ts"

const INTERACTIVE_TRIGGERS = new Set(["user", "manual"])

// OpenClaw session-key segments for subagents and host-run helper sessions.
const HELPER_SESSION_KEY =
	/(^|:)(subagent|active-memory|helper|update-repair|internal-session-effects):|(^|:)dreaming-narrative-/i

export function isInteractiveTrigger(trigger: string | undefined): boolean {
	// Keep this allowlist in sync with OpenClaw's agent trigger values.
	// "user" and "manual" are interactive; automated triggers such as
	// "heartbeat", "cron", "memory", and "overflow" should skip memory hooks.
	// Undefined preserves legacy behavior for OpenClaw versions that do not
	// provide ctx.trigger yet.
	return !trigger || INTERACTIVE_TRIGGERS.has(trigger)
}

// Mirrors OpenClaw's isHostGeneratedInputProvenance (src/sessions/input-provenance.ts).
function isHostGeneratedInput(provenance: unknown): boolean {
	const kind = (provenance as { kind?: unknown } | undefined)?.kind
	return kind === "inter_session" || kind === "internal_system"
}

// Headless runs (openclaw agent exec) carry no channel; hosts without ctx.trigger keep legacy behavior.
export function skippedSessionReason(
	cfg: Pick<SupermemoryConfig, "captureSubagents" | "captureHeadless">,
	ctx: Record<string, unknown> | undefined,
	provenance: unknown,
): "subagent" | "headless" | undefined {
	const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : ""
	if (
		!cfg.captureSubagents &&
		(HELPER_SESSION_KEY.test(sessionKey) || isHostGeneratedInput(provenance))
	) {
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
