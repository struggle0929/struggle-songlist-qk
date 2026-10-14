import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, type Session } from '@supabase/supabase-js';
import { dev } from '$app/environment';
import { authSecret, supabaseConfig } from '$lib/server/env';
import type { Cookies } from '@sveltejs/kit';

const cookieName = 'songlist_admin_session_v2';
const maxAge = 60 * 60 * 24 * 7;
const authClient = () =>
  createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
const sign = (value: string) => createHmac('sha256', authSecret).update(value).digest('base64url');
export function setAdminSession(cookies: Cookies, session: Session) {
  const payload = Buffer.from(
    JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      issuedAt: Date.now()
    })
  ).toString('base64url');
  cookies.set(cookieName, `${payload}.${sign(payload)}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev,
    maxAge
  });
}
export function clearAdminSession(cookies: Cookies) {
  cookies.delete(cookieName, { path: '/' });
  cookies.delete('songlist_admin_session', { path: '/' });
}
export async function verifyAdminSession(cookies: Cookies): Promise<string | null> {
  const raw = cookies.get(cookieName);
  if (!raw) return null;
  try {
    const [payload, signature, extra] = raw.split('.');
    if (!payload || !signature || extra) return null;
    const expected = Buffer.from(sign(payload));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!Number.isFinite(value.issuedAt) || value.issuedAt > Date.now() || Date.now() - value.issuedAt > maxAge * 1000)
      return null;
    const client = authClient();
    let token = value.accessToken;
    if (typeof token !== 'string' || typeof value.refreshToken !== 'string') return null;
    if (!Number.isFinite(value.expiresAt)) return null;
    if (value.expiresAt * 1000 <= Date.now() + 30_000) {
      const { data, error } = await client.auth.refreshSession({ refresh_token: value.refreshToken });
      if (error || !data.session) {
        clearAdminSession(cookies);
        return null;
      }
      setAdminSession(cookies, data.session);
      token = data.session.access_token;
    }
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      clearAdminSession(cookies);
      return null;
    }
    return data.user.id;
  } catch {
    return null;
  }
}
export const loginAdmin = async ({ email, password }: { email: string; password: string }) => {
  const { data, error } = await authClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.session || !data.user) return { ok: false as const, message: '邮箱或密码错误。' };
  return { ok: true as const, session: data.session, userId: data.user.id };
};
