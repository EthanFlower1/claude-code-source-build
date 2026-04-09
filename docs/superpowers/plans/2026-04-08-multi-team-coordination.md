# Multi-Team Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agent swarms to nest teams so squad leads can bridge a leadership team and their own squad, enabling agile department coordination.

**Architecture:** Extend the existing swarm system with 6 targeted changes — always-on swarms, teammate team creation, multi-team membership tracking, dual inbox polling, team-scoped SendMessage routing, and a build-time patch. No new infrastructure layer.

**Tech Stack:** TypeScript, React hooks, Zod schemas, file-based mailbox system, Bun bundler

**Spec:** `docs/superpowers/specs/2026-04-08-multi-team-coordination-design.md`

---

### Task 1: Patch `isAgentSwarmsEnabled` to always return true

**Files:**
- Modify: `source/src/utils/agentSwarmsEnabled.ts:24-44`

This is the simplest change — remove the feature gate so swarms are always available.

- [ ] **Step 1: Read the current file to confirm state**

Run: `cat source/src/utils/agentSwarmsEnabled.ts`
Confirm: File has `isAgentSwarmsEnabled()` with env var checks and GrowthBook gate.

- [ ] **Step 2: Replace the function body**

In `source/src/utils/agentSwarmsEnabled.ts`, replace the entire function body to always return true. Keep the import cleanup minimal — remove only unused imports.

Replace the full file content with:

```typescript
/**
 * Agent swarms are always enabled in this build.
 */
export function isAgentSwarmsEnabled(): boolean {
  return true
}
```

- [ ] **Step 3: Verify the build still works**

Run: `node scripts/build-cli.mjs --no-minify`
Expected: Build succeeds. The removed imports (`getFeatureValue_CACHED_MAY_BE_STALE`, `isEnvTruthy`) are no longer referenced from this file.

- [ ] **Step 4: Commit**

```bash
git add source/src/utils/agentSwarmsEnabled.ts
git commit -m "feat: enable agent swarms unconditionally"
```

---

### Task 2: Add `teamMemberships` to AppState

**Files:**
- Modify: `source/src/state/AppStateStore.ts:345` (after `teamContext` block)

Add the multi-team membership tracking array to AppState so agents can track which teams they belong to.

- [ ] **Step 1: Read current AppState type around teamContext**

Run: `cat -n source/src/state/AppStateStore.ts | sed -n '320,360p'`
Confirm: `teamContext` block ends at line 345, followed by `standaloneAgentContext`.

- [ ] **Step 2: Add `teamMemberships` field after the `teamContext` block**

In `source/src/state/AppStateStore.ts`, after the closing `}` of `teamContext?` (line 345) and before `standaloneAgentContext`, add:

```typescript
  // Tracks all teams this agent participates in (for multi-team agents like squad leads)
  teamMemberships: Array<{
    teamName: string
    agentName: string
    role: 'leader' | 'teammate'
  }>
```

- [ ] **Step 3: Find the AppState initializer and add default value**

Search for where AppState is initialized (look for `inbox: {` in the initializer to find it). Add `teamMemberships: []` to the initial state object.

Run: `grep -n "inbox:" source/src/state/AppStateStore.ts | head -5`

Add `teamMemberships: [],` to the initial state alongside the other default values.

- [ ] **Step 4: Verify the build still works**

Run: `node scripts/build-cli.mjs --no-minify`
Expected: Build succeeds. The new field is optional with a default, so no other code breaks.

- [ ] **Step 5: Commit**

```bash
git add source/src/state/AppStateStore.ts
git commit -m "feat: add teamMemberships to AppState for multi-team tracking"
```

---

### Task 3: Allow teammates to create teams

**Files:**
- Modify: `source/src/tools/TeamCreateTool/TeamCreateTool.ts:128-142`

Currently `TeamCreateTool.call()` blocks any agent that's already in a team from creating a new one. Change it so the check only blocks agents that are already *leading* a team.

- [ ] **Step 1: Read the current restriction**

In `source/src/tools/TeamCreateTool/TeamCreateTool.ts`, lines 128-142:

