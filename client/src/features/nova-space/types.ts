export type VisualizationType =
  | 'molecule3d'
  | 'graph3d'
  | 'scatter3d'
  | 'timeseries'
  | 'heatmap'
  | 'text'
  | 'none';

export type ExperimentPhase =
  | 'plan'
  | 'execute'
  | 'interpret'
  | 'store'
  | 'error'
  | 'done';

export interface ExperimentResult {
  id:             string;
  hypothesis:     string;
  success:        boolean;
  stdout:         string;
  stderr:         string;
  visualization:  VisualizationType;
  visData:        Record<string, unknown>;
  interpretation: string;
  error?:         string;
  durationMs:     number;
  ts:             number;
}

export interface ExperimentEvent {
  phase:        ExperimentPhase;
  text:         string;
  experimentId: string;
  result?:      ExperimentResult;
  ts:           number;
}
