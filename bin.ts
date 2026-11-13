import {
	describeAuth,
	login,
	logout,
	OPENCLAW_CONFIG_PATH,
	readPluginConfig,
} from "./commands/login.ts"
import { resolveBaseUrl } from "./config.ts"

const [command, ...flags] = process.argv.slice(2)
const pluginConfig = readPluginConfig()

if (command === "login") {
	process.exitCode = await login(pluginConfig, {
		printUrl: flags.includes("--print-url"),
	})
} else if (command === "logout") {
	process.exitCode = await logout(pluginConfig)
} else if (command === "status") {
	const auth = await describeAuth(pluginConfig)
	console.log(auth.lines.join("\n"))
	console.log(`  Base URL:         ${resolveBaseUrl(pluginConfig.baseUrl)}`)
	console.log(`  OpenClaw config:  ${OPENCLAW_CONFIG_PATH}`)
} else {
	console.log(`openclaw-supermemory - Supermemory sign-in for OpenClaw

Usage:
  npx -y @supermemory/openclaw-supermemory login [--print-url]
  npx -y @supermemory/openclaw-supermemory logout
  npx -y @supermemory/openclaw-supermemory status

Inside OpenClaw the same commands run as: openclaw supermemory <command>`)
	process.exitCode =
		command && command !== "help" && command !== "--help" ? 1 : 0
}
