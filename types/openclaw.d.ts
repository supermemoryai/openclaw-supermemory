declare module "openclaw/plugin-sdk" {
	export interface OpenClawPluginApi {
		pluginConfig: unknown
		logger: {
			info: (msg: string) => void
			warn: (msg: string) => void
			error: (msg: string, ...args: unknown[]) => void
			debug: (msg: string) => void
		}
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerTool(tool: any, options: any): void
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerCommand(command: any): void
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerCli(handler: any, options?: any): void
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerService(service: any): void
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		on(event: string, handler: (...args: any[]) => any): void
		/** Unified memory capability registration (preferred since openclaw 2026.4.7; falls back to deprecated methods for older versions). */
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerMemoryCapability?(capability: any): void
		/** @deprecated Use registerMemoryCapability({ runtime }) instead. */
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerMemoryRuntime?(runtime: any): void
		/** @deprecated Use registerMemoryCapability({ promptBuilder }) instead. */
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerMemoryPromptSection?(builder: any): void
		/** @deprecated Use registerMemoryCapability({ flushPlanResolver }) instead. */
		// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
		registerMemoryFlushPlan?(resolver: any): void
	}
}
