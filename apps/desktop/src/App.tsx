import type { Services } from '@app/contracts';
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
  return (
    <div data-testid="app-root" style={{ height: '100%' }}>
      <Shell services={services} environment={environment} dialogs={dialogs} />
    </div>
  );
}
