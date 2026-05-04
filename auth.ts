import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import * as fs from "node:fs"
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import { arch, homedir, hostname, platform } from "node:os"
import * as path from "node:path"

const CONFIG_DIR = path.join(homedir(), ".openclaw")
const CONFIG_FILE = path.join(CONFIG_DIR, "openclaw.json")
const AUTH_BASE_URL =
	process.env.SUPERMEMORY_AUTH_URL ||
	"https://console.supermemory.ai/auth/agent-connect"
const AUTH_TIMEOUT = Number(process.env.SUPERMEMORY_AUTH_TIMEOUT) || 60_000
const API_URL = process.env.SUPERMEMORY_API_URL || "https://api.supermemory.ai"

export async function validateApiKey(
	apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
	try {
		const res = await fetch(`${API_URL}/v3/session`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(8000),
		})
		if (res.status === 401 || res.status === 403) {
			return { valid: false, error: "Invalid API key" }
		}
		return { valid: true }
	} catch {
		return { valid: true } // network error — don't block, key format was already checked
	}
}

export function saveApiKey(apiKey: string): void {
	let config: Record<string, unknown> = {}
	if (fs.existsSync(CONFIG_FILE)) {
		try {
			config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
		} catch {
			config = {}
		}
	}

	if (!config.plugins) config.plugins = {}
	const plugins = config.plugins as Record<string, unknown>
	if (!plugins.entries) plugins.entries = {}
	const entries = plugins.entries as Record<string, unknown>

	const existing =
		(entries["openclaw-supermemory"] as Record<string, unknown>) ?? {}
	entries["openclaw-supermemory"] = {
		...existing,
		enabled: true,
		config: {
			...((existing.config as Record<string, unknown>) ?? {}),
			apiKey,
		},
	}

	if (!fs.existsSync(CONFIG_DIR)) {
		fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
	}
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
		mode: 0o600,
	})
}

function openBrowser(url: string): void {
	const onError = (err: Error | null) => {
		if (err) console.error("Failed to open browser:", err.message)
	}
	if (process.platform === "win32") {
		execFile("explorer.exe", [url], onError)
	} else if (process.platform === "darwin") {
		execFile("open", [url], onError)
	} else {
		execFile("xdg-open", [url], onError)
	}
}

export interface AuthResult {
	success: boolean
	apiKey?: string
	error?: string
}

export function startAuthFlow(): Promise<AuthResult> {
	return new Promise((resolve) => {
		let resolved = false
		const stateToken = randomBytes(16).toString("hex")

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			if (resolved) return

			const url = new URL(req.url || "/", "http://localhost")

			if (url.pathname === "/callback") {
				const callbackState = url.searchParams.get("state")
				if (callbackState !== stateToken) {
					res.writeHead(403, { "Content-Type": "text/html" })
					res.end(errorHtml("Invalid state token"))
					return
				}

				const apiKey =
					url.searchParams.get("apikey") || url.searchParams.get("api_key")

				if (apiKey?.startsWith("sm_")) {
					// Validate the key before saving
					validateApiKey(apiKey).then(({ valid, error: validationError }) => {
						if (!valid) {
							res.writeHead(400, {
								"Content-Type": "text/html",
								"Referrer-Policy": "no-referrer",
							})
							res.end(errorHtml(validationError || "Invalid API key"))
							resolved = true
							clearTimeout(timer)
							server.close()
							resolve({
								success: false,
								error: validationError || "Invalid API key",
							})
							return
						}
						saveApiKey(apiKey)
						res.writeHead(200, {
							"Content-Type": "text/html",
							"Referrer-Policy": "no-referrer",
						})
						res.end(successHtml)
						resolved = true
						clearTimeout(timer)
						server.close()
						resolve({ success: true, apiKey })
					})
				} else {
					res.writeHead(400, {
						"Content-Type": "text/html",
						"Referrer-Policy": "no-referrer",
					})
					res.end(errorHtml("No API key received"))
					resolved = true
					clearTimeout(timer)
					server.close()
					resolve({ success: false, error: "No API key received" })
				}
			} else {
				res.writeHead(404)
				res.end("Not Found")
			}
		})

		server.on("error", (err: Error) => {
			if (!resolved) {
				resolved = true
				clearTimeout(timer)
				resolve({ success: false, error: err.message })
			}
		})

		// Listen on an ephemeral port; embed state token in callback URL so the
		// console redirects it back and the CSRF check passes.
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo
			const callbackUrl = `http://localhost:${port}/callback?state=${stateToken}`
			const params = new URLSearchParams({
				callback: callbackUrl,
				client: "openclaw",
				hostname: hostname(),
				os: `${platform()}-${arch()}`,
				cwd: process.cwd(),
				cli_version: "1.0.0",
			})
			const authUrl = `${AUTH_BASE_URL}?${params.toString()}`

			console.log("Opening browser for authentication...")
			console.log(`If it doesn't open, visit: ${authUrl}`)
			openBrowser(authUrl)
		})

		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true
				server.close()
				resolve({ success: false, error: "Authentication timed out" })
			}
		}, AUTH_TIMEOUT)
	})
}

const successHtml = `<!DOCTYPE html>
<html>
<head><title>Success</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
  <div style="text-align: center;">
    <h1 style="color: #22c55e;">✓ Connected!</h1>
    <p>You can close this window and return to your terminal.</p>
  </div>
</body>
</html>`

function errorHtml(message: string): string {
	return `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
  <div style="text-align: center;">
    <h1 style="color: #ef4444;">✗ Connection Failed</h1>
    <p>${message}. Please try again.</p>
  </div>
</body>
</html>`
}
