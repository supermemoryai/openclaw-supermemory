# OpenClaw Supermemory Plugin

<img width="1200" height="628" alt="Announcement-3 (2)" src="https://github.com/user-attachments/assets/caa5acaa-8246-4172-af3a-9cfed2a452c1" />

Long-term memory for OpenClaw. Automatically remembers conversations, recalls relevant context, and builds a persistent user profile — all powered by [Supermemory](https://supermemory.ai) cloud. No local infrastructure required.

> **Requires [Supermemory Pro or above](https://console.supermemory.ai/billing)** - Unlock the state of the art memory for your OpenClaw bot.

## Install

```bash
openclaw plugins install @supermemory/openclaw-supermemory
```

Restart OpenClaw after installing.

## Setup

```bash
openclaw supermemory setup
```

Enter your API key from [console.supermemory.ai](https://console.supermemory.ai). That's it.

### Advanced Setup

```bash
openclaw supermemory setup-advanced
```

Configure all options interactively: container tag, auto-recall, auto-capture, capture mode, custom container tags, and more.

## How it works

Once installed, the plugin works automatically:

- **Auto-Recall** — Before every AI turn, queries Supermemory for relevant memories and injects them as context. The AI sees your user profile and semantically similar past conversations.
- **Auto-Capture** — After every AI turn, the conversation is sent to Supermemory for extraction and long-term storage.
- **Custom Container Tags** — Define custom memory containers (e.g., `work`, `personal`, `bookmarks`). The AI automatically picks the right container based on your instructions when using memory tools.

Everything runs in the cloud. Supermemory handles extraction, deduplication, and profile building.

## Slash Commands

| Command            | Description                             |
| ------------------ | --------------------------------------- |
| `/remember <text>` | Manually save something to memory.      |
| `/recall <query>`  | Search memories with similarity scores. |

## AI Tools

The AI uses these tools autonomously. With custom container tags enabled, all tools support a `containerTag` parameter for routing to specific containers.

| Tool                  | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `supermemory_store`   | Save information to memory.                            |
| `supermemory_search`  | Search memories by query.                              |
| `supermemory_forget`  | Delete a memory by query or ID.                        |
| `supermemory_profile` | View user profile (persistent facts + recent context). |

## CLI Commands

```bash
openclaw supermemory setup              # Configure API key
openclaw supermemory setup-advanced     # Configure all options
openclaw supermemory status             # View current configuration
openclaw supermemory search <query>     # Search memories
openclaw supermemory profile            # View user profile
openclaw supermemory wipe               # Delete all memories (requires confirmation)
```

## Configuration

Set API key via environment variable:

```bash
export SUPERMEMORY_OPENCLAW_API_KEY="sm_..."
```

Or configure in `~/.openclaw/openclaw.json`:

### Options

| Key                           | Type      | Default               | Description                                               |
| ----------------------------- | --------- | --------------------- | --------------------------------------------------------- |
| `apiKey`                      | `string`  | —                     | Supermemory API key.                                      |
| `containerTag`                | `string`  | `openclaw_{hostname}` | Root memory namespace.                                    |
| `autoRecall`                  | `boolean` | `true`                | Inject relevant memories before every AI turn.            |
| `autoCapture`                 | `boolean` | `true`                | Store conversations after every turn.                     |
| `maxRecallResults`            | `number`  | `10`                  | Max memories injected per turn.                           |
| `profileFrequency`            | `number`  | `50`                  | Inject full profile every N turns.                        |
| `captureMode`                 | `string`  | `"all"`               | `"all"` filters short texts, `"everything"` captures all. |
| `debug`                       | `boolean` | `false`               | Verbose debug logs.                                       |
| `enableCustomContainerTags`   | `boolean` | `false`               | Enable custom container routing.                          |
| `customContainers`            | `array`   | `[]`                  | Custom containers with `tag` and `description`.           |
| `customContainerInstructions` | `string`  | `""`                  | Instructions for AI on container routing.                 |

### Full Example

```json
{
  "plugins": {
    "entries": {
      "openclaw-supermemory": {
        "enabled": true,
        "config": {
          "apiKey": "${SUPERMEMORY_OPENCLAW_API_KEY}",
          "containerTag": "my_memory",
          "autoRecall": true,
          "autoCapture": true,
          "maxRecallResults": 10,
          "profileFrequency": 50,
          "captureMode": "all",
          "debug": false,
          "enableCustomContainerTags": true,
          "customContainers": [
            { "tag": "work", "description": "Work-related memories" },
            { "tag": "personal", "description": "Personal notes" }
          ],
          "customContainerInstructions": "Store work tasks in 'work', personal stuff in 'personal'"
        }
      }
    }
  }
}
```
