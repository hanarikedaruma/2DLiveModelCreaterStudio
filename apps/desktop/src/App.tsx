import type { Services } from '@app/contracts';
import { useEffect } from 'react';
import { bindStudioEnvironment } from './modes/studio/environment';
import type { DialogController } from './shell/dialogs';
import type { EnvironmentStore } from './shell/environment';
import { Shell } from './shell/Shell';

export function App({
  services,
  environment,
  dialogs,
}: {
  services: Services;
  environment: EnvironmentStore;
  dialogs?: DialogController;
}) {
  useEffect(() => bindStudioEnvironment(services, environment), [services, environment]);
  return (
    <div data-testid="app-root" style={{ height: '100%' }}>
      <Shell services={services} environment={environment} dialogs={dialogs} />
    </div>
  );
}
