import { describe, expect, test } from "bun:test"
import { buildAddMemoryMetadata } from "./metadata.ts"

const FIXED = new Date("2026-08-13T15:30:00.000Z")

describe("buildAddMemoryMetadata", () => {
	test("stamps sm_source and captured_at when metadata is omitted", () => {
		expect(buildAddMemoryMetadata(undefined, () => FIXED)).toEqual({
			sm_source: "openclaw",
			captured_at: "2026-08-13T15:30:00.000Z",
		})
	})

	test("preserves caller fields and fills missing captured_at", () => {
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

	test("replaces blank captured_at", () => {
		expect(buildAddMemoryMetadata({ captured_at: "  " }, () => FIXED)).toEqual({
			sm_source: "openclaw",
			captured_at: "2026-08-13T15:30:00.000Z",
		})
	})
})