```typescript
async call(input, context) {
    const { setAppState, getAppState } = context
    const { team_name, description: _description, agent_type } = input

    // Check if already in a team - restrict to one team per leader
    const appState = getAppState()
    const existingTeam = appState.teamContext?.teamName

    if (existingTeam) {
      throw new Error(
        `Already leading team "${existingTeam}". A leader can only manage one team at a time. Use TeamDelete to end the current team before creating a new one.`,
      )
    }
```

- [ ] **Step 2: Change the check to only block existing leaders**

Replace lines 133-140 (the `existingTeam` check and error) with:

```typescript
    // Check if already leading a team - restrict to one team per leader
    // But allow teammates on another team to create (lead) their own team
    const appState = getAppState()
    const existingTeam = appState.teamContext?.teamName

    if (existingTeam && isTeamLead(appState.teamContext)) {
      throw new Error(
        `Already leading team "${existingTeam}". A leader can only manage one team at a time. Use TeamDelete to end the current team before creating a new one.`,
      )
    }
```

- [ ] **Step 3: Add the `isTeamLead` import**

At the top of the file, add to the imports:

```typescript
import { isTeamLead } from '../../utils/teammate.js'
```

- [ ] **Step 4: Update AppState with teamMemberships when a teammate creates a team**

After the existing `setAppState` call (around line 194) that sets `teamContext`, add code to also push to `teamMemberships`. Find the `setAppState(prev => ({` block and extend it:

```typescript
    // Update AppState with team context
    setAppState(prev => ({
      ...prev,
      teamContext: {
        teamName: finalTeamName,
        teamFilePath,
        leadAgentId,
        teammates: {
          [leadAgentId]: {
            name: TEAM_LEAD_NAME,
            agentType: leadAgentType,
            color: assignTeammateColor(leadAgentId),
            tmuxSessionName: '',
            tmuxPaneId: '',
            cwd: getCwd(),
            spawnedAt: Date.now(),
          },
        },
      },
      // Track this team in memberships for multi-inbox polling
      teamMemberships: [
        ...prev.teamMemberships,
        {
          teamName: finalTeamName,
          agentName: TEAM_LEAD_NAME,
          role: 'leader' as const,
        },
      ],
    }))
```

- [ ] **Step 5: Verify the build still works**

Run: `node scripts/build-cli.mjs --no-minify`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add source/src/tools/TeamCreateTool/TeamCreateTool.ts
git commit -m "feat: allow teammates to create their own teams"
```

---

### Task 4: Track teammate membership when joining a team

**Files:**
- Modify: `source/src/utils/swarm/teammateInit.ts` (process-based teammates)
- Modify: `source/src/utils/swarm/spawnInProcess.ts` (in-process teammates)

When an agent joins a team as a teammate (either via CLI args or in-process spawning), we need to push a `teammate` entry into `teamMemberships`.

- [ ] **Step 1: Read `teammateInit.ts` to find where AppState is updated on join**

Run: `cat -n source/src/utils/swarm/teammateInit.ts`

Find the section where `setAppState` is called to set `teamContext` for the joining teammate.

- [ ] **Step 2: Add teammate membership entry in `teammateInit.ts`**

In the `setAppState` call that sets `teamContext` for the joining process-based teammate, also push to `teamMemberships`:

```typescript
teamMemberships: [
  ...prev.teamMemberships,
  {
    teamName: teamName,
    agentName: agentName,
    role: 'teammate' as const,
  },
],
```

- [ ] **Step 3: Read `spawnInProcess.ts` to find where in-process teammate context is set**

Run: `cat -n source/src/utils/swarm/spawnInProcess.ts`

Find where the in-process teammate's AppState is initialized.

- [ ] **Step 4: Add teammate membership entry in `spawnInProcess.ts`**

If the in-process teammate has access to `setAppState`, add the same `teamMemberships` push. If context is set via `TeammateContext` (AsyncLocalStorage) instead, note that the inbox poller will need to read from `TeammateContext` to discover memberships for in-process agents. Document this finding for Task 5.

- [ ] **Step 5: Verify the build still works**

Run: `node scripts/build-cli.mjs --no-minify`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add source/src/utils/swarm/teammateInit.ts source/src/utils/swarm/spawnInProcess.ts
git commit -m "feat: track team memberships when agents join teams"
```

