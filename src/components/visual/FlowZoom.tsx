import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { ZoomMeter } from '../ui';

/** Zoom slider for React Flow boards; wheel/pinch zoom keep working. */
export function FlowZoom({ min, max, fitMax = 1, padding = 0.25 }: { min: number; max: number; fitMax?: number; padding?: number }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <Panel position="bottom-left">
      <ZoomMeter className="inline flow-zoom" value={zoom} min={min} max={max}
        onChange={(z) => rf.zoomTo(z, { duration: 120 })}
        onFit={() => rf.fitView({ padding, maxZoom: fitMax, duration: 300 })} />
    </Panel>
  );
}
