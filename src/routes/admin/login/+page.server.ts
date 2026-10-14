import { fail, redirect } from '@sveltejs/kit';

import { loginAdmin, setAdminSession } from '$lib/server/auth';
import { getValidationMessage } from '$lib/server/errors';
import { loginFormSchema } from '$lib/server/form-schemas';
import { consumeLoginRateLimit } from '$lib/server/rate-limit';

import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress, setHeaders }) => {
    const parsed = loginFormSchema.safeParse(await request.formData());

    if (!parsed.success) {
      return fail(400, {
        message: getValidationMessage(parsed.error),
        values: {
          email: ''
        }
      });
    }

    const { email, password } = parsed.data;
    try {
      if (!(await consumeLoginRateLimit(getClientAddress(), email))) {
        setHeaders({ 'Retry-After': '600' });
        return fail(429, { message: '登录尝试过于频繁，请稍后重试。', values: { email } });
      }
    } catch {
      return fail(503, { message: '登录保护暂时不可用，请稍后重试。', values: { email } });
    }

    const result = await loginAdmin({ email, password });

    if (!result.ok) {
      return fail(400, {
        message: result.message,
        values: {
          email
        }
      });
    }

    setAdminSession(cookies, result.session);
    redirect(303, '/admin');
  }
};
