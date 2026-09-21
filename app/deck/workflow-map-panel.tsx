'use client';

// What Claude is configured to do in one imported folder — P3-T3, SPEC §5.1(a).
//
// **Closed by default, and the summary is the whole point.** A repository with 3 agents, 3
// commands, 10 skills and 17 hooks does not fit on a row, so the closed state is the counts and
// the open state is the detail. `<details>` rather than a flag in the store, because which
// sections one person has open is not state anything else in the deck needs — and it is keyboard
// accessible and survives a re-render without a `useEffect`.
//
// **Every decision is in `WorkflowMapViewModel`** — the sentence for a folder with no `.claude`,
// the `3.4 kB`, the plural of "allow rule", the grouping of the timeline. What is left here is
// markup (CODING-STANDARDS §3).
//
// **The three strings that came off disk are rendered as text**: an asset's name, its description
// and a hook's command. React escapes them, there is no `dangerouslySetInnerHTML` anywhere in this
// repo (§11), and the file they came out of belongs to a repository the owner imported themselves.
import type { JSX } from 'react';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import type { HookStep } from '../../contracts/hook-timeline.ts';
import type { WorkflowMapViewModel } from './workflow-map-view-model.ts';

interface WorkflowMapPanelProps {
  readonly model: WorkflowMapViewModel;
  /** For the `aria-label`, so two open panels are distinguishable to a screen reader. */
  readonly project: string;
}

export function WorkflowMapPanel({ model, project }: WorkflowMapPanelProps): JSX.Element | null {
  // Nothing at all until the first reply — a folder whose map has not arrived draws no section
  // rather than an empty one, which is the same rule `ProjectMeta` follows for git.
  if (!model.isKnown) return null;
  return (
    <details className="project-detail project-map">
      <summary aria-label={`workflow map for ${project}`}>
        <Summary model={model} />
      </summary>
      <Stack model={model} />
      {/*
        Outside `Configured` on purpose (P3-T4): a worktree is a fact about the repository, not
        about its `.claude`, so a repo that configures nothing and has three checkouts still says
        so. It is also why it is not folded into the closed summary — that line is the shape of the
        config, and the P3 gate's second half is that a folder with no `.claude` collapses to one
        sentence rather than to a row of counts.
      */}
      <Names title="worktrees" names={model.worktrees} />
      {model.isConfigured ? <Configured model={model} /> : null}
    </details>
  );
}

/** The closed line: the counts, or the sentence for a repository that configures nothing. */
function Summary({ model }: { readonly model: WorkflowMapViewModel }): JSX.Element {
  if (model.summary.length === 0) {
    return <span className="muted">{model.emptyMessage}</span>;
  }
  return (
    <span className="map-summary">
      {model.summary.map((part) => (
        <span key={part} className="map-count">
          {part}
        </span>
      ))}
    </span>
  );
}

/** SPEC §5.1's first row: which files speak here, in resolution order, with their sizes. */
function Stack({ model }: { readonly model: WorkflowMapViewModel }): JSX.Element {
  return (
    <Section title="instruction stack">
      <ul className="map-stack">
        {model.instructions.map((file) => (
          // The absent ones are drawn too, dimmed: "this repo has no CLAUDE.md" is the answer the
          // row exists to give, and a list that omitted them could not give it.
          <li key={file.source} className={file.size === undefined ? 'muted' : undefined}>
            <span className="map-file">{file.name}</span>
            <span className="map-size">{file.size ?? '—'}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Everything that comes out of a `.claude` — drawn only for a repository that has one. */
function Configured({ model }: { readonly model: WorkflowMapViewModel }): JSX.Element {
  return (
    <>
      <Assets title="subagents" assets={model.agents} />
      <Assets title="commands" assets={model.commands} />
      <Assets title="skills" assets={model.skills} />
      <Timeline model={model} />
      <Names title="MCP servers" names={model.servers} />
      <Names title="plugins" names={model.plugins} />
      <Names title="marketplaces" names={model.marketplaces} />
      <Permissions model={model} />
      <Names title="conventions" names={model.conventions} />
    </>
  );
}

interface AssetsProps {
  readonly title: string;
  readonly assets: readonly ClaudeAsset[];
}

/** A roster — name, what triggers it, and the model and tools when the file names them. */
function Assets({ title, assets }: AssetsProps): JSX.Element | null {
  if (assets.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="map-assets">
        {assets.map((asset) => (
          <li key={asset.name}>
            <span className="map-asset-name">{asset.name}</span>
            {asset.model !== undefined && <span className="map-badge">{asset.model}</span>}
            {asset.tools.length > 0 && <span className="map-badge">{asset.tools.join(', ')}</span>}
            {asset.description !== undefined && (
              <span className="map-trigger">{asset.description}</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The trigger timeline: event → matcher → `if:` → script, in the order it runs. */
function Timeline({ model }: { readonly model: WorkflowMapViewModel }): JSX.Element | null {
  if (model.hookGroups.length === 0) return null;
  return (
    <Section title="hooks">
      {model.hookGroups.map((group) => (
        <div key={group.event} className="map-hook-group">
          <span className="map-event">{group.event}</span>
          <ol className="map-hooks">
            {group.steps.map((step, index) => (
              // Indexed because two identical commands under one event is a real configuration —
              // the same guard wired to `Read` and to `Edit` — and neither is a duplicate to drop.
              <li key={`${step.command}:${String(index)}`}>
                <HookRow step={step} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </Section>
  );
}

function HookRow({ step }: { readonly step: HookStep }): JSX.Element {
  return (
    <>
      {step.matcher !== undefined && <span className="map-matcher">{step.matcher}</span>}
      {step.condition !== undefined && <span className="map-if">{step.condition}</span>}
      <span className="map-command" title={step.command}>
        {step.command}
      </span>
      {step.async && <span className="map-badge">async</span>}
      {step.timeoutSeconds !== undefined && (
        <span className="map-badge">{`${String(step.timeoutSeconds)}s`}</span>
      )}
    </>
  );
}

/** Counts closed, full list open — SPEC's own split for this row. */
function Permissions({ model }: { readonly model: WorkflowMapViewModel }): JSX.Element | null {
  const summary = model.permissions;
  if (summary === undefined) return null;
  return (
    <Section title="permissions">
      <details className="map-permissions">
        <summary>{summary}</summary>
        <ul>
          {model.permissionRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

interface NamesProps {
  readonly title: string;
  readonly names: readonly string[];
}

/** A row of labels, absent entirely when there are none. */
function Names({ title, names }: NamesProps): JSX.Element | null {
  if (names.length === 0) return null;
  return (
    <Section title={title}>
      <span className="map-names">
        {names.map((name) => (
          <span key={name} className="map-badge">
            {name}
          </span>
        ))}
      </span>
    </Section>
  );
}

interface SectionProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

function Section({ title, children }: SectionProps): JSX.Element {
  return (
    <section className="map-section" aria-label={title}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}