---

### Task 5: Multi-inbox polling in `useInboxPoller`

**Files:**
- Modify: `source/src/hooks/useInboxPoller.ts:81-105` (`getAgentNameToPoll` function)
- Modify: `source/src/hooks/useInboxPoller.ts:139-151` (poll function inbox read)

The inbox poller currently reads from a single inbox. Extend it to read from all inboxes the agent participates in.

- [ ] **Step 1: Replace `getAgentNameToPoll` with `getInboxSources`**

Replace the `getAgentNameToPoll` function (lines 81-105) with a new function that returns all inbox sources:

```typescript
/**
 * Get all inbox sources this agent should poll.
 * Returns an array of { agentName, teamName } pairs.
 * - In-process teammates return empty (they use waitForNextPromptOrShutdown)
 * - Process-based agents return one entry per team membership
 * - Standalone sessions return empty
 */
function getInboxSources(appState: AppState): Array<{ agentName: string; teamName: string }> {
  if (isInProcessTeammate()) {
    return []
  }

  // If we have explicit team memberships, use them (multi-team agents)
  if (appState.teamMemberships.length > 0) {
    return appState.teamMemberships.map(m => ({
      agentName: m.agentName,
      teamName: m.teamName,
    }))
  }

  // Fallback: single-team behavior (backward compatible)
  if (isTeammate()) {
    const name = getAgentName()
    const team = appState.teamContext?.teamName
    if (name && team) return [{ agentName: name, teamName: team }]
  }

  if (isTeamLead(appState.teamContext)) {
    const leadAgentId = appState.teamContext!.leadAgentId
    const leadName = appState.teamContext!.teammates[leadAgentId]?.name || 'team-lead'
    const team = appState.teamContext!.teamName
    return [{ agentName: leadName, teamName: team }]
  }

  return []
}
```

- [ ] **Step 2: Update the poll callback to iterate over all inbox sources**

In the `poll` callback (around line 139), replace the single `readUnreadMessages` call with a loop over all sources:

Replace:
```typescript
    const agentName = getAgentNameToPoll(currentAppState)
    if (!agentName) return

    const unread = await readUnreadMessages(
      agentName,
      currentAppState.teamContext?.teamName,
    )
```

With:
```typescript
    const inboxSources = getInboxSources(currentAppState)
    if (inboxSources.length === 0) return

    // Read unread messages from all inboxes this agent participates in
    const allUnread: Array<TeammateMessage & { _team: string }> = []
    for (const source of inboxSources) {
      const messages = await readUnreadMessages(source.agentName, source.teamName)
      for (const m of messages) {
        allUnread.push({ ...m, _team: source.teamName })
      }
    }
    const unread = allUnread

    if (unread.length === 0) return
```

- [ ] **Step 3: Update `markRead` to mark across all inboxes**

Replace the `markRead` helper (around line 200):

Replace:
```typescript
    const markRead = () => {
      void markMessagesAsRead(agentName, currentAppState.teamContext?.teamName)
    }
```

With:
```typescript
    const markRead = () => {
      for (const source of inboxSources) {
        void markMessagesAsRead(source.agentName, source.teamName)
      }
    }
```

- [ ] **Step 4: Update all remaining references to `getAgentNameToPoll`**

Search for other uses of `getAgentNameToPoll` in the file (there are 3 more: lines 886, 953, 962). Replace each with `getInboxSources` and update the logic:

For the idle delivery effect (line 886):
```typescript
    const inboxSources = getInboxSources(currentAppState)
    if (inboxSources.length === 0) return
```

For the shouldPoll check (line 953):
```typescript
    const shouldPoll = enabled && getInboxSources(store.getState()).length > 0
```

For the initial poll effect (line 962):
```typescript
    if (getInboxSources(store.getState()).length > 0) {
```

