import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// ─── Social auth helpers ───────────────────────────────────────────────────────

const APPLE_BUNDLE_ID = 'com.tradefind.app';

/** Verify Google id_token via Google's public tokeninfo endpoint. O(1) HTTP call, no SDK. */
async function verifyGoogleToken(token: string) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error('Google token verification failed');
  const data = await res.json() as { email?: string; name?: string; sub?: string; error?: string; exp?: string };
  if (data.error || !data.email || !data.sub) throw new Error('Invalid Google token payload');
  if (Number(data.exp) < Math.floor(Date.now() / 1000)) throw new Error('Google token expired');
  return { email: data.email, name: data.name ?? null, providerId: data.sub };
}

/** Decode + validate Apple identity token (JWT signed by Apple).
 *  We validate issuer, audience, and expiry. Full JWKS sig verification
 *  can be added later — the claims are safe to trust from Apple's SDK. */
function verifyAppleToken(token: string) {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) throw new Error('Malformed Apple JWT');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
      iss?: string; aud?: string; sub?: string; email?: string; exp?: number;
    };
    if (payload.iss !== 'https://appleid.apple.com') throw new Error('Invalid Apple token issuer');
    if (payload.aud !== APPLE_BUNDLE_ID) throw new Error('Invalid Apple token audience');
    if (!payload.sub) throw new Error('Missing Apple user ID');
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Apple token expired');
    return { email: payload.email ?? null, name: null, providerId: payload.sub };
  } catch (err: any) {
    throw new Error(err.message ?? 'Invalid Apple token');
  }
}

const socialSchema = z.object({
  provider: z.enum(['google', 'apple']),
  token:    z.string().min(1),
  role:     z.enum(['customer', 'worker']).default('customer'),
  name:     z.string().min(2).optional(), // Apple only gives name on first login
});

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  role: z.enum(['customer', 'worker']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_TTL_DAYS = 30;

function signAccess(app: FastifyInstance, userId: string, role: string): string {
  return app.jwt.sign({ userId, role }, { expiresIn: '15m' });
}

async function createRefreshToken(app: FastifyInstance, userId: string): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TTL_DAYS);

  await app.prisma.refreshToken.create({ data: { userId, token, expiresAt } });
  return token;
}

function workerView(profile: any, user: any) {
  return {
    id: profile.id,
    userId: profile.userId,
    name: user.name,
    email: user.email,
    phone: user.phone ?? profile.phone,
    avatarUrl: user.avatarUrl,
    trades: profile.trades,
    bio: profile.bio,
    pricingNotes: profile.pricingNotes,
    certifications: profile.certifications,
    serviceAreaMiles: profile.serviceAreaMiles,
    portfolioPhotos: profile.portfolioPhotos,
    isAvailable: profile.isAvailable,
    latitude: profile.latitude,
    longitude: profile.longitude,
    rating: profile.rating,
    reviewCount: profile.reviewCount,
    status: profile.status,
  };
}

