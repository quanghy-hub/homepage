export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function errorResponse(message, status) {
  return jsonResponse({ ok: false, error: message }, status);
}

export function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function encodeText(value) {
  return new TextEncoder().encode(value);
}

export async function isAuthorized(request, env) {
  const expected = env.SYNC_API_KEY || '';
  const actual = getBearerToken(request);
  if (!expected || !actual) return false;

  const expectedBytes = encodeText(expected);
  const actualBytes = encodeText(actual);
  if (expectedBytes.length !== actualBytes.length) return false;

  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(expectedBytes, actualBytes);
  }

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i += 1) {
    diff |= expectedBytes[i] ^ actualBytes[i];
  }
  return diff === 0;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function getLocalDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(date);
  const value = (name) => parts.find((part) => part.type === name)?.value || '';
  const hour = Number(value('hour')) % 24;

  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    hour
  };
}
