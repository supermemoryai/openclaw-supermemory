# Supermemory Plugin for OpenClaw (previously Clawdbot)

<img width="1200" height="628" alt="Announcement-3 (2)" src="https://github.com/user-attachments/assets/caa5acaa-8246-4172-af3a-9cfed2a452c1" />



Long-term memory for OpenClaw. Automatically remembers conversations, recalls relevant context, and builds a persistent user profile — all powered by [Supermemory](https://supermemory.ai) cloud. No local infrastructure required.

## Install

```bash
openclaw plugins install @supermemory/openclaw-supermemory
```

Restart OpenClaw after installing.

## Configuration

The only required value is your Supermemory API key. Get one at [console.supermemory.ai](https://console.supermemory.ai).

Set it as an environment variable:

```bash
export SUPERMEMORY_OPENCLAW_API_KEY="sm_..."
```

Or configure it directly in `openclaw.json`:

```json5
{
  "plugins": {
    "entries": {
      "openclaw-supermemory": {
        "enabled": true,
        "config": {
          "apiKey": "${SUPERMEMORY_OPENCLAW_API_KEY}"
        }
      }
    }
  }
}
```

### Advanced options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `containerTag` | `string` | `openclaw_{hostname}` | Memory namespace. All channels share this tag. |
| `autoRecall` | `boolean` | `true` | Inject relevant memories before every AI turn. |
| `autoCapture` | `boolean` | `true` | Automatically store conversation content after every turn. |
| `maxRecallResults` | `number` | `10` | Max memories injected into context per turn. |
| `profileFrequency` | `number` | `50` | Inject full user profile every N turns. Search results are injected every turn. |
| `captureMode` | `string` | `"all"` | `"all"` filters short texts and injected context. `"everything"` captures all messages. |
| `debug` | `boolean` | `false` | Verbose debug logs for API calls and responses. |

## How it works

Once installed, the plugin works automatically with zero interaction:

- **Auto-Recall** — Before every AI turn, the plugin queries Supermemory for relevant memories and injects them as context. The AI sees your user profile (preferences, facts) and semantically similar past conversations.
- **Auto-Capture** — After every AI turn, the last user/assistant exchange is sent to Supermemory for extraction and long-term storage.

Everything runs in the cloud. Supermemory handles extraction, deduplication, and profile building on its end.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/remember <text>` | Manually save something to memory. |
| `/recall <query>` | Search your memories and see results with similarity scores. |

## AI Tools

The AI can use these tools autonomously during conversations:

| Tool | Description |
|------|-------------|
| `supermemory_store` | Save information to long-term memory. |
| `supermemory_search` | Search memories by query. |
| `supermemory_forget` | Delete a memory by query. |
| `supermemory_profile` | View the user profile (persistent facts + recent context). |

## CLI Commands

```bash
openclaw supermemory search <query>    # Search memories
openclaw supermemory profile           # View user profile
openclaw supermemory wipe              # Delete all memories (destructive, requires confirmation)
```
