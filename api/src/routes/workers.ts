import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { geoAddWorker, geoRemoveWorker, geoSearchNearby } from '../lib/redis.js';
import { sendPushNotification } from '../lib/push.js';

function workerPublicView(profile: any, user: any, distanceMetres?: number) {
  return {
    id: profile.id,
    userId: profile.userId,
    name: user.name,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
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
    ...(distanceMetres !== undefined ? { distance: distanceMetres } : {}),
  };
}

const profileUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  bio: z.string().max(300).optional(),
  pricingNotes: z.string().max(200).optional(),
  trades: z.array(z.string()).min(1).optional(),
  serviceAreaMiles: z.number().min(1).max(100).optional(),
  certifications: z.array(z.string()).optional(),
  portfolioPhotos: z.array(z.string()).optional(),
});

export default async function workerRoutes(app: FastifyInstance) {
  // GET /api/workers/nearby
  app.get('/nearby', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { lat, lng, radiusKm = '10', trade, availableOnly, sortBy } = request.query as Record<string, string>;

    if (!lat || !lng) {
      return reply.status(400).send({ success: false, error: 'lat and lng required', code: 'VALIDATION_ERROR' });
    }

    const geoWorkers = await geoSearchNearby(
      app.redis,
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radiusKm),
      50,
    );

    if (geoWorkers.length === 0) return { success: true, data: [] };

    const distanceMap = Object.fromEntries(geoWorkers.map((w) => [w.id, w.distanceMetres]));
    const workerIds = geoWorkers.map((w) => w.id);

    const profiles = await app.prisma.workerProfile.findMany({
      where: {
        id: { in: workerIds },
        status: 'approved',
        ...(trade && trade !== 'All' ? { trades: { has: trade } } : {}),
      },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    });

    let result = profiles.map((p) => workerPublicView(p, p.user, distanceMap[p.id]));

    if (sortBy === 'rating') {
      result.sort((a, b) => b.rating - a.rating);
    } else {
      result.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    }

    return { success: true, data: result };
  });

  // GET /api/workers/saved
  app.get('/saved', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const saved = await app.prisma.savedWorker.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: 'desc' },
    });

    const workerIds = saved.map((s) => s.workerId);
    const profiles = await app.prisma.workerProfile.findMany({
      where: { id: { in: workerIds }, status: 'approved' },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    });

    return { success: true, data: profiles.map((p) => workerPublicView(p, p.user)) };
  });

  // GET /api/workers/stats/today
  app.get('/stats/today', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }
    const profile = await app.prisma.workerProfile.findUnique({ where: { userId: request.user.userId } });
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reviews = await app.prisma.review.count({
      where: { toWorkerId: profile.id, createdAt: { gte: today } },
    });

    return { success: true, data: { views: 0, calls: 0, reviews } };
  });

  // GET /api/workers/:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const profile = await app.prisma.workerProfile.findFirst({
      where: { OR: [{ id }, { userId: id }] },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    });

    if (!profile) return reply.status(404).send({ success: false, error: 'Worker not found', code: 'NOT_FOUND' });

    return { success: true, data: workerPublicView(profile, profile.user) };
  });

  // PATCH /api/workers/profile
  app.patch('/profile', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }

    const body = profileUpdateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { name, phone, ...profileFields } = body.data;

    await app.prisma.$transaction(async (tx) => {
      if (name || phone) {
        await tx.user.update({
          where: { id: request.user.userId },
          data: { ...(name ? { name } : {}), ...(phone ? { phone } : {}) },
        });
      }
      if (Object.keys(profileFields).length > 0) {
        await tx.workerProfile.update({
          where: { userId: request.user.userId },
          data: profileFields,
        });
      }
    });

    const profile = await app.prisma.workerProfile.findUnique({
      where: { userId: request.user.userId },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    });

    return { success: true, data: workerPublicView(profile!, profile!.user) };
  });

  // PATCH /api/workers/availability
  app.patch('/availability', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }

    const { available, lat, lng } = request.body as { available: boolean; lat?: number; lng?: number };

    const profile = await app.prisma.workerProfile.findUnique({ where: { userId: request.user.userId } });
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

    if (profile.status !== 'approved') {
      return reply.status(403).send({ success: false, error: 'Account pending approval', code: 'NOT_APPROVED' });
    }

    await app.prisma.workerProfile.update({
      where: { id: profile.id },
      data: {
        isAvailable: available,
        latitude: available ? (lat ?? profile.latitude) : null,
        longitude: available ? (lng ?? profile.longitude) : null,
      },
    });

    if (available && lat !== undefined && lng !== undefined) {
      await geoAddWorker(app.redis, profile.id, request.user.userId, lat, lng);
    } else {
      await geoRemoveWorker(app.redis, profile.id, request.user.userId);
    }

    return { success: true, data: { available } };
  });

  // POST /api/workers/:id/save
  app.post('/:id/save', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const profile = await app.prisma.workerProfile.findUnique({ where: { id } });
    if (!profile) return reply.status(404).send({ success: false, error: 'Worker not found', code: 'NOT_FOUND' });

    await app.prisma.savedWorker.upsert({
      where: { userId_workerId: { userId: request.user.userId, workerId: id } },
      create: { userId: request.user.userId, workerId: id },
      update: {},
    });

    // Notify the worker
    const workerUser = await app.prisma.user.findUnique({ where: { id: profile.userId } });
    await app.prisma.notification.create({
      data: {
        userId: profile.userId,
        type: 'profile_saved',
        title: 'Someone saved your profile',
        body: 'A customer added you to their saved tradespeople.',
      },
    });
    await sendPushNotification(workerUser?.pushToken, 'Profile saved', 'A customer saved your profile.');

    return { success: true, data: null };
  });

  // DELETE /api/workers/:id/save
  app.delete('/:id/save', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    await app.prisma.savedWorker.deleteMany({
      where: { userId: request.user.userId, workerId: id },
    });
    return { success: true, data: null };
  });
}
