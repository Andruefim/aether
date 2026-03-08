// ─── Shared types for Nova experiments ────────────────────────────────────────

export type ExperimentDomain =
  | 'molecular'    // RDKit, BioPython, PubChem
  | 'data'         // pandas, scipy, numpy
  | 'network'      // networkx (gene/pathway graphs)
  | 'simulation'   // physics/numerical
  | 'custom';      // free-form Python

export type VisualizationType =
  | 'molecule3d'   // atoms + bonds → Three.js spheres/cylinders
  | 'graph3d'      // nodes + edges → force-directed 3D
  | 'scatter3d'    // 3D scatter plot
  | 'timeseries'   // 2D line chart (rendered in 3D space)
  | 'heatmap'      // 2D grid heat map
  | 'text'         // plain markdown result
  | 'none';

export interface ExperimentPlan {
  id:            string;
  hypothesis:    string;
  domain:        ExperimentDomain;
  approach:      string;           // one-sentence description
  code:          string;           // Python code to run
  visualization: VisualizationType;
  goalContext:   string;
}

export interface ExperimentResult {
  id:            string;
  hypothesis:    string;
  success:       boolean;
  stdout:        string;
  stderr:        string;
  visualization: VisualizationType;
  visData:       Record<string, unknown>; // structured data for Three.js renderer
  interpretation: string;                // VLM / LLM textual finding
  screenshotB64?: string;                // base64 PNG sent to VLM
  error?:        string;
  durationMs:    number;
  ts:            number;
}

// ── SSE event emitted while experiment runs ───────────────────────────────────
export type ExperimentPhase =
  | 'plan'
  | 'execute'
  | 'interpret'
  | 'store'
  | 'error'
  | 'done';

export interface ExperimentEvent {
  phase:        ExperimentPhase;
  text:         string;
  experimentId: string;
  result?:      ExperimentResult;
  ts:           number;
}
