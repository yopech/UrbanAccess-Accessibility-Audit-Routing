import { validateAuditReadiness, type Audit } from '../../domain/audit-model.js';
import { type AuditTemplate } from '../../templates/z2-template.js';
import type { VoiceDraft } from '../../voice/voice-drafts.js';
export { validateAuditReadiness };
export function pendingVoiceDrafts(drafts: readonly VoiceDraft[]): VoiceDraft[] {
  return drafts.filter((draft) => !draft.appliedAt && draft.state !== 'discarded' && (draft.reviewText.trim() !== '' || draft.finalSegments.length > 0));
}
export function auditReadiness(audit: Audit, drafts: readonly VoiceDraft[], template?: AuditTemplate) {
  const questions = validateAuditReadiness(audit, template); const pendingDrafts = pendingVoiceDrafts(drafts);
  const notReady = Object.values(audit.elements).filter((element) => element.readiness !== 'ready' || questions.some((question) => question.elementId === element.id)).length;
  return { questions, pendingDrafts, notReady, ready: questions.length === 0 && pendingDrafts.length === 0 };
}
