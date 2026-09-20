import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
}

export const EMBEDDED_SKILLS: Record<string, string> = {
  "ha-device-controller": `---
name: ha-device-controller
description: SOP for safely discovering entities, calling Home Assistant services, controlling smart devices, and verifying state transitions.
---

# Home Assistant Device Controller Skill

## Overview

The \`ha-device-controller\` skill defines the Standard Operating Procedure (SOP) for querying real-time smart device states, invoking Home Assistant domain services (lights, switches, climate, media players, covers), and validating that the target hardware correctly transitions state.

---

## Workflow & Steps

\`\`\`mermaid
flowchart TD
    A[Step 1: Discover Entity & Current State] --> B[Step 2: Validate Domain & Payload Schema]
    B --> C[Step 3: Execute Service Call]
    C --> D[Step 4: Verify Post-Execution State]
    D --> E{State Verified?}
    E -- Yes --> F[Success & Report Confirmation]
    E -- No --> G[Inspect System Logs & Diagnose]
\`\`\`

### Step 1: Discover Entity & Current State
Before sending control commands or invoking services, locate the exact target entity ID and inspect its current attributes.
- Use \`ha_system_list_entities\` with \`domain_filter\` (e.g. \`light\`, \`switch\`, \`climate\`) or \`search_query\`.
- Verify the current \`state\` (e.g., \`off\` vs \`on\`), supported color modes, preset modes, or available features.

\`\`\`json
// Example call: ha_system_list_entities
{
  "domain_filter": "light",
  "search_query": "office"
}
\`\`\`

### Step 2: Validate Domain & Payload Schema
Construct the service invocation payload matching Home Assistant Core service specifications.
- Common services include:
  - \`light.turn_on\`, \`light.turn_off\`, \`light.toggle\` (with \`brightness\`, \`rgb_color\`, \`color_temp_kelvin\`)
  - \`switch.turn_on\`, \`switch.turn_off\`, \`switch.toggle\`
  - \`climate.set_temperature\`, \`climate.set_hvac_mode\` (with \`temperature\`, \`hvac_mode\`)
  - \`cover.open_cover\`, \`cover.close_cover\`, \`cover.set_cover_position\`
  - \`homeassistant.update_entity\`, \`homeassistant.reload_all\`

### Step 3: Execute Service Call
Invoke the service using \`ha_system_call_service\`.
- Provide the \`domain\`, \`service\`, and \`service_data\` payload.

\`\`\`json
// Example call: ha_system_call_service
{
  "domain": "light",
  "service": "turn_on",
  "service_data": {
    "entity_id": "light.office_light",
    "brightness": 200
  },
  "rationale": "Turning on the lights as part of the morning routine."
}
\`\`\`

### Step 4: Verify Post-Execution State
Confirm that the physical device or software entity acknowledged the command and changed state.
- Re-query \`ha_system_list_entities\` with \`search_query\` targeting the entity.
- Compare \`last_changed\` and \`state\` against expected outcome.
- If the entity remains unchanged or reports \`unavailable\`, tail recent logs with \`ha_system_get_logs\` to diagnose integration communication errors.

---

## Tool Reference

| Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| \`ha_system_list_entities\` | Discover entities and inspect live states | \`domain_filter\`, \`search_query\` |
| \`ha_system_call_service\` | Call any Home Assistant domain service | \`domain\`, \`service\`, \`service_data\`, \`rationale\` |
| \`ha_system_get_logs\` | Inspect system error logs on failures | \`lines_count\`, \`source\` |
| \`ha_system_health\` | Verify API and integration connectivity | *(none)* |

---

## Safety Rules & Best Practices

1. **Verify Before Execution**: Always confirm entity identity with \`ha_system_list_entities\` before triggering destructive or high-energy actions (heaters, locks, garage doors).
2. **Post-State Validation**: Never assume a service call succeeded solely based on HTTP 200; verify the entity \`state\` afterwards.
3. **Graceful Error Handling**: If a device fails to respond, inspect \`ha_system_get_logs\` for Zigbee/Z-Wave/Wi-Fi timeout errors before retrying in a loop.
4. **Sandboxed Roles & Audit Logs**: Always provide a descriptive \`rationale\` parameter when mutating state, as this is logged securely by the Audit service. Use ephemeral tokens via \`ha_agent_issue_token\` with narrow roles if delegating this task to a subagent.
`,

  "ha-dashboard-designer": `---
name: ha-dashboard-designer
description: SOP for creating, previewing, and visually iterating Home Assistant Lovelace dashboards using MCP tools and Playwright screenshots.
---

# Home Assistant Dashboard Designer Skill

## Overview

The \`ha-dashboard-designer\` skill provides a complete Standard Operating Procedure (SOP) for creating, modifying, and polishing Home Assistant Lovelace dashboards with AI-driven visual validation. By combining entity discovery, configuration management with automatic snapshot safety, and headless Playwright screenshot rendering, this skill ensures dashboards are aesthetically refined, responsive across devices, and functional.

---

## Workflow & Steps

\`\`\`mermaid
flowchart TD
    A[Step 1: Discover Entities] --> B[Step 2: Inspect Dashboard Config]
    B --> C[Step 3: Propose Layout & Cards]
    C --> D[Step 4: Save Lovelace YAML]
    D --> E[Step 5: Capture Screenshots]
    E --> F{Step 6: Visual Inspection Loop}
    F -- Issues Found --> C
    F -- Approved --> G[Finalize & Present]
\`\`\`

### Step 1: Query Available Entities
Before designing or modifying any dashboard cards, discover the available entities, their domains, states, friendly names, and device classes.
- Use \`ha_system_list_entities\` with domain filters (e.g. \`light\`, \`climate\`, \`sensor\`, \`switch\`, \`media_player\`) or search terms.
- Verify entity availability and state types (e.g. numeric sensors, binary on/off states, list attributes).

\`\`\`json
// Example call: ha_system_list_entities
{
  "domain_filter": "climate",
  "search_query": "living_room"
}
\`\`\`

### Step 2: Inspect Existing Dashboard Configuration
Inspect the current dashboard configuration to maintain theme consistency, title naming conventions, badge configurations, and view hierarchy.
- Use \`ha_dashboard_get_config\` with the target \`dashboard_slug\` (e.g. \`lovelace\` for default or custom slugs like \`dashboard-energy\`).
- Analyze existing views, card types, custom themes, and column layouts.

\`\`\`json
// Example call: ha_dashboard_get_config
{
  "dashboard_slug": "lovelace"
}
\`\`\`

### Step 3: Propose Card Layout & Design
Design card layouts tailored to the user requirements and device constraints:
- **Card Selection**:
  - **Tile Card**: Modern HA standard for lights, switches, media players with feature controls.
  - **Mushroom Cards**: Minimalist, touch-friendly UI for room summaries, chips, and climate.
  - **Grid & Stacks**: \`grid\`, \`horizontal-stack\`, and \`vertical-stack\` for structured alignment.
  - **Glance & Entities**: Compact summaries for sensors (temperatures, battery levels).
  - **ApexCharts & Gauges**: Historical trends, energy metrics, and analog gauges.
  - **Conditional Cards**: Dynamic cards that appear only when specific states match (e.g. doors open, low battery).
- **Responsive Guidelines**:
  - Use 2-4 columns on desktop layouts.
  - Ensure single-column or wrapping behavior on mobile screens.
  - Group cards logically by room or domain.

### Step 4: Save Lovelace YAML Configuration
Apply the updated dashboard configuration safely.
- Use \`ha_dashboard_save_config\` supplying the YAML configuration, target \`dashboard_slug\`, and a descriptive \`label\`.
- Note: \`ha_dashboard_save_config\` automatically creates a safety snapshot before applying modifications and performs YAML schema validation.

\`\`\`json
// Example call: ha_dashboard_save_config
{
  "dashboard_slug": "lovelace",
  "label": "Add living room climate tile and energy gauge",
  "config_yaml": "title: Home\\nviews:\\n  - title: Main\\n    path: main\\n    cards:\\n      - type: tile\\n        entity: light.living_room\\n",
  "rationale": "Adding climate and energy visualizations for better visibility."
}
\`\`\`

### Step 5: Capture Rendered Screenshots
Verify the visual rendering of the updated dashboard using the headless Playwright browser.
- Use \`ha_dashboard_render_screenshot\` with the target \`url_path\` (e.g. \`lovelace/0\`, \`dashboard-energy\`).
- Always test across multiple device presets:
  - \`desktop\` (1920x1080)
  - \`mobile\` (375x812)
  - \`tablet\` (768x1024)
- Test both light and dark modes when relevant using \`dark_mode: true\`.
- Use \`element_selector\` when focusing on a specific card component.

\`\`\`json
// Example call: ha_dashboard_render_screenshot
{
  "url_path": "lovelace/0",
  "device_preset": "desktop",
  "dark_mode": false
}
\`\`\`

### Step 6: Visual Inspection Loop & Iteration
Analyze the captured screenshot image using multimodal vision inspection:
1. **Alignment & Grid Symmetry**: Are card borders aligned? Are heights balanced across columns?
2. **Typography & Readability**: Are labels truncated? Is text overflowing container bounds?
3. **Icons & States**: Are MDI icons rendering correctly? Are active entity states visually distinct?
4. **Color & Contrast**: Do accent colors match the background theme in both light and dark mode?
5. **Mobile Responsiveness**: Do horizontal stacks wrap cleanly without clipping horizontal scrollbars?

*If any visual flaw or layout inconsistency is detected, return to Step 3, adjust the Lovelace YAML, re-save, and re-capture until the dashboard achieves optimal visual fidelity.*

---

## Tool Reference

| Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| \`ha_system_list_entities\` | Discover entities & states | \`domain_filter\`, \`search_query\` |
| \`ha_dashboard_get_config\` | Fetch Lovelace dashboard YAML/JSON | \`dashboard_slug\` |
| \`ha_dashboard_save_config\` | Snapshot, validate, and write dashboard | \`config_yaml\`, \`dashboard_slug\`, \`label\`, \`rationale\` |
| \`ha_dashboard_render_screenshot\` | Headless Playwright visual capture | \`url_path\`, \`device_preset\`, \`dark_mode\`, \`element_selector\` |

---

## Safety Rules & Best Practices

1. **Automatic Snapshot Preservation**: Never edit Lovelace files directly outside of \`ha_dashboard_save_config\`, ensuring an automatic snapshot ID is always generated for rollback.
2. **Multi-Viewport Testing**: Every dashboard modification must be verified on both \`desktop\` and \`mobile\` presets before marking complete.
3. **Graceful Entity Fallbacks**: Use conditional cards or friendly names so cards remain visually appealing even when sensors are temporarily unavailable.
4. **Non-Destructive View Updates**: When adding new features, prefer creating dedicated views or sub-views rather than overwriting existing user dashboards without request.
5. **Sandboxed Roles & Audit Logs**: Always provide a descriptive \`rationale\` parameter when saving config, as this is logged securely. If delegating to a UI subagent, invoke them with the restricted \`ha-dashboard-designer\` role via \`ha_agent_issue_token\` to enforce scope safety.
`,

  "ha-automation-builder": `---
name: ha-automation-builder
description: SOP for drafting, validating, testing, and debugging Home Assistant automations and scripts safely.
---

# Home Assistant Automation Builder Skill

## Overview

The \`ha-automation-builder\` skill provides an end-to-end Standard Operating Procedure (SOP) for drafting, writing, validating, and testing Home Assistant automations and scripts. It enforces best practices such as unique ID assignment, syntax validation, automated snapshot generation before disk modification, live entity validation, and post-deployment trigger execution verification.

---

## Workflow & Steps

\`\`\`mermaid
flowchart TD
    A[Step 1: Discover Entities & Services] --> B[Step 2: Read Existing Automations]
    B --> C[Step 3: Construct Safe YAML Block]
    C --> D[Step 4: Write Automation & Auto-Reload]
    D --> E[Step 5: Test Trigger & Inspect Logs]
    E --> F{Verification Check}
    F -- Error in Logs --> C
    F -- Success --> G[Complete]
\`\`\`

### Step 1: Discover Entity IDs & Services
Before authoring automation logic, discover all target entities, their current states, supported attributes, and service domains.
- Use \`ha_system_list_entities\` to look up sensor names, switch entity IDs, zone entities, or input helpers.
- Verify entity domains (e.g. \`binary_sensor.front_door\`, \`light.hallway\`, \`climate.thermostat\`).

\`\`\`json
// Example call: ha_system_list_entities
{
  "domain_filter": "binary_sensor",
  "search_query": "motion"
}
\`\`\`

### Step 2: Read Existing Automations & Avoid Collisions
Examine existing automations to avoid duplicate aliases, conflicting triggers, or ID collisions.
- Use \`ha_automation_list\` with domain \`automation\` (or \`script\` / \`scene\`) to view active entity IDs, friendly names, and trigger times.
- Use \`ha_automation_read\` with a specific automation ID or alias to inspect existing YAML structure and conventions.

\`\`\`json
// Example call: ha_automation_list
{
  "domain": "automation"
}

// Example call: ha_automation_read
{
  "automation_id": "night_light_auto_off"
}
\`\`\`

### Step 3: Construct Safe YAML Automation Blocks
Structure the automation with clear metadata, robust triggers, defensive conditions, and appropriate execution modes.
- **Unique Identifier**: Always assign a deterministic or timestamped \`id\` (e.g. \`id: '1725100000123'\` or \`id: auto_living_room_motion\`).
- **Alias & Description**: Provide a clear human-readable \`alias\` and \`description\`.
- **Triggers**: Define precise triggers with thresholds or duration (e.g. \`for: { minutes: 5 }\`).
- **Conditions**: Use conditions to filter execution (e.g. sun elevation, state conditions, time ranges).
- **Actions**: Utilize official Home Assistant service targets (\`action:\` / \`service:\`) and avoid deprecated syntax.
- **Execution Mode**: Choose the appropriate \`mode\`:
  - \`single\`: Default, drops concurrent triggers.
  - \`restart\`: Ideal for motion timers (resets timer on new motion).
  - \`queued\`: Enqueues triggers up to \`max\`.
  - \`parallel\`: Executes independently up to \`max\`.

\`\`\`yaml
- id: "auto_hallway_motion_light"
  alias: "Hallway: Motion-Activated Nightlight"
  description: "Turn on hallway light on motion after sunset and turn off after 3 minutes of no motion."
  mode: restart
  trigger:
    - platform: state
      entity_id: binary_sensor.hallway_motion
      to: "on"
  condition:
    - condition: state
      entity_id: sun.sun
      state: "below_horizon"
  action:
    - action: light.turn_on
      target:
        entity_id: light.hallway
      data:
        brightness_pct: 30
    - wait_for_trigger:
        - platform: state
          entity_id: binary_sensor.hallway_motion
          to: "off"
          for:
            minutes: 3
    - action: light.turn_off
      target:
        entity_id: light.hallway
\`\`\`

### Step 4: Write Automation with Auto-Reload & Snapshot
Write the automation block to \`automations.yaml\` safely.
- Use \`ha_automation_write\` providing the \`automation_id\`, \`yaml_code\`, and a descriptive \`label\`.
- Note: \`ha_automation_write\` automatically creates a safety snapshot in the Addon storage, validates YAML syntax, appends or updates the target automation block, and triggers \`automation.reload\`.

\`\`\`json
// Example call: ha_automation_write
{
  "automation_id": "auto_hallway_motion_light",
  "label": "Add hallway nightlight motion automation",
  "yaml_code": "- id: 'auto_hallway_motion_light'\\n  alias: 'Hallway: Motion-Activated Nightlight'\\n  mode: restart\\n  trigger:\\n    - platform: state\\n      entity_id: binary_sensor.hallway_motion\\n      to: 'on'\\n  action:\\n    - action: light.turn_on\\n      target:\\n        entity_id: light.hallway\\n",
  "rationale": "Creating a safety light that triggers at night automatically."
}
\`\`\`

### Step 5: Test Trigger & Inspect Execution Logs
Validate that the newly registered automation triggers properly and executes its action sequence without runtime errors.
- Use \`ha_automation_trigger\` with \`entity_id\` (e.g. \`automation.hallway_motion_activated_nightlight\`).
- Use \`ha_system_get_logs\` to tail the latest logs and confirm clean execution with zero template errors or missing service faults.

\`\`\`json
// Example call: ha_automation_trigger
{
  "entity_id": "automation.hallway_motion_activated_nightlight"
}

// Example call: ha_system_get_logs
{
  "lines_count": 50
}
\`\`\`

---

## Tool Reference

| Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| \`ha_system_list_entities\` | Query entity IDs, states, attributes | \`domain_filter\`, \`search_query\` |
| \`ha_automation_list\` | List automations, scripts, or scenes | \`domain\` |
| \`ha_automation_read\` | Fetch YAML block of an automation | \`automation_id\` |
| \`ha_automation_write\` | Validate, snapshot, write YAML & reload | \`automation_id\`, \`yaml_code\`, \`label\`, \`rationale\` |
| \`ha_automation_trigger\` | Execute automation trigger manually | \`entity_id\` |
| \`ha_system_get_logs\` | Retrieve sanitized core log lines | \`lines_count\` |

---

## Safety Rules & Best Practices

1. **Unique ID Requirement**: Every automation block MUST have an explicit \`id\` field to enable UI editing and targeted updates.
2. **Deterministic Reloading**: Never rely on full Home Assistant restarts for automation testing; use \`ha_automation_write\`'s built-in service reload.
3. **Log Verification Gate**: Never declare an automation complete without checking \`ha_system_get_logs\` for template or service execution warnings.
4. **Appropriate Mode Selection**: Use \`mode: restart\` for motion/timer automations and \`mode: single\` or \`mode: queued\` for security/alert automations.
5. **Sandboxed Roles & Audit Logs**: Always provide a descriptive \`rationale\` parameter when deploying automations, as this is logged securely. If delegating to a coding subagent, invoke them with the restricted \`ha-automation-builder\` role via \`ha_agent_issue_token\` to enforce scope safety.
`,

  "ha-troubleshooter": `---
name: ha-troubleshooter
description: SOP for diagnosing Home Assistant errors, reviewing sanitized system logs, and executing safety rollbacks.
---

# Home Assistant Troubleshooter Skill

## Overview

The \`ha-troubleshooter\` skill establishes a structured, safety-first Standard Operating Procedure (SOP) for diagnosing system faults, analyzing sanitized log traces, detecting configuration syntax errors or integration crashes, and performing instant, non-destructive snapshot rollbacks in Home Assistant.

---

## Workflow & Steps

\`\`\`mermaid
flowchart TD
    A[Step 1: System Healthcheck] --> B[Step 2: Tail & Analyze Logs]
    B --> C{Fault / Regression Detected?}
    C -- No Fault --> D[System Operational]
    C -- Yes --> E[Step 3: Execute Safety Rollback]
    E --> F[Step 4: Verify Post-Restore Health]
    F --> G[Log Post-Mortem & Fix Root Cause]
\`\`\`

### Step 1: System Healthcheck
Initiate diagnostics by checking the operational status of both the Home Assistant Core API and the AI Addon helper daemon.
- Use \`ha_system_health\` to evaluate connectivity, component reachability, and API response latencies.
- Determine whether Home Assistant is running in normal, degraded, or recovery state.

\`\`\`json
// Example call: ha_system_health
{}
\`\`\`

### Step 2: Tail & Analyze Sanitized Logs
Inspect system logs to identify tracebacks, deprecation warnings, unhandled exceptions, template rendering faults, or integration connection failures.
- Use \`ha_system_get_logs\` specifying \`lines_count\` (e.g. 50-200 lines) and optionally \`source\` (\`core\`, \`supervisor\`, \`all\`).
- Note: System logs are automatically sanitized by the Addon backend to redact sensitive tokens, passwords, and authorization headers.
- Categorize observed errors:
  - **YAML / Syntax Errors**: Invalid keys, missing indentation, or schema validation failures in \`configuration.yaml\`, \`automations.yaml\`, or dashboards.
  - **Entity / Device Unavailable**: Missing integrations, offline Zigbee/Z-Wave nodes, or changed entity IDs.
  - **Service Call Failures**: Invocation of nonexistent services or missing target parameters.

\`\`\`json
// Example call: ha_system_get_logs
{
  "lines_count": 100,
  "source": "all"
}
\`\`\`

### Step 3: Execute Safety Rollback or Manual Backup
When an edit, automation change, or dashboard update leads to instability, regression, or syntax errors, perform an immediate safety rollback.
- If performing experimental diagnostics before a fix, create a pre-fix checkpoint using \`ha_system_create_backup\` with a descriptive \`label\`.
- If an issue was introduced by a previous tool call, locate the corresponding \`snapshot_id\` from the tool response or snapshot history.
- Use \`ha_system_restore_backup\` with \`snapshot_id\` to restore the file atomically. The Addon automatically creates a safety backup of current disk state before restoring.

\`\`\`json
// Example call: ha_system_create_backup
{
  "label": "Pre-troubleshooting configuration checkpoint",
  "rationale": "Saving state before attempting to fix syntax error in configuration.yaml"
}

// Example call: ha_system_restore_backup
{
  "snapshot_id": "snap_20260831_093000_automations_yaml",
  "rationale": "Rolling back because the new automation caused a boot loop."
}
\`\`\`

### Step 4: Verify Post-Restore System Health
After executing a rollback or applying a corrective patch, verify that the system has returned to full operational capacity.
- Re-run \`ha_system_health\` to verify that API and daemon health check reports are \`ok\`.
- Tail recent logs with \`ha_system_get_logs\` to ensure error loops and exception tracebacks have cleared.
- Query \`ha_audit_get_logs\` to ensure no \`denied_policy\` or security alerts were triggered during the fault.

\`\`\`json
// Example call: ha_system_health
{}

// Example call: ha_system_get_logs
{
  "lines_count": 50
}
\`\`\`

---

## Tool Reference

| Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| \`ha_system_health\` | Query HA Core API & Addon daemon health | *(none)* |
| \`ha_system_get_logs\` | Fetch sanitized tail of HA core & supervisor logs | \`lines_count\`, \`source\` |
| \`ha_system_create_backup\` | Create named manual snapshot backup | \`label\`, \`rationale\` |
| \`ha_system_restore_backup\` | Restore configuration from snapshot ID | \`snapshot_id\`, \`rationale\` |
| \`ha_audit_get_logs\` | Query audit logs for recent system changes | \`limit\`, \`status\` |

---

## Safety Rules & Best Practices

1. **Non-Destructive Restoration**: All restore operations conducted via \`ha_system_restore_backup\` automatically preserve the overwritten version in a safety snapshot.
2. **Sanitized Output Awareness**: \`ha_system_get_logs\` redacts secrets; never attempt to bypass log sanitization to inspect raw credentials.
3. **Rollback Over Patching Broken States**: When an unverified configuration breaks critical automations, roll back to the last known good snapshot before attempting redesigns.
4. **Mandatory Post-Restore Verification**: Always verify both \`ha_system_health\` and \`ha_system_get_logs\` after any restore or configuration repair.
5. **Sandboxed Roles & Audit Logs**: Always provide a descriptive \`rationale\` parameter when backing up or restoring configurations, as this is logged securely. If delegating to a diagnostics subagent, invoke them with the restricted \`ha-troubleshooter\` role via \`ha_agent_issue_token\` to enforce scope safety.
`
};

