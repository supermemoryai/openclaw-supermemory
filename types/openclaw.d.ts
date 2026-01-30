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
	}

	// biome-ignore lint/suspicious/noExplicitAny: openclaw SDK does not ship types
	export function stringEnum(values: readonly string[]): any
}
