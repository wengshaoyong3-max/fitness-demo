export interface WorkoutAction {
  id: string;
  stage: string;
  actionName: string;
  repsSets: string;
  targetMuscle: string;
  timestamp: string;
  notes: string;
  imageUrl: string;
}

export interface ExtractionResult {
  title: string;
  actions: WorkoutAction[];
}
