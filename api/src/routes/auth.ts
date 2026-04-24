import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { z } from 'zod';

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

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { name, email, phone, password, role } = body.data;

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Email already registered', code: 'EMAIL_TAKEN' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await app.prisma.user.create({
      data: {
        name, email, phone, passwordHash, role,
        ...(role === 'worker' ? {
          workerProfile: { create: { trades: [], certifications: [], portfolioPhotos: [] } },
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
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { email, password } = body.data;

    const user = await app.prisma.user.findUnique({ where: { email }, include: { workerProfile: true } });
    if (!user) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
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
  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Rotate refresh token
    await app.prisma.refreshToken.delete({ where: { id: stored.id } });
    const newRefresh = await createRefreshToken(app, stored.userId);
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
