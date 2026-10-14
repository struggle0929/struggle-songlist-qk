import { redirect, type Handle } from '@sveltejs/kit';

import { localDemo } from '$lib/server/demo';
import { verifyAdminSession } from '$lib/server/auth';
import { consumePublicRead, securityHeaders } from '$lib/server/security';

export const handle: Handle = async ({ event, resolve }) => {
  if (localDemo && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    return new Response('本地演示模式不支持提交或修改数据，请使用 npm run dev:local 进行隔离测试。', { status: 503 });
  }
  event.locals.userId = localDemo ? null : await verifyAdminSession(event.cookies);
  event.locals.isAdmin = !!event.locals.userId;

  const pathname = event.url.pathname;
  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const isLoginPage = pathname === '/admin/login';
  if (
    !isAdminArea &&
    ['GET', 'HEAD'].includes(event.request.method) &&
    (pathname === '/' || pathname === '/__data.json') &&
    !consumePublicRead(event.getClientAddress())
  ) {
    const response = new Response('访问过于频繁，请稍后重试。', {
      status: 429,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' }
    });
    securityHeaders(response.headers);
    return response;
  }

  if (isAdminArea && !isLoginPage && !event.locals.isAdmin) {
    redirect(303, '/admin/login');
  }

  if (isLoginPage && event.locals.isAdmin) {
    redirect(303, '/admin');
  }

  const response = await resolve(event);
  response.headers.set('Cache-Control', 'private, no-store');
  securityHeaders(response.headers);
  return response;
};
