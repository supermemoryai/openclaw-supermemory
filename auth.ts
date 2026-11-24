import { execFile } from "node:child_process"
import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto"
import * as fs from "node:fs"
import { createServer, type Server } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import * as readline from "node:readline"
import { PLUGIN_VERSION } from "./version.ts"

const CREDENTIALS_DIR = join(homedir(), ".supermemory-openclaw")
export const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json")
const CLIENT_FILE = join(CREDENTIALS_DIR, "oauth-client.json")
const LOCK_FILE = join(CREDENTIALS_DIR, "auth.lock")
export const AUTH_PORT = 19883
const REDIRECT_URI = `http://127.0.0.1:${AUTH_PORT}/callback`
const OAUTH_SCOPE = "openid profile email offline_access"
const REFRESH_TIMEOUT = 3000
const REFRESH_REQUEST_TIMEOUT = 10_000
const REFRESH_SKEW = 60_000
const configuredAuthTimeout = Number(process.env.SUPERMEMORY_AUTH_TIMEOUT)
const AUTH_TIMEOUT =
	Number.isFinite(configuredAuthTimeout) && configuredAuthTimeout > 0
		? configuredAuthTimeout
		: 5 * 60_000

function callbackPage(heading: string, color: string, message: string): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${heading} - Supermemory</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #faf9f6; color: #1a1a1a;">
<div style="text-align: center;"><h1 style="color: ${color}; font-weight: 500;">${heading}</h1><p>${message}</p></div>
</body></html>`
}

const AUTH_SUCCESS_HTML = callbackPage(
	"Supermemory is connected",
	"#22c55e",
	"You can close this tab and return to OpenClaw.",
)
const AUTH_DENIED_HTML = callbackPage(
	"Authorization denied",
	"#ef4444",
	"Supermemory was not connected. Run login again to retry.",
)
const AUTH_FAILED_HTML = callbackPage(
	"Connection failed",
	"#ef4444",
	"Return to your terminal and run login again.",
)

export type OAuthConfig = {
	apiBaseUrl: string
	issuer: string
	resource: string
}

type OAuthClient = OAuthConfig & {
	clientId: string
	redirectUri: string
	authorizationEndpoint: string
	tokenEndpoint: string
	revocationEndpoint: string
}

export type OAuthCredentials = OAuthClient & {
	type: "oauth"
	accessToken?: string
	refreshToken?: string
	expiresAt: number
	savedAt?: string
}

export class AuthError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status?: number,
	) {
		super(message)
	}
}

export function authRequired(): AuthError {
	return new AuthError(
		"Supermemory sign-in required or expired. Run `openclaw supermemory login` to sign in again, or configure an API key.",
		"AUTH_REQUIRED",
	)
}

function readJson<T>(file: string): T | null {
	try {
		const value = JSON.parse(fs.readFileSync(file, "utf-8"))
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as T)
			: null
	} catch {
		return null
	}
}

export function loadCredentialData(): OAuthCredentials | null {
	const data = readJson<OAuthCredentials>(CREDENTIALS_FILE)
	return data?.type === "oauth" ? data : null
}

function writeJson(file: string, data: unknown): void {
	fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 })
	const temporary = `${file}.${randomUUID()}.tmp`
	try {
		fs.writeFileSync(temporary, JSON.stringify(data, null, 2), {
			mode: 0o600,
			flag: "wx",
		})
		fs.renameSync(temporary, file)
	} finally {
		fs.rmSync(temporary, { force: true })
	}
}

// The gateway and CLI commands share these files; reclaim a lock only once its owner process is gone.
function recoverAbandonedLock(): void {
	let recovery: string | undefined
	let linked = false
	try {
		const original = fs.statSync(LOCK_FILE)
		recovery = `${LOCK_FILE}.${original.dev}.${original.ino}.recovery`
		fs.linkSync(LOCK_FILE, recovery)
		linked = true
		const snapshot = fs.statSync(recovery)
		if (snapshot.ino !== original.ino || snapshot.dev !== original.dev) return
		const owner = readJson<{ pid: number }>(recovery)
		let abandoned = false
		if (owner && Number.isInteger(owner.pid) && owner.pid > 0) {
			try {
				process.kill(owner.pid, 0)
			} catch (error) {
				abandoned = (error as NodeJS.ErrnoException).code === "ESRCH"
			}
		} else {
			abandoned = Date.now() - snapshot.mtimeMs > 10 * 60_000
		}
		if (abandoned) {
			const current = fs.statSync(LOCK_FILE)
			if (current.ino === original.ino && current.dev === original.dev)
				fs.unlinkSync(LOCK_FILE)
		}
	} catch (error) {
		if (
			!["ENOENT", "EEXIST"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			throw error
	} finally {
		if (linked && recovery) fs.rmSync(recovery, { force: true })
	}
}

async function withAuthLock<T>(
	action: (remaining: number) => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 })
	const deadline = Date.now() + timeoutMs
	let descriptor: number | undefined
	while (descriptor === undefined) {
		try {
			descriptor = fs.openSync(LOCK_FILE, "wx", 0o600)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			recoverAbandonedLock()
			if (Date.now() >= deadline)
				throw new Error("Supermemory authentication is busy. Try again.")
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
	}
	try {
		fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid }))
		return await action(Math.max(1, deadline - Date.now()))
	} finally {
		fs.closeSync(descriptor)
		fs.rmSync(LOCK_FILE, { force: true })
	}
}

function secureUrl(value: string): string {
	const url = new URL(value)
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
	if (
		url.username ||
		url.password ||
		url.hash ||
		url.search ||
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
	) {
		throw new Error(
			"OAuth requires HTTPS (HTTP is allowed only for loopback development).",
		)
	}
	return url.toString().replace(/\/+$/, "")
}

function sameConfig(
	credentials: Partial<OAuthConfig> | null,
	config: OAuthConfig,
): boolean {
	return (
		credentials?.apiBaseUrl === config.apiBaseUrl &&
		credentials?.issuer === config.issuer &&
		credentials?.resource === config.resource
	)
}

// Throws for custom endpoints that cannot name their MCP resource; those keep using API keys.
export function getOAuthConfig(baseUrl: string): OAuthConfig {
	const apiBaseUrl = secureUrl(baseUrl)
	const saved = loadCredentialData()
	const own = saved?.apiBaseUrl === apiBaseUrl ? saved : undefined
	const issuer =
		process.env.SUPERMEMORY_OAUTH_ISSUER ||
		own?.issuer ||
		`${apiBaseUrl}/api/auth`
	let resource = process.env.SUPERMEMORY_MCP_URL || own?.resource
	if (!resource) {
		const api = new URL(apiBaseUrl)
		if (!api.hostname.startsWith("api.")) {
			throw new Error(
				"OAuth sign-in needs SUPERMEMORY_MCP_URL on a custom Supermemory endpoint; use an API key instead.",
			)
		}
		api.hostname = api.hostname.replace(/^api\./, "mcp.")
		api.pathname = "/mcp"
		resource = api.toString()
	}
	return {
		apiBaseUrl,
		issuer: secureUrl(issuer),
		resource: secureUrl(resource),
	}
}

export function hasOAuthCredentials(config: OAuthConfig): boolean {
	const credentials = loadCredentialData()
	return (
		credentials?.type === "oauth" &&
		sameConfig(credentials, config) &&
		(!!credentials.refreshToken ||
			(!!credentials.accessToken &&
				credentials.expiresAt > Date.now() + REFRESH_SKEW))
	)
}

export function resolveOAuthConfig(baseUrl: string): OAuthConfig | undefined {
	try {
		const config = getOAuthConfig(baseUrl)
		return hasOAuthCredentials(config) ? config : undefined
	} catch {
		return undefined
	}
}

function issuerEndpoint(value: string, issuer: string): string {
	const endpoint = secureUrl(value)
	if (new URL(endpoint).origin !== new URL(issuer).origin) {
		throw new Error("OAuth endpoint does not belong to the configured issuer.")
	}
	return endpoint
}

// Error messages carry only the OAuth error code so tokens and response bodies never reach logs.
async function oauthRequest(
	url: string | URL,
	options: RequestInit,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, { ...options, redirect: "error" })
	const body: unknown = await response.json().catch(() => null)
	const data =
		body && typeof body === "object" ? (body as Record<string, unknown>) : {}
	if (!response.ok) {
		const code = ["invalid_grant", "invalid_client", "access_denied"].includes(
			String(data.error),
		)
			? String(data.error)
			: "oauth_request_failed"
		throw new AuthError(
			`Supermemory authorization failed (${code}, HTTP ${response.status}).`,
			code,
			response.status,
		)
	}
	return data
}

async function registerClient(
	config: OAuthConfig,
	signal: AbortSignal,
): Promise<OAuthClient> {
	const saved = readJson<OAuthClient>(CLIENT_FILE)
	if (
		sameConfig(saved, config) &&
		saved?.clientId &&
		saved.redirectUri === REDIRECT_URI
	)
		return saved
	const issuer = new URL(config.issuer)
	const metadata = await oauthRequest(
		new URL(
			`/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`,
			issuer,
		),
		{ signal },
	)
	if (metadata.issuer !== config.issuer)
		throw new Error("OAuth discovery returned an unexpected issuer.")
	const authorizationEndpoint = issuerEndpoint(
		String(metadata.authorization_endpoint),
		config.issuer,
	)
	const tokenEndpoint = issuerEndpoint(
		String(metadata.token_endpoint),
		config.issuer,
	)
	const registrationEndpoint = issuerEndpoint(
		String(metadata.registration_endpoint),
		config.issuer,
	)
	const revocationEndpoint = issuerEndpoint(
		String(metadata.revocation_endpoint),
		config.issuer,
	)
	const registration = await oauthRequest(registrationEndpoint, {
		method: "POST",
		signal,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_name: "Supermemory for OpenClaw",
			client_uri: "https://github.com/supermemoryai/openclaw-supermemory",
			software_id: "openclaw-supermemory",
			software_version: PLUGIN_VERSION,
			redirect_uris: [REDIRECT_URI],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			scope: OAUTH_SCOPE,
		}),
	})
	if (
		typeof registration.client_id !== "string" ||
		!registration.client_id ||
		registration.token_endpoint_auth_method !== "none"
	) {
		throw new Error("OAuth registration did not return a public client.")
	}
	const client: OAuthClient = {
		...config,
		clientId: registration.client_id,
		redirectUri: REDIRECT_URI,
		authorizationEndpoint,
		tokenEndpoint,
		revocationEndpoint,
	}
	signal.throwIfAborted()
	writeJson(CLIENT_FILE, client)
	return client
}

async function exchangeToken(
	client: OAuthClient,
	parameters: Record<string, string>,
	signal: AbortSignal,
	previous?: OAuthCredentials,
): Promise<string> {
	const data = await oauthRequest(
		issuerEndpoint(client.tokenEndpoint, client.issuer),
		{
			method: "POST",
			signal,
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: client.clientId,
				resource: client.resource,
				...parameters,
			}),
		},
	)
	const refreshToken = data.refresh_token ?? previous?.refreshToken
	if (
		typeof data.access_token !== "string" ||
		!data.access_token ||
		typeof data.token_type !== "string" ||
		data.token_type.toLowerCase() !== "bearer" ||
		typeof data.expires_in !== "number" ||
		!Number.isFinite(data.expires_in) ||
		data.expires_in <= 0 ||
		typeof refreshToken !== "string" ||
		!refreshToken
	) {
		throw new Error("OAuth returned an invalid token response.")
	}
	signal.throwIfAborted()
	const credentials: OAuthCredentials = {
		type: "oauth",
		apiBaseUrl: client.apiBaseUrl,
		issuer: client.issuer,
		resource: client.resource,
		clientId: client.clientId,
		redirectUri: client.redirectUri,
		authorizationEndpoint: client.authorizationEndpoint,
		tokenEndpoint: client.tokenEndpoint,
		revocationEndpoint: client.revocationEndpoint,
		accessToken: data.access_token,
		refreshToken,
		expiresAt: Date.now() + data.expires_in * 1000,
		savedAt: new Date().toISOString(),
	}
	writeJson(CREDENTIALS_FILE, credentials)
	return data.access_token
}

let pendingRefresh: Promise<string> | null = null

// Never abort a refresh mid-flight: the server rotates the refresh token and a lost response signs the user out.
function refreshCredentials(
	config: OAuthConfig,
	rejected?: string,
): Promise<string> {
	if (pendingRefresh) return pendingRefresh
	const refresh = withAuthLock(async (remaining) => {
		const credentials = loadCredentialData()
		if (!credentials || !sameConfig(credentials, config)) throw authRequired()
		if (
			credentials.accessToken &&
			credentials.accessToken !== rejected &&
			credentials.expiresAt > Date.now() + REFRESH_SKEW
		)
			return credentials.accessToken
		if (!credentials.refreshToken) throw authRequired()
		try {
			return await exchangeToken(
				credentials,
				{
					grant_type: "refresh_token",
					refresh_token: credentials.refreshToken,
				},
				AbortSignal.timeout(remaining),
				credentials,
			)
		} catch (error) {
			if (
				error instanceof AuthError &&
				["invalid_grant", "invalid_client"].includes(error.code)
			) {
				const {
					accessToken: _access,
					refreshToken: _refresh,
					...registration
				} = credentials
				writeJson(CREDENTIALS_FILE, registration)
				if (error.code === "invalid_client")
					fs.rmSync(CLIENT_FILE, { force: true })
				throw authRequired()
			}
			throw error
		}
	}, REFRESH_REQUEST_TIMEOUT).finally(() => {
		pendingRefresh = null
	})
	refresh.catch(() => {})
	pendingRefresh = refresh
	return refresh
}

// Bounds only how long the caller waits; the refresh itself keeps running.
function waitFor<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const expired = new Promise<T>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new AuthError(
					"Supermemory token refresh is still in progress.",
					"AUTH_PENDING",
				),
			)
		}, timeoutMs)
	})
	return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

export async function getAccessToken(
	config: OAuthConfig,
	timeoutMs = REFRESH_TIMEOUT,
	rejected?: string,
): Promise<string> {
	const saved = loadCredentialData()
	if (!saved || !sameConfig(saved, config)) throw authRequired()
	if (
		saved.accessToken &&
		saved.accessToken !== rejected &&
		saved.expiresAt > Date.now() + REFRESH_SKEW
	)
		return saved.accessToken
	return waitFor(refreshCredentials(config, rejected), timeoutMs)
}

function replayable(body: RequestInit["body"]): boolean {
	return (
		body === undefined ||
		body === null ||
		typeof body === "string" ||
		body instanceof URLSearchParams
	)
}

// The SDKs only take a static key, so the bearer is resolved per request and a 401 triggers one refresh and retry.
export function createAuthenticatedFetch(config: OAuthConfig): typeof fetch {
	const base = new URL(config.apiBaseUrl)
	const basePath = base.pathname.replace(/\/+$/, "")
	const authenticatedFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		const target = new URL(
			input instanceof Request ? input.url : input.toString(),
		)
		if (
			target.origin !== base.origin ||
			!target.pathname.startsWith(`${basePath}/`)
		) {
			throw authRequired()
		}
		const send = (token: string) => {
			const headers = new Headers(
				init?.headers ?? (input instanceof Request ? input.headers : undefined),
			)
			headers.set("Authorization", `Bearer ${token}`)
			return fetch(input, { ...init, headers })
		}
		const token = await getAccessToken(config)
		const response = await send(token)
		if (
			response.status !== 401 ||
			input instanceof Request ||
			!replayable(init?.body)
		)
			return response
		await response.body?.cancel().catch(() => {})
		return send(await getAccessToken(config, REFRESH_REQUEST_TIMEOUT, token))
	}
	return authenticatedFetch as typeof fetch
}

// A 4xx from revocation means the server no longer honors the token, so local sign-out still proceeds.
export async function clearCredentials(): Promise<OAuthCredentials | null> {
	return withAuthLock(async (remaining) => {
		const credentials = loadCredentialData()
		if (credentials?.refreshToken) {
			await oauthRequest(
				issuerEndpoint(credentials.revocationEndpoint, credentials.issuer),
				{
					method: "POST",
					signal: AbortSignal.timeout(remaining),
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						client_id: credentials.clientId,
						token: credentials.refreshToken,
						token_type_hint: "refresh_token",
					}),
				},
			).catch((error) => {
				if (!(error instanceof AuthError && (error.status ?? 500) < 500))
					throw error
			})
		}
		fs.rmSync(CREDENTIALS_FILE, { force: true })
		return credentials
	}, REFRESH_REQUEST_TIMEOUT)
}

function canOpenBrowser(): boolean {
	if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return false
	if (process.platform === "linux")
		return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
	return true
}

function openUrl(url: string): Promise<void> {
	const [command, args] =
		process.platform === "win32"
			? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]]
	return new Promise((resolve, reject) => {
		execFile(command, args, { windowsHide: true }, (error) =>
			error ? reject(error) : resolve(),
		)
	})
}

function printHeadlessHelp(url: string, acceptPaste: boolean): void {
	const lines = [
		"",
		"Open this link in a browser to sign in to Supermemory:",
		"",
		`  ${url}`,
		"",
		`Signing in from another computer? After consent the browser is sent to 127.0.0.1:${AUTH_PORT} on this machine.`,
		`Forward that port first: ssh -L ${AUTH_PORT}:127.0.0.1:${AUTH_PORT} <this-server>`,
	]
	if (acceptPaste) {
		lines.push(
			"Or, if the page fails to load, copy the full address from the browser and paste it here.",
		)
	}
	process.stderr.write(`${lines.join("\n")}\n\n`)
}

// The loopback listener and a pasted redirect URL both finish the same code exchange.
export async function startAuthFlow(
	config: OAuthConfig,
	{ printUrl = false }: { printUrl?: boolean } = {},
	timeoutMs = AUTH_TIMEOUT,
): Promise<string> {
	return withAuthLock(async (remaining) => {
		const controller = new AbortController()
		const timer = setTimeout(
			() =>
				controller.abort(
					new Error("Sign-in timed out. Run login again to retry."),
				),
			remaining,
		)
		let server: Server | undefined
		let paste: readline.Interface | undefined
		try {
			const client = await registerClient(config, controller.signal)
			const state = randomBytes(32).toString("base64url")
			const verifier = randomBytes(32).toString("base64url")
			const authorizationUrl = new URL(
				issuerEndpoint(client.authorizationEndpoint, client.issuer),
			)
			authorizationUrl.search = new URLSearchParams({
				client_id: client.clientId,
				redirect_uri: REDIRECT_URI,
				response_type: "code",
				scope: OAUTH_SCOPE,
				resource: client.resource,
				code_challenge: createHash("sha256")
					.update(verifier)
					.digest("base64url"),
				code_challenge_method: "S256",
				state,
				prompt: "consent",
			}).toString()
			const link = authorizationUrl.toString()
			return await new Promise<string>((resolve, reject) => {
				let exchanging = false
				controller.signal.addEventListener(
					"abort",
					() => reject(controller.signal.reason),
					{ once: true },
				)
				const validState = (url: URL) => {
					const received = Buffer.from(url.searchParams.get("state") || "")
					return (
						received.length === state.length &&
						timingSafeEqual(received, Buffer.from(state)) &&
						(!url.searchParams.has("iss") ||
							url.searchParams.get("iss") === client.issuer)
					)
				}
				const complete = (url: URL): Promise<string> => {
					if (url.searchParams.has("error")) {
						return Promise.reject(
							new AuthError("Authorization was denied.", "access_denied"),
						)
					}
					const code = url.searchParams.get("code")
					if (!code)
						return Promise.reject(new Error("Authorization code missing."))
					return exchangeToken(
						client,
						{
							grant_type: "authorization_code",
							code,
							code_verifier: verifier,
							redirect_uri: REDIRECT_URI,
						},
						controller.signal,
					)
				}
				const fail = (error: unknown) => {
					if (
						error instanceof AuthError &&
						error.code === "invalid_client" &&
						!controller.signal.aborted
					) {
						fs.rmSync(CLIENT_FILE, { force: true })
					}
					reject(error)
				}
				server = createServer(async (req, res) => {
					res.setHeader("Cache-Control", "no-store")
					res.setHeader("Referrer-Policy", "no-referrer")
					let url: URL
					try {
						url = new URL(req.url || "/", REDIRECT_URI)
					} catch {
						res.writeHead(400).end()
						return
					}
					if (req.method !== "GET" || url.pathname !== "/callback") {
						res.writeHead(404).end()
						return
					}
					if (!validState(url)) {
						res.writeHead(400).end("Invalid authorization state.")
						return
					}
					if (exchanging) {
						res.writeHead(409).end()
						return
					}
					exchanging = true
					try {
						const token = await complete(url)
						res
							.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
							.end(AUTH_SUCCESS_HTML, () => resolve(token))
					} catch (error) {
						const denied =
							error instanceof AuthError && error.code === "access_denied"
						res
							.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
							.end(denied ? AUTH_DENIED_HTML : AUTH_FAILED_HTML)
						fail(error)
					}
				})
				server.on("error", () =>
					reject(
						new Error(
							`Cannot open the sign-in callback port ${AUTH_PORT}. Retry after other logins finish.`,
						),
					),
				)
				server.listen(AUTH_PORT, "127.0.0.1", () => {
					const acceptPaste = !!process.stdin.isTTY
					if (acceptPaste) {
						paste = readline.createInterface({ input: process.stdin })
						paste.on("line", (line) => {
							let url: URL
							try {
								url = new URL(line.trim())
							} catch {
								return
							}
							if (url.pathname !== "/callback" || !validState(url)) {
								process.stderr.write(
									"That address does not match this sign-in. Paste the full URL from the browser.\n",
								)
								return
							}
							if (exchanging) return
							exchanging = true
							complete(url).then(resolve, fail)
						})
					}
					if (printUrl) {
						process.stdout.write(`SUPERMEMORY_AUTHORIZE_URL=${link}\n`)
						printHeadlessHelp(link, acceptPaste)
						return
					}
					if (!canOpenBrowser()) {
						printHeadlessHelp(link, acceptPaste)
						return
					}
					console.log("Opening your browser to sign in to Supermemory...")
					console.log(`If it doesn't open, visit: ${link}`)
					openUrl(link).catch(() => printHeadlessHelp(link, acceptPaste))
				})
			})
		} finally {
			clearTimeout(timer)
			controller.abort()
			paste?.close()
			server?.close()
			server?.closeAllConnections()
		}
	}, timeoutMs)
}
