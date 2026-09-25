export type MemoryMetadata = Record<string, string | number | boolean>

/** Merge caller metadata with OpenClaw defaults for `add()`. */
export function buildAddMemoryMetadata(
	metadata?: MemoryMetadata,
	now: () => Date = () => new Date(),
): MemoryMetadata {
	const merged: MemoryMetadata = {
		sm_source: "openclaw",
		...(metadata ?? {}),
	}

	// Give extraction a real capture-time anchor (issue #61). Callers can still
	// pass an explicit `captured_at` (e.g. when replaying older events).
	const existing = merged.captured_at
	if (typeof existing !== "string" || !existing.trim()) {
		merged.captured_at = now().toISOString()
	}

	return merged
}