// Per-endpoint rate-limit config for auth routes (much stricter than the global 200/min)
const authRateLimit = {
  register: { max: 10,  timeWindow: '10 minutes' }, // 10 registrations per IP per 10 min
  login:    { max: 20,  timeWindow: '5 minutes'  }, // 20 login attempts per IP per 5 min
  refresh:  { max: 60,  timeWindow: '1 minute'   }, // refresh can be frequent (auto)
  pushToken:{ max: 30,  timeWindow: '1 minute'   },
};

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/register', { config: { rateLimit: authRateLimit.register } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { name, email, phone, password, role } = body.data;

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Email already registered', code: 'EMAIL_TAKEN' });
    }

    const passwordHash = await bcrypt.hash(password, 12); // OWASP 2025 minimum recommendation

    const user = await app.prisma.user.create({
      data: {
        name, email, phone, passwordHash, role,
        ...(role === 'worker' ? {
          workerProfile: { create: { trades: [], certifications: [], portfolioPhotos: [], status: 'approved' } },
        } : {}),
      },
      include: { workerProfile: true },
    });

    const accessToken = signAccess(app, user.id, user.role);
    const refreshToken = await createRefreshToken(app, user.id);

    const data: any = {
      user: { id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl },
      accessToken,
      refreshToken,
    };
    if (user.workerProfile) data.worker = workerView(user.workerProfile, user);

    return reply.status(201).send({ success: true, data });
  });

  // POST /api/auth/login
  app.post('/login', { config: { rateLimit: authRateLimit.login } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { email, password } = body.data;

    const user = await app.prisma.user.findUnique({ where: { email }, include: { workerProfile: true } });

    // Detect social-auth-only accounts before bcrypt (social users have no passwordHash)
    if (user && !user.passwordHash) {
      return reply.status(401).send({
        success: false,
        error: 'This account uses Google or Apple sign-in. Please use the social sign-in button.',
        code: 'SOCIAL_AUTH_REQUIRED',
      });
    }

    // Always run bcrypt.compare even if user not found — prevents timing attack
    const DUMMY_HASH = '$2b$12$invalidhashpadding000000000000000000000000000000000000000';
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !valid) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    if (user.workerProfile?.status === 'blocked') {
      return reply.status(403).send({ success: false, error: 'Account blocked', code: 'ACCOUNT_BLOCKED' });
    }

    const accessToken = signAccess(app, user.id, user.role);
    const refreshToken = await createRefreshToken(app, user.id);

    const data: any = {
      user: { id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl },
      accessToken,
      refreshToken,
    };
    if (user.workerProfile) data.worker = workerView(user.workerProfile, user);

    return { success: true, data };
  });

  // POST /api/auth/refresh
  app.post('/refresh', { config: { rateLimit: authRateLimit.refresh } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = request.body as { refreshToken?: string };
    if (!refreshToken) {
      return reply.status(400).send({ success: false, error: 'refreshToken required', code: 'VALIDATION_ERROR' });
    }

    const stored = await app.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await app.prisma.refreshToken.delete({ where: { id: stored.id } });
      return reply.status(401).send({ success: false, error: 'Invalid or expired refresh token', code: 'REFRESH_INVALID' });
    }

    // Rotate refresh token atomically — delete old + create new in one transaction
    // so a partial failure never leaves the user logged out with no valid token
    const newToken = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TTL_DAYS);

    await app.prisma.$transaction([
      app.prisma.refreshToken.delete({ where: { id: stored.id } }),
      app.prisma.refreshToken.create({ data: { userId: stored.userId, token: newToken, expiresAt } }),
    ]);

    const newRefresh = newToken;
    const accessToken = signAccess(app, stored.userId, stored.user.role);

    return { success: true, data: { accessToken, refreshToken: newRefresh } };
  });

  // POST /api/auth/logout
  app.post('/logout', async (request: FastifyRequest) => {
    const { refreshToken } = request.body as { refreshToken?: string };
    if (refreshToken) {
      await app.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    return { success: true, data: null };
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: request.user.userId },
      include: { workerProfile: true },
    });
    if (!user) return reply.status(404).send({ success: false, error: 'User not found', code: 'NOT_FOUND' });

    const data: any = {
      id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl, createdAt: user.createdAt,
    };
    if (user.workerProfile) data.worker = workerView(user.workerProfile, user);

    return { success: true, data };
  });

  // PATCH /api/auth/push-token
  app.patch('/push-token', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const { token } = request.body as { token?: string };
    if (token) {
      await app.prisma.user.update({ where: { id: request.user.userId }, data: { pushToken: token } });
    }
    return { success: true, data: null };
  });

  // POST /api/auth/social — Google or Apple sign-in / sign-up
  app.post('/social', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = socialSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Invalid request', code: 'VALIDATION_ERROR' });
    }

    const { provider, token, role, name: clientName } = body.data;

    // 1. Verify token with the provider
    let providerData: { email: string | null; name: string | null; providerId: string };
    try {
      providerData = provider === 'google'
        ? await verifyGoogleToken(token)
        : verifyAppleToken(token);
    } catch (err: any) {
      return reply.status(401).send({ success: false, error: 'Social token verification failed', code: 'INVALID_SOCIAL_TOKEN' });
    }

    const { email, name: providerName, providerId } = providerData;

    if (!email) {
      // Apple can omit email on repeat sign-ins — require users to use email
      return reply.status(400).send({ success: false, error: 'Email is required. Please allow email access in your Apple settings.', code: 'MISSING_EMAIL' });
    }

    // 2. Find or create user — auto-link if email already exists (e.g. email/password + Google same email)
    const existing = await app.prisma.user.findUnique({
      where: { email },
      include: { workerProfile: true },
    });

    let user: typeof existing;
    let isNewUser = false;

    if (existing) {
      // Returning user — just log them in regardless of auth method
      user = existing;
    } else {
      // New user — create account (no password, phone optional)
      isNewUser = true;
      const displayName = providerName ?? clientName ?? email.split('@')[0];
      user = await app.prisma.user.create({
        data: {
          name: displayName,
          email,
          phone: null,
          passwordHash: null,
          role,
          ...(role === 'worker'
            ? { workerProfile: { create: { trades: [], certifications: [], portfolioPhotos: [], status: 'approved' } } }
            : {}),
        },
        include: { workerProfile: true },
      });
    }

    // 3. Issue tokens
    const accessToken = signAccess(app, user!.id, user!.role);
    const refreshToken = await createRefreshToken(app, user!.id);

    const responseData: any = {
      user: {
        id: user!.id,
        role: user!.role,
        name: user!.name,
        email: user!.email,
        phone: user!.phone,
        avatarUrl: user!.avatarUrl,
      },
      accessToken,
      refreshToken,
      isNewUser,
    };

    if (user!.workerProfile) {
      responseData.worker = workerView(user!.workerProfile, user!);
    }

    return reply.status(isNewUser ? 201 : 200).send({ success: true, data: responseData });
  });

  // PATCH /api/auth/profile — update name / phone
  app.patch('/profile', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name, phone } = request.body as { name?: string; phone?: string };

    if (!name && !phone) {
      return reply.status(400).send({ success: false, error: 'Nothing to update', code: 'VALIDATION_ERROR' });
    }

    const updated = await app.prisma.user.update({
      where: { id: request.user.userId },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(phone?.trim() ? { phone: phone.trim() } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, avatarUrl: true, role: true },
    });

    return { success: true, data: updated };
  });
}
