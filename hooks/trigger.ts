const INTERACTIVE_TRIGGERS = new Set(["user", "manual"])

export function isInteractiveTrigger(trigger: string | undefined): boolean {
	// Keep this allowlist in sync with OpenClaw's agent trigger values.
	// "user" and "manual" are interactive; automated triggers such as
	// "heartbeat", "cron", "memory", and "overflow" should skip memory hooks.
	// Undefined preserves legacy behavior for OpenClaw versions that do not
	// provide ctx.trigger yet.
	return !trigger || INTERACTIVE_TRIGGERS.has(trigger)
}
