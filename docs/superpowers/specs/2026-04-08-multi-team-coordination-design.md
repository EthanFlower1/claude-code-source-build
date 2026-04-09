# Multi-Team Coordination via Nested Agent Swarms

## Summary

Enable multiple agent teams to coordinate as an agile engineering department by allowing agents to participate in multiple teams simultaneously. The hierarchy emerges from agents creating their own teams while being teammates on higher-level teams. No new infrastructure layer — the existing swarm system (TeamCreate, SendMessage, mailboxes) is extended with minimal changes.

## Goals

- Full Scrum hierarchy: Product Owner, Scrum Master, Squad Leads, Specialists
- Full ceremonies: sprint planning, standups, sprint review, retro
- Human stakeholder attends ceremonies and approves direction
- No hard ceiling on scale — many squads, shared teams, multiple POs
- Squads persist across sprints

## Architecture

### Core Idea

The department is nested teams. The hierarchy emerges from agents creating their own teams.

```
Human (Stakeholder)
 └─ PO Agent (spawned directly by human)
     └─ TeamCreate "leadership"
         ├─ SM Agent (teammate)
         ├─ Squad Lead A (teammate)
         │   └─ TeamCreate "backend-squad"
         │       ├─ api-dev (teammate)
         │       └─ db-dev (teammate)
         └─ Squad Lead B (teammate)
             └─ TeamCreate "frontend-squad"
                 ├─ ui-dev (teammate)
                 └─ ux-dev (teammate)
```

### Relationship to Existing System

Each squad is a standard Claude Code team. The squad lead is the `team-lead` of that squad. Specialists are teammates. All intra-squad communication uses the existing mailbox system unchanged. The leadership team is also a standard team — the PO leads it, SM and squad leads are teammates.

A squad lead is the bridge between layers: it's a teammate on the leadership team and a leader of its own squad team.

## Required Code Changes

### 1. Patch `isAgentSwarmsEnabled()` — always return true

**File**: `source/src/utils/agentSwarmsEnabled.ts`

Replace the function body with `return true`. Alternatively, patch in `build-cli.mjs` similar to `patchNestedAgents`.

### 2. Allow teammates to create teams

**File**: `source/src/tools/TeamCreateTool/TeamCreateTool.ts`

Currently `call()` checks if the agent is already in a team and throws. Change this: if the agent is a teammate on one team, it can still create (lead) a different team. The restriction becomes "you can only lead one team" not "you can only be in one team."

```typescript
// Before
if (existingTeam) {
  throw new Error(`Already leading team "${existingTeam}"...`)
}

// After: check if leading, not just participating
if (existingTeam && isTeamLead(appState.teamContext)) {
  throw new Error(`Already leading team "${existingTeam}"...`)
}
```

### 3. Track multiple team memberships

**File**: `source/src/utils/teammate.ts` and AppState types

Add a `teamMemberships` array to AppState alongside the existing `teamContext`:

```typescript
teamMemberships: Array<{
  teamName: string
  agentName: string
  role: 'leader' | 'teammate'
}>
```

When `TeamCreate` is called by a teammate, push a new entry with role `leader`. When the agent joins a team as a teammate, push with role `teammate`. The existing `teamContext` continues to point to the team the agent leads (for backward compatibility). The membership list is used by the inbox poller.

### 4. Multi-inbox polling

**File**: `source/src/hooks/useInboxPoller.ts`

Extend the poller to iterate over `teamMemberships` and read from each inbox:

```typescript
// Before
const messages = await readUnreadMessages(agentName, teamName)

// After
for (const membership of teamMemberships) {
  const messages = await readUnreadMessages(membership.agentName, membership.teamName)
  allMessages.push(...messages.map(m => ({ ...m, _team: membership.teamName })))
}
```

Each poll cycle reads from all sources. Messages are tagged with which team they came from so the agent knows the context when responding.

### 5. Add optional `team` parameter to SendMessage

**File**: `source/src/tools/SendMessageTool/SendMessageTool.ts`

Add `team` to the input schema:

```typescript
team: z.string().optional().describe(
  'Which team to route through. Required when you belong to multiple teams. Defaults to your primary team.'
)
```

In the `call()` function, resolve the team context from this parameter before routing to `handleMessage()` or `handleBroadcast()`. Validate that the agent actually belongs to the specified team.

### 6. No other infrastructure changes

Mailbox file format, locking, task lists, backends, ceremony lifecycle — all handled by existing infrastructure plus agent system prompts.

### Files Touched

| File | Change |
|---|---|
| `utils/agentSwarmsEnabled.ts` | Return `true` unconditionally |
| `tools/TeamCreateTool/TeamCreateTool.ts` | Allow teammates to create teams |
| `utils/teammate.ts` | Add multi-team membership tracking |
| `hooks/useInboxPoller.ts` | Poll multiple inboxes |
| `tools/SendMessageTool/SendMessageTool.ts` | Add optional `team` parameter |
| AppState types | Add `teamMemberships` field |

