import type { Project } from '@app/schema';
import { bounceReason, withChestPhysics } from '../physics/bounce';

export function setupChest(project: Project, nextId: () => string, warnings?: string[]): Project {
  let next = project;
  for (const part of project.model.parts.filter((p) => p.kind === 'image' && p.standardType === 'chest')) {
    const item = next.physics.find((p) => p.partId === part.id);
    if (item?.deform === 'bounce') {
      const reason = bounceReason(next, item);
      if (reason) warnings?.push(`${part.name}：${reason}`);
      continue;
    }
    if (item) continue; // 既に選んだ別の方式・手編集をセットアップで切り替えない
    try {
      next = withChestPhysics(next, part.id, { physics: nextId(), horizontal: nextId(), vertical: nextId() });
    } catch (error) {
      warnings?.push(`${part.name}：${error instanceof Error ? error.message : '胸揺れを設定できません。'}`);
    }
  }
  return next;
}
