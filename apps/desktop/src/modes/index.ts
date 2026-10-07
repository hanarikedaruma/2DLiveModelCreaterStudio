// 各モードの部品を枠に登録する。キャンバスのツールは最初に登録したものが既定になるので、選択・変形（カード18）を先にする
import { register as registerCanvasEdit } from './modeling/canvas';
import { register as registerAssets } from './modeling/assets';
import { register as registerParameters } from './modeling/parameters';
import { register as registerStructure } from './modeling/structure';
import { register as registerMeshEdit } from './modeling/mesh';
import { register as registerStudio } from './studio';
import { register as registerStudioProducers } from './studio/producers'; // カード36
import { register as registerWarp } from './modeling/warp'; // カード29
import { register as registerBlend } from './modeling/blend'; // カード32
import { register as registerHotkeys } from '../hotkeys'; // カード40
import { register as registerGrid2d } from './modeling/grid2d'; // カード30
import { register as registerScenes } from './studio/scenes'; // カード39
import { register as registerLipSync } from './studio/lipsync'; // カード37
import { register as registerModelingExpressions } from './modeling/expressions'; // カード38
import { register as registerStudioExpressions } from './studio/expressions'; // カード38
import { register as registerCalibration } from './studio/calibration'; // カード35
import { register as registerOpacityKey } from './modeling/opacity'; // カード34
import { register as registerUserParams } from './modeling/userParams'; // カード34
import { register as registerSpout } from '../output/spout'; // カード41
import { register as registerPsdReload } from './modeling/assets/reload'; // カード43
import { register as registerSetupTools } from './modeling/setupTools'; // カード42
import { register as registerStudioAnimations } from './studio/animations'; // カード47
import { register as registerAnimation } from './animation'; // カード46
import { register as registerPhysics } from './modeling/physics'; // カード50
import { register as registerPeriodic } from './studio/periodic'; // カード48
import { register as registerVowels } from './modeling/vowels'; // カード51
import { register as registerTrackingMap } from './studio/trackingMap'; // I-042

export function registerModes(): void {
  registerCanvasEdit(); // カード18
  registerAssets(); // カード17
  registerParameters(); // カード19
  registerStructure(); // カード20
  registerMeshEdit(); // カード21
  registerStudio(); // カード22
  registerStudioProducers(); // カード36
  registerWarp(); // カード29
  registerBlend(); // カード32
  registerStudioExpressions(); // カード38（表情とホットキーの順は、カード65の専用の層で決まる）
  registerHotkeys(); // カード40
  registerGrid2d(); // カード30
  registerScenes(); // カード39
  registerLipSync(); // カード37
  registerModelingExpressions(); // カード38
  registerCalibration(); // カード35
  registerOpacityKey(); // カード34
  registerUserParams(); // カード34
  registerSpout(); // カード41
  registerPsdReload(); // カード43
  registerSetupTools(); // カード42
  registerStudioAnimations(); // カード47
  registerAnimation(); // カード46
  registerPhysics(); // カード50
  registerPeriodic(); // カード48
  registerVowels(); // カード51
  registerTrackingMap(); // I-042
}
