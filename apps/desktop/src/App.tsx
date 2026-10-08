import type { Services } from '@app/contracts';
import { useEffect } from 'react';
import { bindStudioEnvironment } from './modes/studio/environment';
import type { DialogController } from './shell/dialogs';
import type { EnvironmentStore } from './shell/environment';
import { Shell } from './shell/Shell';
import type { CanvasController } from './shell/canvas/controller';

export function App({
  services,
  environment,
  dialogs,
  canvas,
}: {
  services: Services;
  environment: EnvironmentStore;
  dialogs?: DialogController;
  canvas?: CanvasController;
}) {
  useEffect(() => bindStudioEnvironment(services, environment), [services, environment]);
  return (
    <div data-testid="app-root" style={{ height: '100%' }}>
      <Shell services={services} environment={environment} dialogs={dialogs} canvas={canvas} />
    </div>
  );
}
