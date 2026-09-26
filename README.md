# OpenClaw Supermemory Plugin

<img width="2048" height="512" alt="Untitled_Artwork 3" src="https://github.com/user-attachments/assets/e68fe07d-bc1f-49a1-a40c-3560f1a079b2" />

Long-term memory for OpenClaw. Automatically remembers conversations, recalls relevant context, and builds a persistent user profile — all powered by [Supermemory](https://supermemory.ai) cloud. No local infrastructure required.

> **Requires [Supermemory Pro or above](https://app.supermemory.ai/?view=integrations)** - Unlock the state of the art memory for your OpenClaw bot.

## Install

```bash
openclaw plugins install @supermemory/openclaw-supermemory
```

## Setup

```bash
openclaw supermemory setup
openclaw gateway restart
```

Enter your API key from [app.supermemory.ai](https://app.supermemory.ai/?view=integrations). That's it.

### Advanced Setup

```bash
openclaw supermemory setup-advanced
openclaw gateway restart
```

Configure all options interactively: container tag, auto-recall, auto-capture, capture mode, custom container tags, and more.

## How it works

Once installed, the plugin works automatically:

- **Auto-Recall** — Before every AI turn, queries Supermemory for relevant memories and injects them as context. The AI sees your user profile and semantically similar past conversations.
- **Auto-Capture** — After every AI turn, the conversation is sent to Supermemory for extraction and long-term storage.
- **Custom Container Tags** — Define custom memory containers (e.g., `work`, `personal`, `bookmarks`). The AI automatically picks the right container based on your instructions when using memory tools.

Everything runs in the cloud. Supermemory handles extraction, deduplication, and profile building.

## Slash Commands

| Command              | Description                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `/remember <text>`   | Manually save something to memory. Stores the given text immediately.                                |
| `/recall <query>`    | Search memories with similarity scores.                                                              |
| `/supermemory-index` | Index the current project into memory. Agent skill: explores the codebase, then saves focused memories (unlike `/remember`). |

## AI Tools

The AI uses these tools autonomously. With custom container tags enabled, all tools support a `containerTag` parameter for routing to specific containers.

| Tool                    | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `supermemory-save`      | Save information to memory.                            |
| `supermemory-search`    | Search memories by query.                              |
| `supermemory-forget`    | Delete a memory by query or ID.                        |
| `supermemory-profile`   | View user profile (persistent facts + recent context). |

The hyphenated names above are the standard across all Supermemory plugins. The
older `supermemory_store`, `supermemory_search`, `supermemory_forget` and
`supermemory_profile` names still work and resolve to the same tools, but they
are deprecated and will be removed in 3.0. Update any tool allowlists to the
hyphenated names.

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

Set API key (and, for self-hosted instances, the base URL) via environment variables:

```bash
export SUPERMEMORY_OPENCLAW_API_KEY="sm_..."
export SUPERMEMORY_BASE_URL="http://localhost:8000"   # optional; defaults to https://api.supermemory.ai
```

Or configure in `~/.openclaw/openclaw.json`:

### Options

| Key                           | Type      | Default               | Description                                               |
| ----------------------------- | --------- | --------------------- | --------------------------------------------------------- |
| `apiKey`                      | `string`  | —                       | Supermemory API key.                                      |
| `baseUrl`                     | `string`  | `https://api.supermemory.ai` | API endpoint. Set to a self-hosted / local URL to point at your own instance; leave blank for the cloud. |
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
    "slots": {
      "memory": "openclaw-supermemory"
    },
    "entries": {
      "openclaw-supermemory": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        },
        "config": {
          "apiKey": "${SUPERMEMORY_OPENCLAW_API_KEY}",
          "baseUrl": "https://api.supermemory.ai",
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

## Publishing to ClawHub

The **Publish to ClawHub** Actions workflow builds and packs the plugin, then
runs ClawHub's pinned reusable publishing workflow. Run it on the release tag
or branch you intend to publish. `dry_run` defaults to `true`: validation runs,
but no ClawHub release is created. Pull requests only run the build-and-pack job;
the publish job runs only on manual dispatch. Publishing to npm remains separate.

Before the first live publication:

1. Sign in to [ClawHub](https://clawhub.ai) with your company GitHub account and
   confirm you have publishing access to the `@supermemory` organization. The
   package scope must belong to that company-controlled publisher.
2. Create a ClawHub API token as a member of that publisher and save it in this
   GitHub repository as the Actions secret `CLAWHUB_TOKEN`. Never commit the token.
3. Run **Publish to ClawHub** with `dry_run: true` and review its inspector report
   and package artifact. Then run it with `dry_run: false` to publish the version
   from `package.json`. A new release needs a new package version. The workflow
   waits for ClawHub's security checks and publication result.

After the first publication, a package manager can configure trusted publishing:

```bash
clawhub package trusted-publisher set @supermemory/openclaw-supermemory \
  --repository supermemoryai/openclaw-supermemory \
  --workflow-filename clawhub-publish.yml
```

Once configured, remove `CLAWHUB_TOKEN` from the repository to use GitHub OIDC
for subsequent manual workflow runs. The workflow intentionally passes no owner
override: first publication resolves the package scope; trusted publication uses
the existing package owner. Dry runs need neither a ClawHub account nor that secret.

Publisher creation and successful publication do not grant an official badge.
Please email **patrick@openclaw.org** to discuss company verification and making
the Supermemory organization official on ClawHub.

See [ClawHub publishing documentation](https://github.com/openclaw/clawhub/blob/main/docs/publishing.md#trusted-publishing-for-packages)
for onboarding and trusted publishing details.
