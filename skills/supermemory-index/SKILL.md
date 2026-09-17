---
name: supermemory-index
description: Index the current project into Supermemory. Use when the user asks to index, learn, or memorize the codebase.
---

# Index codebase into Supermemory

Explore the current workspace and save several focused memories about it. This skill must run through the agent — do not look for a slash-command handler.

## Explore

Auto-detect the ecosystem from manifests and source layout:

- JS/TS — `package.json`, `tsconfig.json`, lockfiles, `src/`
- Python — `pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`
- Go — `go.mod`
- Rust — `Cargo.toml`
- .NET — `*.csproj`, `*.sln`
- Java — `pom.xml`, `build.gradle`
- Ruby — `Gemfile`
- PHP — `composer.json`
- Swift — `Package.swift`
- Elixir — `mix.exs`

Read the README, package/manifest files, architecture notes, conventions, and key source files. Skip dependency and build directories (`node_modules`, `dist`, `build`, `target`, `.git`, `vendor`, `__pycache__`, and similar).

## Save

For each distinct insight — what the project is, how it is structured, conventions, important modules, how to run and test — save a focused memory with `supermemory-save`. If that tool is unavailable, use `supermemory_store`.

Prefer several short, specific memories over one dump. Do not save secrets, credentials, or lockfile/dependency noise.

## Confirm

When done, reply in this form (fill in N and the project name):

Codebase indexed — [N] memories saved about [project name]
