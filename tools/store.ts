import { Type } from "@sinclair/typebox"
import type { OpenClawPluginApi } from "openclaw/plugin-sdk"
import { stringEnum } from "openclaw/plugin-sdk"
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
	_cfg: SupermemoryConfig,
	getSessionKey: () => string | undefined,
): void {
	api.registerTool(
		{
			name: "supermemory_store",
			label: "Memory Store",
			description: "Save important information to long-term memory.",
			parameters: Type.Object({
				text: Type.String({ description: "Information to remember" }),
				category: Type.Optional(stringEnum(MEMORY_CATEGORIES)),
			}),
			async execute(
				_toolCallId: string,
				params: { text: string; category?: string },
			) {
				const category = params.category ?? detectCategory(params.text)
				const sk = getSessionKey()
				const customId = sk ? buildDocumentId(sk) : undefined

				log.debug(`store tool: category="${category}" customId="${customId}"`)

				await client.addMemory(
					params.text,
					{ type: category, source: "openclaw_tool" },
					customId,
				)

				const preview =
					params.text.length > 80 ? `${params.text.slice(0, 80)}…` : params.text

				return {
					content: [{ type: "text" as const, text: `Stored: "${preview}"` }],
				}
			},
		},
		{ name: "supermemory_store" },
	)
}
