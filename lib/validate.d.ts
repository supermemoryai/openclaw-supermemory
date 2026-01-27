export declare function validateApiKeyFormat(key: string): {
	valid: boolean
	reason?: string
}
export declare function validateContainerTag(tag: string): {
	valid: boolean
	reason?: string
}
export declare function sanitizeContent(
	content: string,
	maxLength?: number,
): string
export declare function validateContentLength(
	content: string,
	min?: number,
	max?: number,
): { valid: boolean; reason?: string }
export declare function sanitizeMetadata(
	meta: Record<string, unknown>,
): Record<string, string | number | boolean>
export declare function validateRecallConfig(
	maxResults: number,
	frequency: number,
): string[]
export declare function getRequestIntegrity(
	apiKey: string,
	containerTag: string,
): Record<string, string>
