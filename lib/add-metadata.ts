export type MemoryMetadata = Record<string, string | number | boolean>

/**
 * Merge caller metadata with OpenClaw defaults for `add()`.
 *
 * Always sets `sm_source` and ensures an ISO-8601 `captured_at` so extraction
 * can anchor invented calendar dates to a real capture time (see #61).
 *
 * Preference order for the stamp: explicit `captured_at` → non-empty `timestamp`
 * (legacy callers) → `now()`.
 */
export function buildAddMemoryMetadata(
	metadata?: MemoryMetadata,
	now: () => Date = () => new Date(),
): MemoryMetadata {
	const merged: MemoryMetadata = {
		sm_source: "openclaw",
		...(metadata ?? {}),
	}

	const fromCapturedAt = readIsoField(merged.captured_at)
	if (fromCapturedAt) {
		merged.captured_at = fromCapturedAt
		return merged
	}

	const fromTimestamp = readIsoField(merged.timestamp)
	merged.captured_at = fromTimestamp ?? now().toISOString()
	return merged
}

function readIsoField(value: unknown): string | null {
	if (typeof value !== "string") return null
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}
