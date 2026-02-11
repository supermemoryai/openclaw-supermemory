import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SupermemoryClient } from "./client.ts"
import type { SupermemoryConfig } from "./config.ts"
import { log } from "./logger.ts"

/**
 * Manages SupermemoryClient instances, one per agent.
 *
 * When per-agent keys are enabled, each agent can have its own API key
 * stored in ~/.openclaw/agents/<agentId>/agent/auth-profiles.json.
 * If found, a dedicated client is created for that agent.
 * If not found, the global (default) client is returned.
 *
 * This enables multi-user setups where each user has a scoped SuperMemory
 * API key for isolated memory containers.
 */
export class ClientManager {
	private globalClient: SupermemoryClient
	private agentClients = new Map<string, SupermemoryClient>()
	private cfg: SupermemoryConfig

	constructor(globalClient: SupermemoryClient, cfg: SupermemoryConfig) {
		this.globalClient = globalClient
		this.cfg = cfg
	}

	/**
	 * Get the appropriate client for the given agent.
	 * Returns a per-agent client if a scoped API key is found,
	 * otherwise returns the global client.
	 */
	getClient(agentId?: string): SupermemoryClient {
		if (!agentId || !this.cfg.perAgentKeys) {
			return this.globalClient
		}

		// Check cache first
		const cached = this.agentClients.get(agentId)
		if (cached) {
			return cached
		}

		// Try to resolve a per-agent API key from auth-profiles
		const agentKey = this.resolveAgentApiKey(agentId)
		if (!agentKey) {
			return this.globalClient
		}

		// Create a per-agent client with the resolved key.
		// Container tag can be agent-specific or use the scoped key's implicit container.
		const containerTag = `openclaw_${agentId}`
		log.info(
			`creating per-agent supermemory client for "${agentId}" (container: ${containerTag})`,
		)
		const client = new SupermemoryClient(agentKey, containerTag)
		this.agentClients.set(agentId, client)
		return client
	}

	/**
	 * Read the supermemory API key from an agent's auth-profiles.json.
	 * Returns the key string if found, undefined otherwise.
	 */
	private resolveAgentApiKey(agentId: string): string | undefined {
		const stateDir =
			process.env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), ".openclaw")
		const profilePath = path.join(
			stateDir,
			"agents",
			agentId,
			"agent",
			"auth-profiles.json",
		)

		try {
			if (!fs.existsSync(profilePath)) {
				return undefined
			}

			const raw = JSON.parse(fs.readFileSync(profilePath, "utf-8"))
			const profiles = raw?.profiles
			if (!profiles || typeof profiles !== "object") {
				return undefined
			}

			// Look for a supermemory profile entry
			for (const [_id, profile] of Object.entries(profiles)) {
				const p = profile as Record<string, unknown>
				if (p.provider === "supermemory" && p.type === "api_key") {
					const key = p.key as string | undefined
					if (key?.trim()) {
						log.debug(`resolved per-agent supermemory key for "${agentId}"`)
						return key.trim()
					}
				}
			}
		} catch (err) {
			log.debug(`failed to read auth-profiles for agent "${agentId}": ${err}`)
		}

		return undefined
	}
}
