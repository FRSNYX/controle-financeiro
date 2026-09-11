import { run } from '../db/index.js';

/**
 * RN — histórico de alterações. Grava before/after de toda escrita relevante.
 * Auditoria nunca deve derrubar a operação principal, por isso o try/catch.
 */
export async function logAudit({ userId, entity, entityId, action, summary, before, after }) {
  try {
    await run(
      `INSERT INTO audit_log (user_id, entity, entity_id, action, summary, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        entity,
        entityId ?? null,
        action,
        summary ?? null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
      ],
    );
  } catch (err) {
    console.error('[audit] falha ao registrar:', err.message);
  }
}

export async function notify({ userId, type, severity = 'info', title, message, entity, entityId, refDate }) {
  try {
    await run(
      `INSERT INTO notifications (user_id, type, severity, title, message, entity, entity_id, ref_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, type, severity, title, message ?? null, entity ?? null, entityId ?? null, refDate ?? null],
    );
  } catch (err) {
    console.error('[notify] falha ao registrar:', err.message);
  }
}
