const cookieTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function isSessionToken(value: string): boolean {
  return cookieTokenPattern.test(value);
}

export function readSessionCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => part.slice(cookieName.length + 1));
  if (values.length !== 1) return null;
  return isSessionToken(values[0] ?? "") ? (values[0] ?? null) : null;
}

export function serializeSessionCookie(
  cookieName: string,
  token: string,
  maximumAgeSeconds: number,
): string {
  if (!isSessionToken(token)) throw new Error("Invalid session token");
  const maximumAge = Math.max(1, Math.floor(maximumAgeSeconds));
  return [
    `${cookieName}=${token}`,
    `Max-Age=${maximumAge}`,
    "Path=/v1",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function serializeClearedSessionCookie(cookieName: string): string {
  return [
    `${cookieName}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/v1",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}
