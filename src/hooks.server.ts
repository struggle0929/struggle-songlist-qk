import { redirect, type Handle } from '@sveltejs/kit';

import { verifyAdminSession } from '$lib/server/auth';
import { localDemo } from '$lib/server/demo';

export const handle: Handle = async ({ event, resolve }) => {
  if (localDemo && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    return new Response('本地演示模式不支持提交或修改数据，请配置独立数据库后测试。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
  event.locals.isAdmin = verifyAdminSession(event.cookies);

  const pathname = event.url.pathname;
  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const isLoginPage = pathname === '/admin/login';

  if (isAdminArea && !isLoginPage && !event.locals.isAdmin) {
    redirect(303, '/admin/login');
  }

  if (isLoginPage && event.locals.isAdmin) {
    redirect(303, '/admin');
  }

  return resolve(event);
};