export function getTargetSkillsDirectories(customDir?: string): string[] {
  if (customDir) {
    return [path.resolve(customDir)];
  }

  const homedir = os.homedir();
  const candidates: string[] = [];

  const geminiSkills = path.join(homedir, ".gemini", "config", "skills");
  if (fs.existsSync(geminiSkills)) {
    candidates.push(geminiSkills);
  }

  const claudeSkills = path.join(homedir, ".claude", "skills");
  if (fs.existsSync(claudeSkills)) {
    candidates.push(claudeSkills);
  }

  const opencodeSkills = path.join(homedir, ".opencode", "skills");
  if (fs.existsSync(opencodeSkills)) {
    candidates.push(opencodeSkills);
  }

  // If none exist, default to gemini skills path
  if (candidates.length === 0) {
    candidates.push(geminiSkills);
  }

  return candidates;
}

export function syncSkills(customDir?: string, silent = false): { installedCount: number; targetDirs: string[] } {
  const targetDirs = getTargetSkillsDirectories(customDir);
  let installedCount = 0;

  for (const baseDir of targetDirs) {
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch {
        continue;
      }
    }

    for (const [skillName, content] of Object.entries(EMBEDDED_SKILLS)) {
      try {
        const skillDir = path.join(baseDir, skillName);
        if (!fs.existsSync(skillDir)) {
          fs.mkdirSync(skillDir, { recursive: true });
        }
        const skillPath = path.join(skillDir, "SKILL.md");
        fs.writeFileSync(skillPath, content, "utf8");
        installedCount++;
        if (!silent) {
          console.log(`✓ Synchronized skill: ${skillName} -> ${skillPath}`);
        }
      } catch (err: any) {
        if (!silent) {
          console.warn(`⚠️ Failed writing skill ${skillName} to ${baseDir}:`, err.message);
        }
      }
    }
  }

  return { installedCount, targetDirs };
}
