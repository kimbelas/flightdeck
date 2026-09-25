'use client';

// The three things you open on a project row when the summary line is not enough — the presets,
// what Claude is CONFIGURED to do here, and what it ACTUALLY did.
//
// One component because they are one idea, and a file of its own since P9-T2 gave it state and
// pushed `projects-panel.tsx` over its line limit. The order is the argument: SPEC §5.1(b)'s whole
// point is the contrast between the map and the reading, so the two are adjacent.
//
// **The map's `make a preset` lands in the presets editor above it (P9-T2)**, so the draft is held
// here, the nearest place both panels share. It is state of this row alone and of nothing else in
// the deck, and it is never sent anywhere: the editor sends only what save or start sends.
import { useState, type JSX } from 'react';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import type { PresetDraft, PresetLaunch, PresetRef } from '../../contracts/launch-preset.ts';
import { ObservedPanel } from './observed-panel.tsx';
import { PresetsPanel } from './presets-panel.tsx';
import type { PresetLine } from './presets-view-model.ts';
import type { ProjectLine } from './projects-view-model.ts';
import { WorkflowMapPanel } from './workflow-map-panel.tsx';

/** The three preset callbacks, as one prop: `max-params` applies to a component's props too. */
export interface PresetActions {
  readonly onLaunch: (request: PresetLaunch) => void;
  readonly onSavePreset: (draft: PresetDraft) => void;
  readonly onForgetPreset: (ref: PresetRef) => void;
}

interface ProjectPanelsProps {
  readonly line: ProjectLine;
  readonly disabled: boolean;
  readonly onObserve: (path: string) => void;
  readonly presets: PresetActions;
}

export function ProjectPanels({
  line,
  disabled,
  onObserve,
  presets,
}: ProjectPanelsProps): JSX.Element {
  const draft = useMapDraft(line);
  return (
    <>
      <PresetsPanel
        model={line.presets}
        projectPath={line.path}
        projectName={line.name}
        disabled={disabled}
        onLaunch={presets.onLaunch}
        onSave={presets.onSavePreset}
        onForget={presets.onForgetPreset}
        mapDraft={draft.line}
        onDropDraft={draft.drop}
      />
      <WorkflowMapPanel
        model={line.map}
        project={line.name}
        drift={line.drift}
        press={{ presets: line.assetPresets, onMake: draft.make }}
      />
      <ObservedPanel
        path={line.path}
        name={line.name}
        reading={line.observed}
        asked={line.observedAsked}
        disabled={disabled}
        onRead={onObserve}
      />
    </>
  );
}

interface MapDraft {
  /** The draft on screen, or `undefined` when the editor shows a chip or nothing. */
  readonly line: PresetLine | undefined;
  readonly make: (asset: ClaudeAsset) => void;
  readonly drop: () => void;
}

/**
 * The draft a map row opened, and the count of presses that keys it.
 *
 * Counted so a second press on the same row remounts the editor with a fresh draft rather than
 * keeping what was half-typed into the first — the React key is what resets the boxes.
 */
function useMapDraft(line: ProjectLine): MapDraft {
  const [draft, setDraft] = useState<PresetLine | undefined>(undefined);
  const [presses, setPresses] = useState(0);
  return {
    line: draft,
    make: (asset) => {
      setDraft(line.assetPresets.draftFor(asset, presses));
      setPresses(presses + 1);
    },
    drop: () => {
      setDraft(undefined);
    },
  };
}