## Communication Architecture

### Embassy Model (Prompt-Enforced)

Specialists never communicate cross-team directly. All cross-team communication flows through squad leads, SM, and PO. This is enforced by system prompts, not by code.

### Message Routing

```
PO sends "Here are your sprint stories"
  → SendMessage(to: "lead-backend", team: "leadership")
  → writes to ~/.claude/teams/leadership/inboxes/lead-backend.json
  → Squad Lead's poller picks it up (leadership team inbox)

Specialist sends "Task done, tests passing"
  → SendMessage(to: "team-lead")
  → writes to ~/.claude/teams/backend-squad/inboxes/team-lead.json
  → Squad Lead's poller picks it up (squad team inbox)

Squad Lead replies to PO
  → SendMessage(to: "po", message: "Sprint update...", team: "leadership")
  → writes to ~/.claude/teams/leadership/inboxes/po.json
```

### In-Process Squad Leads

For in-process teammates on the leadership team that also lead their own squad: the existing `queuePendingMessage` delivers leadership-team messages, and the file-based inbox handles squad-team messages (since the squad lead creates its own team file via `TeamCreate`).

## Scrum Process (Prompt-Enforced)

### Roles and System Prompts

**PO Agent:**
- On startup: create leadership team, spawn SM and squad leads
- Maintain a backlog file (in project directory) with epics and stories
- Prioritize stories based on stakeholder input
- Never write code directly — only define work and accept/reject results
- At sprint planning: present stories to squad leads, collect capacity, finalize assignments
- At sprint review: review completed work against acceptance criteria
- Escalate to stakeholder via `AskUserQuestion` for priority decisions and ceremony attendance

**SM Agent:**
- Monitor sprint health by periodically asking squad leads for status
- Facilitate cross-squad blocker resolution
- Trigger ceremonies at appropriate moments
- Collect structured responses, synthesize, present to stakeholder
- Track retro action items

**Squad Lead:**
- Break assigned stories into tasks for specialists
- Monitor specialist progress, unblock where possible
- Report status at standups
- Mark stories as in-review when complete
- Bridge role: translate cross-team messages into actionable tasks

**Specialist:**
- Work on assigned tasks
- Report completion or blockers to squad lead
- Never communicate cross-team
- Follow coding conventions in CLAUDE.md

### Sprint Lifecycle

Sprints are goal-scoped, not time-boxed. A sprint ends when the sprint goal stories are done/reviewed, not after a timer. Ceremonies are event-driven:

- **Planning**: PO signals backlog is ready, SM facilitates
- **Standup**: Triggered when a squad finishes a story, reports a blocker, or SM decides a checkpoint is needed
- **Review**: All sprint stories complete or in review
- **Retro**: After review closes

### Ceremony Flow Example (Standup)

```
1. SM → SendMessage(to: "*", team: "leadership")
   "Standup: report completed, in-progress, blockers"

2. Squad Lead A reads from leadership inbox
   → Reviews own squad's task list
   → SendMessage(to: "sm-1", team: "leadership")
   "{completed: [...], inProgress: [...], blockers: [...]}"

3. Squad Lead B does the same

4. SM collects responses, synthesizes
   → Identifies cross-squad blocker
   → SendMessage to relevant lead
   → AskUserQuestion("Standup summary: ... Any questions?")

5. Human responds or approves
```

### Prompt Drift Mitigation

- Strong system prompts with explicit rules
- SM agent's primary job is enforcing process
- Role instructions are in system prompt (never compacted away)
- If drift becomes a problem in practice, lightweight validation can be added later (e.g., SendMessage rejecting messages from specialists to non-squad-lead recipients)

## Design Decisions

### Why nested teams over a department layer

A dedicated department layer with new domain objects, message types, and ceremony infrastructure would be ~70% more code. The nested teams approach reuses the existing swarm system entirely, shifting process enforcement from code to prompts. This is simpler to implement, easier to maintain, and doesn't introduce a new abstraction layer.

### Why prompt-enforced process over code-enforced

Code-enforced process (typed department messages, role-based access control, sprint state machines) provides stronger guarantees but at the cost of significant new infrastructure. Prompt enforcement is fragile under drift but sufficient for the initial implementation. Hard guardrails can be added incrementally if needed.

### Why goal-scoped sprints over time-boxed

Agents don't need the rhythm that humans need. Time-boxing would require a timer/scheduler with no clear benefit. Goal-scoping keeps sprints focused on delivery.

### Why embassy model over flat mesh

Flat mesh (any agent talks to any agent) creates O(n^2) communication paths. Embassy model (cross-team communication only through leads) keeps message volume at O(squads) for cross-team coordination while allowing O(squad_size) within each squad.
