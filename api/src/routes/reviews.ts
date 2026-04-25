import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendPushNotification } from '../lib/push.js';

const createReviewSchema = z.object({
  toId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(10).max(500),
  photos: z.array(z.string()).max(5).default([]),
});

const replySchema = z.object({
  reply: z.string().min(1).max(500),
});

export default async function reviewRoutes(app: FastifyInstance) {
  // GET /api/reviews/worker/:id
  app.get('/worker/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const { page = '1', limit = '20' } = request.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const skip = Math.max((parseInt(page) || 1) - 1, 0) * take;

    const reviews = await app.prisma.review.findMany({
      where: { toWorkerId: id, removed: false },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        fromUser: { select: { name: true, avatarUrl: true } },
      },
    });

    const total = await app.prisma.review.count({ where: { toWorkerId: id, removed: false } });

    const data = reviews.map((r) => ({
      id: r.id,
      fromUserId: r.fromUserId,
      fromUserName: r.fromUser.name,
      fromUserAvatar: r.fromUser.avatarUrl,
      toWorkerId: r.toWorkerId,
      rating: r.rating,
      text: r.text,
      photos: r.photos,
      reply: r.reply,
      createdAt: r.createdAt,
    }));

    return { success: true, data, meta: { total, page: parseInt(page) || 1, limit: take } };
  });

  // GET /api/reviews/customer/:id — only the customer themselves can view their own reviews
  app.get('/customer/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    if (request.user.userId !== id && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    }

    const { page = '1', limit = '20' } = request.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const skip = Math.max((parseInt(page) || 1) - 1, 0) * take;

    const [reviews, total] = await Promise.all([
      app.prisma.review.findMany({
        where: { fromUserId: id, removed: false },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { fromUser: { select: { name: true, avatarUrl: true } } },
      }),
      app.prisma.review.count({ where: { fromUserId: id, removed: false } }),
    ]);

    return { success: true, data: reviews, meta: { total, page: parseInt(page) || 1, limit: take } };
  });

  // POST /api/reviews
  app.post('/', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createReviewSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { toId, rating, text, photos } = body.data;

    const workerProfile = await app.prisma.workerProfile.findUnique({
      where: { id: toId },
      include: { user: true },
    });
    if (!workerProfile) {
      return reply.status(404).send({ success: false, error: 'Worker not found', code: 'NOT_FOUND' });
    }

    // One review per customer per worker
    const existing = await app.prisma.review.findFirst({
      where: { fromUserId: request.user.userId, toWorkerId: toId },
    });
    if (existing) {
      return reply.status(409).send({ success: false, error: 'You have already reviewed this worker', code: 'DUPLICATE_REVIEW' });
    }

    const fromUser = await app.prisma.user.findUnique({ where: { id: request.user.userId } });

    const [review] = await app.prisma.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: { fromUserId: request.user.userId, toWorkerId: toId, rating, text, photos },
      });

      // Incremental rating update — O(1) instead of O(n) aggregate scan.
      // Formula: new_avg = (old_avg * old_count + new_rating) / (old_count + 1)
      const current = await tx.workerProfile.findUnique({
        where: { id: toId },
        select: { rating: true, reviewCount: true },
      });
      const oldCount = current?.reviewCount ?? 0;
      const oldAvg   = current?.rating ?? 0;
      const newCount = oldCount + 1;
      const newAvg   = parseFloat(((oldAvg * oldCount + rating) / newCount).toFixed(2));

      await tx.workerProfile.update({
        where: { id: toId },
        data: { rating: newAvg, reviewCount: newCount },
      });

      // Create notification
      await tx.notification.create({
        data: {
          userId: workerProfile.userId,
          type: 'new_review',
          title: 'New review received',
          body: `${fromUser?.name ?? 'Someone'} gave you ${rating} star${rating === 1 ? '' : 's'}`,
        },
      });

      return [r];
    });

    sendPushNotification(
      workerProfile.user.pushToken,
      'New review',
      `${fromUser?.name ?? 'Someone'} gave you ${rating} star${rating === 1 ? '' : 's'}`,
    );

    return reply.status(201).send({ success: true, data: review });
  });

  // POST /api/reviews/:id/reply
  app.post('/:id/reply', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }

    const body = replySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'reply required', code: 'VALIDATION_ERROR' });
    }

    const { id } = request.params as { id: string };
    const profile = await app.prisma.workerProfile.findUnique({ where: { userId: request.user.userId } });
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

    const review = await app.prisma.review.findFirst({ where: { id, toWorkerId: profile.id } });
    if (!review) return reply.status(404).send({ success: false, error: 'Review not found', code: 'NOT_FOUND' });
    if (review.reply) return reply.status(409).send({ success: false, error: 'Already replied', code: 'ALREADY_REPLIED' });

    const updated = await app.prisma.review.update({ where: { id }, data: { reply: body.data.reply } });

    return { success: true, data: updated };
  });

  // POST /api/reviews/:id/report
  app.post('/:id/report', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as { reason?: string };

    const review = await app.prisma.review.findUnique({ where: { id } });
    if (!review) return reply.status(404).send({ success: false, error: 'Review not found', code: 'NOT_FOUND' });

    await app.prisma.review.update({ where: { id }, data: { reported: true, reportReason: reason } });

    return { success: true, data: null };
  });
}
