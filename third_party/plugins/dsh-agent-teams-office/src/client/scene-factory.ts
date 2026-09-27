import type { OfficeScene, ViewMode } from '../types.ts';
import { createOfficeScene as createPixelScene } from './scene.ts';
import { createTeamOfficeScene } from './team-office/scene.ts';

export function createOfficeScene(element: HTMLElement, select: (id: string) => void, error: (error: Error) => void, options: { view?: ViewMode } = {}): Promise<OfficeScene> {
  return options.view === 'pixel' ? createPixelScene(element, select, error)
    : createTeamOfficeScene(element, select, error);
}
