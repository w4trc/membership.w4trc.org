/**
 * Audit log - records every significant action with user, IP, and detail
 */

export async function audit(env, { userId, action, targetType, targetId, detail, request }) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, target_type, target_id, detail, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      userId     || null,
      action,
      targetType || null,
      targetId   || null,
      detail ? JSON.stringify(detail) : null,
      request ? (request.headers.get('CF-Connecting-IP') || null) : null,
      request ? (request.headers.get('User-Agent')?.slice(0, 500) || null) : null,
    ).run();
  } catch (err) {
    // Never let audit failure break the main request
    console.error('Audit log failed:', err);
  }
}
