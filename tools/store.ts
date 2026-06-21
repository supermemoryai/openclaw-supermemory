import { Type } from "@sinclair/typebox"
import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import type { SupermemoryClient } from "../client.ts"
import type { SupermemoryConfig } from "../config.ts"
import { log } from "../logger.ts"
import {
	buildDocumentId,
	detectCategory,
	MEMORY_CATEGORIES,
} from "../memory.ts"

export function registerStoreTool(
	api: OpenClawPluginApi,
	client: SupermemoryClient,
	cfg: SupermemoryConfig,
	toolName = "supermemory_store",
): void {
	api.registerTool(
		{
			name: toolName,
			label: "Memory Store",
			description: "Save important information to long-term memory.",
			parameters: Type.Object({
				text: Type.String({ description: "Information to remember" }),
				category: Type.Optional(
					Type.Unsafe<string>({ type: "string", enum: [...MEMORY_CATEGORIES] }),
				),
				containerTag: Type.Optional(
					Type.String({
						description:
							"Optional container tag to store the memory in a specific container",
					}),
				),
			}),
			async execute(
				_toolCallId: string,
				params: { text: string; category?: string; containerTag?: string },
			) {
				const category = params.category ?? detectCategory(params.text)
				const customId = buildDocumentId()

				log.debug(
					`store tool: category="${category}" customId="${customId}" containerTag="${params.containerTag ?? "default"}"`,
				)

				const { status } = await client.addMemory(
					params.text,
					{ type: category, sm_capture_mode: "tool" },
					customId,
					params.containerTag,
					cfg.entityContext,
				)

				const preview =
					params.text.length > 80 ? `${params.text.slice(0, 80)}…` : params.text

				if (status === "failed") {
					return {
						content: [
							{
								type: "text" as const,
								text: `Memory store failed (server returned status="failed") for: "${preview}"`,
							},
						],
					}
				}

				return {
					content: [{ type: "text" as const, text: `Stored: "${preview}"` }],
				}
			},
		},
		{ name: toolName },
	)
}