- [ ] **Step 5: Verify the build still works**

Run: `node scripts/build-cli.mjs --no-minify`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add source/src/hooks/useInboxPoller.ts
git commit -m "feat: poll multiple inboxes for multi-team agents"
```

---

### Task 6: Add `team` parameter to SendMessage

**Files:**
- Modify: `source/src/tools/SendMessageTool/SendMessageTool.ts:67-87` (input schema)
- Modify: `source/src/tools/SendMessageTool/SendMessageTool.ts:149-189` (`handleMessage`)
- Modify: `source/src/tools/SendMessageTool/SendMessageTool.ts:191-266` (`handleBroadcast`)
- Modify: `source/src/tools/SendMessageTool/SendMessageTool.ts:876-881` (call routing)

Add an optional `team` parameter so multi-team agents can specify which team to route a message through.

- [ ] **Step 1: Add `team` to the input schema**

In the `inputSchema` (line 67-87), add the `team` field after `message`:

```typescript
const inputSchema = lazySchema(() =>
  z.object({
    to: z
      .string()
      .describe(
        feature('UDS_INBOX')
          ? 'Recipient: teammate name, "*" for broadcast, "uds:<socket-path>" for a local peer, or "bridge:<session-id>" for a Remote Control peer (use ListPeers to discover)'
          : 'Recipient: teammate name, or "*" for broadcast to all teammates',
      ),
    summary: z
      .string()
      .optional()
      .describe(
        'A 5-10 word summary shown as a preview in the UI (required when message is a string)',
      ),
    message: z.union([
      z.string().describe('Plain text message content'),
      StructuredMessage(),
    ]),
    team: z
      .string()
      .optional()
      .describe(
        'Which team to route through. Required when you belong to multiple teams. Omit if you only belong to one team.',
      ),
  }),
)
```

- [ ] **Step 2: Add `team` parameter to `handleMessage`**

Change the `handleMessage` signature and body to accept an optional `teamOverride`:

```typescript
async function handleMessage(
  recipientName: string,
  content: string,
  summary: string | undefined,
  context: ToolUseContext,
  teamOverride?: string,
): Promise<{ data: MessageOutput }> {
  const appState = context.getAppState()
  const teamName = teamOverride || getTeamName(appState.teamContext)
  const senderName =
    getAgentName() || (isTeammate() ? 'teammate' : TEAM_LEAD_NAME)
  const senderColor = getTeammateColor()

  await writeToMailbox(
    recipientName,
    {
      from: senderName,
      text: content,
      summary,
      timestamp: new Date().toISOString(),
      color: senderColor,
    },
    teamName,
  )

  const recipientColor = findTeammateColor(appState, recipientName)

  return {
    data: {
      success: true,
      message: `Message sent to ${recipientName}'s inbox` + (teamOverride ? ` (via team: ${teamOverride})` : ''),
      routing: {
        sender: senderName,
        senderColor,
        target: `@${recipientName}`,
        targetColor: recipientColor,
        summary,
        content,
      },
    },
  }
}
```

- [ ] **Step 3: Add `team` parameter to `handleBroadcast`**

Change the `handleBroadcast` signature to accept an optional `teamOverride`:

```typescript
async function handleBroadcast(
  content: string,
  summary: string | undefined,
  context: ToolUseContext,
  teamOverride?: string,
): Promise<{ data: BroadcastOutput }> {
  const appState = context.getAppState()
  const teamName = teamOverride || getTeamName(appState.teamContext)
```

The rest of the function stays the same — it already uses the local `teamName` variable throughout.

- [ ] **Step 4: Add validation in `validateInput` for the `team` parameter**

After the existing validation checks (around line 717, before `return { result: true }`), add:

```typescript
    // Validate team parameter if provided
    if (input.team) {
      const appState = _context.getAppState()
      const isMember = appState.teamMemberships.some(m => m.teamName === input.team)
      if (!isMember) {
        return {
          result: false,
          message: `You are not a member of team "${input.team}". Your teams: ${appState.teamMemberships.map(m => m.teamName).join(', ') || 'none'}`,
          errorCode: 9,
        }
      }
    }
```

Note: `validateInput` receives `_context` as its second parameter. Check the existing signature — it may need to be changed from `_context` to `context` if it's currently unused.

- [ ] **Step 5: Thread `team` through the call function**

In the `call` function, around lines 876-881, update the routing to pass `input.team`:

Replace:
```typescript
      if (input.to === '*') {
        return handleBroadcast(input.message, input.summary, context)
      }
      return handleMessage(input.to, input.message, input.summary, context)
```

With:
```typescript
      if (input.to === '*') {
        return handleBroadcast(input.message, input.summary, context, input.team)
      }
      return handleMessage(input.to, input.message, input.summary, context, input.team)
```

- [ ] **Step 6: Verify the build still works**

Run: `node scripts/build-cli.mjs --no-minify`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add source/src/tools/SendMessageTool/SendMessageTool.ts
git commit -m "feat: add team parameter to SendMessage for cross-team routing"
```

---

### Task 7: Build-time patch for `isAgentSwarmsEnabled` (belt and suspenders)

**Files:**
- Modify: `scripts/build-cli.mjs` (add patch function near `patchNestedAgents`)

The overlay in Task 1 handles the source file, but add a build-time patch as a safety net — similar to how `patchNestedAgents` works. This ensures the change survives even if the overlay mechanism has edge cases.

- [ ] **Step 1: Find `patchNestedAgents` in the build script**

Run: `grep -n "function patchNestedAgents" scripts/build-cli.mjs`
Expected: Line 637.

- [ ] **Step 2: Add `patchAgentSwarmsEnabled` function after `patchNestedAgents`**

After the `patchNestedAgents` function (around line 648), add:

```javascript
function patchAgentSwarmsEnabled() {
  const filePath = path.join(workspaceRoot, 'src/utils/agentSwarmsEnabled.ts');
  if (!isFile(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  // Replace the function body to always return true
  const needle = `if (process.env.USER_TYPE === 'ant')`;
  if (contents.includes(needle)) {
    const updated = contents.replace(
      /export function isAgentSwarmsEnabled\(\): boolean \{[\s\S]*?\n\}/,
      'export function isAgentSwarmsEnabled(): boolean {\n  return true\n}',
    );
    fs.writeFileSync(filePath, updated, 'utf8');
  }
}
```

- [ ] **Step 3: Call the patch in `generateWorkspaceAugmentations`**

In `generateWorkspaceAugmentations()` (around line 350-368), add the call after `patchNestedAgents()`:

```javascript
  patchNestedAgents();
  patchAgentSwarmsEnabled();
```

- [ ] **Step 4: Verify a clean build**

Run:
```bash
rm -f .cache/workspace/.prepared.json
node scripts/build-cli.mjs --no-minify
```
Expected: Build succeeds. The patch fires after overlay, ensuring the function always returns true regardless of source map contents.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-cli.mjs
git commit -m "feat: add build-time patch for always-on agent swarms"
```

---

### Task 8: End-to-end verification

**Files:**
- No file changes. Manual verification.

- [ ] **Step 1: Clean build**

```bash
rm -f .cache/workspace/.prepared.json
node scripts/build-cli.mjs --no-minify
```
Expected: Build completes without errors.

- [ ] **Step 2: Launch and verify swarms are enabled**

```bash
node dist/cli.js -p "Are agent swarms enabled? Try using TeamCreate to create a test team called 'test-leadership'. Then exit."
```
Expected: Agent creates a team without needing `--agent-teams` flag or env var.

- [ ] **Step 3: Verify nested team creation works**

This requires a manual test with tmux or by observing in-process behavior:

```bash
node dist/cli.js --agent-teams -p "Create a team called 'leadership'. Spawn a teammate called 'squad-lead-a'. Have squad-lead-a create its own team called 'backend-squad'. Report what happens."
```
Expected: The teammate (squad-lead-a) successfully creates its own team without the "Already leading team" error.

- [ ] **Step 4: Commit (if any fixes were needed)**

Only commit if issues were discovered and fixed in previous steps.
