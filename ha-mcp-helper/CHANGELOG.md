# Changelog

## 0.5.0
- Merge pull request #10 from sserhii-tech/5-register-audit-agent-management-tools-and-update-ai-skills
- fix: resolve typescript type check errors in authorize method
- test: Fix test failures after audit endpoint and tool changes

## 0.4.0
- Merge pull request #10 from sserhii-tech/5-register-audit-agent-management-tools-and-update-ai-skills
- fix: resolve typescript type check errors in authorize method
- test: Fix test failures after audit endpoint and tool changes

## 0.3.9
- feat(cli): add install-skills CLI command and background auto-sync
- Merge branch 'main' of github.com:sserhii-tech/home-assistant-mcp
- chore: ignore .npmrc credential files

## 0.3.8
- Rename add-on references to app across docs and CI
- chore: update GitHub username to sserhii-tech across manifests, documentation, and remotes
- Update maintainer email in repository metadata

## 0.3.7
- Update maintainer email in repository metadata
- Add emojis to 0.3.6 changelog entries
- Update repo and image URLs to new GitHub owner

## 0.3.6
- 👤 Update repo and image URLs to new GitHub owner
- ⚙️ ci: strictly fail release and drafting workflows if CHANGELOG.md entry is missing
- ⚙️ ci(draft): automatically extract and paste CHANGELOG.md notes into GitHub draft releases

## 0.3.5
- fix(addon): set multi-arch python:3.11-alpine as default base image
- ci(release): add QEMU multi-arch platform compilation (linux/arm64 & linux/amd64)
- feat: automate CHANGELOG.md updates during version bumping

## 0.3.4
- feat: automate CHANGELOG.md updates during version bumping
- Merge branch 'main' of github.com:serhii-shevchenko/home-assistant-mcp
- ci(release): add required push: true and version parameters to build-image action

## 0.3.3
- 🚀 Fix container publishing to GHCR in Home Assistant build action (`push: true`).

## 0.3.2
- 🔍 Add support to read supervisor logs
## 0.3.1
- 🧹 More build dependency updates
## 0.3.0
- 🧹 Update node version in Github Actions to 24
- 👷 Update the build system to use modern HA build actions 
## 0.2.1
- ✨ Added `ha_system_call_service` tool for direct service invocations.
- 🎮 Added `ha-device-controller` AI agent skill for entity control and state verification.
- 🪟 Fixed cross-platform stdio entrypoint execution on Windows.
- 📋 Added native add-on changelog and documentation.

## 0.1.2
- 🐛 Fixed Alpine Linux container entrypoint shebang and line endings.
- 🛡️ Enabled strict `/config` path jailing and constant-time API key verification.
- 🔄 Added atomic pre-edit backup snapshots on all file write operations.

## 0.1.1
- 🚀 Multi-arch container builds for `aarch64` and `amd64` via GHCR.
- 📦 Automated release pipeline and version synchronization tooling.
