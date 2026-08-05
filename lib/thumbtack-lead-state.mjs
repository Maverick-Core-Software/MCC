// Pure intake classification for the Thumbtack customer channel. It does not
// call an LLM, send a message, or initiate any HCP workflow.

const CUSTOMER_SENDER = /\bcustomer\b/i;
const READY_BLOCK = /\[THUMBTACK_ESTIMATE_READY\]([\s\S]*?)\[\/THUMBTACK_ESTIMATE_READY\]/g;

function eventType(payload) {
  return payload?.eventType || payload?.type || payload?.event?.eventType || payload?.event?.type || 'unknown';
}

export function extractCustomerLeadEvent(record) {
  const payload = record?.payload;
  const data = payload?.data || payload?.event?.data || {};
  if ((record?.eventType || eventType(payload)) !== 'MessageCreatedV4' || !CUSTOMER_SENDER.test(String(data.from || ''))) return null;

  const negotiationID = String(data.negotiationID || '').trim();
  const messageID = String(data.messageID || '').trim();
  const text = String(data.text || '').trim();
  if (!record?.id || !negotiationID || !messageID || !text) return null;

  return {
    operationId: `thumbtack-${record.id}`,
    negotiationID,
    messageID,
    customerName: String(data.customer?.displayName || '').trim(),
    text,
  };
}

/** Removes internal handoff content before any customer-facing message can be sent. */
export function splitThumbtackAgentReply(reply) {
  const text = String(reply || '');
  const blocks = [...text.matchAll(READY_BLOCK)];
  if (blocks.length > 1) return { visibleReply: '', estimateReady: null, malformed: true };
  if (blocks.length === 0) return { visibleReply: text.trim(), estimateReady: null, malformed: false };

  let estimateReady = null;
  try {
    const candidate = JSON.parse(blocks[0][1]);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) estimateReady = candidate;
  } catch {
    return { visibleReply: '', estimateReady: null, malformed: true };
  }
  return {
    visibleReply: text.replace(READY_BLOCK, '').trim(),
    estimateReady,
    malformed: false,
  };
}
