import { describe, expect, test } from "bun:test"
import { buildAddMemoryMetadata } from "./add-metadata.ts"

const FIXED = new Date("2026-08-13T15:30:00.000Z")

describe("buildAddMemoryMetadata", () => {
	test("stamps sm_source and captured_at when metadata is omitted", () => {
		expect(buildAddMemoryMetadata(undefined, () => FIXED)).toEqual({
			sm_source: "openclaw",
			captured_at: "2026-08-13T15:30:00.000Z",
		})
	})

	test("preserves caller fields under sm_source and captured_at", () => {
		expect(
			buildAddMemoryMetadata(
				{ type: "preference", source: "openclaw_command" },
				() => FIXED,
			),
		).toEqual({
			sm_source: "openclaw",
			type: "preference",
			source: "openclaw_command",
			captured_at: "2026-08-13T15:30:00.000Z",
		})
	})

	test("keeps an explicit captured_at", () => {
		expect(
			buildAddMemoryMetadata(
				{ captured_at: "2026-07-01T00:00:00.000Z" },
				() => FIXED,
			),
		).toEqual({
			sm_source: "openclaw",
			captured_at: "2026-07-01T00:00:00.000Z",
		})
	})

	test("promotes legacy timestamp when captured_at is missing", () => {
		expect(
			buildAddMemoryMetadata(
				{ timestamp: "2026-08-09T12:00:00.000Z" },
				() => FIXED,
			),
		).toEqual({
			sm_source: "openclaw",
			timestamp: "2026-08-09T12:00:00.000Z",
			captured_at: "2026-08-09T12:00:00.000Z",
		})
	})

	test("ignores blank captured_at / timestamp and falls back to now", () => {
		expect(
			buildAddMemoryMetadata(
				{ captured_at: "  ", timestamp: "" },
				() => FIXED,
			),
		).toEqual({
			sm_source: "openclaw",
			captured_at: "2026-08-13T15:30:00.000Z",
			timestamp: "",
		})
	})

	test("prefers captured_at over timestamp", () => {
		expect(
			buildAddMemoryMetadata(
				{
					captured_at: "2026-01-01T00:00:00.000Z",
					timestamp: "2025-01-01T00:00:00.000Z",
				},
				() => FIXED,
			),
		).toEqual({
			sm_source: "openclaw",
			captured_at: "2026-01-01T00:00:00.000Z",
			timestamp: "2025-01-01T00:00:00.000Z",
		})
	})
})
