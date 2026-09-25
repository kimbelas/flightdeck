'use client';

// `make a preset` on a workflow-map row — P9-T2, moved out of `workflow-map-panel.tsx` when P9-T5's
// plugin headings pushed that file over `max-lines`.
//
// The button is drawn only where `AssetPresets` says the draft is one core would accept, and the
// press writes nothing: it hands the asset to the project row, which opens the presets editor
// with the draft. A plugin's asset is labelled by its scoped name (`scopedAssetName`), which is
// also what the smoke suite finds it by.
import type { JSX } from 'react';
import { scopedAssetName, type ClaudeAsset } from '../../contracts/claude-assets.ts';
import type { AssetPresets } from './asset-presets.ts';

/** The rule and the callback behind `make a preset`, as one prop. */
export interface AssetPress {
  readonly presets: AssetPresets;
  readonly onMake: (asset: ClaudeAsset) => void;
}

/** `make a preset` — drawn only for an asset whose draft core would accept (`AssetPresets`). */
export function MakePreset({
  asset,
  press,
}: {
  readonly asset: ClaudeAsset;
  readonly press: AssetPress | undefined;
}): JSX.Element | undefined {
  if (press?.presets.pressable(asset) !== true) return undefined;
  return (
    <button
      type="button"
      className="ghost map-make"
      aria-label={`make a preset from the ${asset.kind} ${scopedAssetName(asset)}`}
      data-map-make={`${asset.kind}:${scopedAssetName(asset)}`}
      onClick={() => {
        press.onMake(asset);
      }}
    >
      make a preset
    </button>
  );
}
