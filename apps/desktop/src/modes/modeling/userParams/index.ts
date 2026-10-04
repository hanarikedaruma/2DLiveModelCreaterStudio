// カード34: ユーザー定義パラメータ。register() でパラメータパネルに一覧・追加・編集・削除のセクションを入れる
import { registerPanelSection } from '../../../shell/api';
import { PARAMETER_PANEL_ID } from '../parameters/ParameterPanel';
import { UserParamsSection } from './UserParamsSection';

export {
  addParameterCommand,
  removeParameterCommand,
  updateParameterCommand,
  parameterUsage,
  userParameters,
} from './userParams';

export const USER_PARAMS_SECTION_ID = 'modeling.userParams';

export function register(): void {
  registerPanelSection({
    id: USER_PARAMS_SECTION_ID,
    panelId: PARAMETER_PANEL_ID,
    order: 20,
    component: UserParamsSection,
  });
}
