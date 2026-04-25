import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function adminRoutes(app: FastifyInstance) {
  // GET /api/admin/stats
  app.get('/stats', { preHandler: [app.adminOnly] }, async () => {
    const [totalUsers, totalWorkers, pendingWorkers, totalReviews, flaggedReviews] = await Promise.all([
      app.prisma.user.count(),
      app.prisma.workerProfile.count(),
      app.prisma.workerProfile.count({ where: { status: 'pending' } }),
      app.prisma.review.count({ where: { removed: false } }),
      app.prisma.review.count({ where: { reported: true, removed: false } }),
    ]);

    const activeWorkers = await app.redis.zcard('workers_available');

    return {
      success: true,
      data: { totalUsers, totalWorkers, pendingWorkers, totalReviews, flaggedReviews, activeWorkers },
    };
  });

  // GET /api/admin/workers
  app.get('/workers', { preHandler: [app.adminOnly] }, async (request: FastifyRequest) => {
    const { status, search, page = '1', limit = '20' } = request.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.user = { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] };
    }

    const [workers, total] = await Promise.all([
      app.prisma.workerProfile.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, email: true, phone: true } } },
      }),
      app.prisma.workerProfile.count({ where }),
    ]);

    return { success: true, data: workers, meta: { total, page: parseInt(page), limit: parseInt(limit) } };
  });

  // PATCH /api/admin/workers/:id
  app.patch('/workers/:id', { preHandler: [app.adminOnly] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: 'approved' | 'blocked' };

    if (!['approved', 'blocked'].includes(status)) {
      return reply.status(400).send({ success: false, error: 'Invalid status', code: 'VALIDATION_ERROR' });
    }

    const profile = await app.prisma.workerProfile.update({
      where: { id },
      data: { status },
      include: { user: true },
    });

    // Notify worker on approval
    if (status === 'approved') {
      await app.prisma.notification.create({
        data: {
          userId: profile.userId,
          type: 'account_approved',
          title: 'Account approved!',
          body: 'Your TradeFind account has been approved. You can now go live.',
        },
      });
    }

    return { success: true, data: profile };
  });

  // GET /api/admin/reviews/flagged
  app.get('/reviews/flagged', { preHandler: [app.adminOnly] }, async (request: FastifyRequest) => {
    const { page = '1', limit = '20' } = request.query as Record<string, string>;
    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    const [reviews, total] = await Promise.all([
      app.prisma.review.findMany({
        where: { reported: true, removed: false },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { fromUser: { select: { name: true } }, toWorker: { include: { user: { select: { name: true } } } } },
      }),
      app.prisma.review.count({ where: { reported: true, removed: false } }),
    ]);

    return { success: true, data: reviews, meta: { total, page: parseInt(page), limit: take } };
  });

  // PATCH /api/admin/reviews/:id
  app.patch('/reviews/:id', { preHandler: [app.adminOnly] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'approve' | 'remove' };

    if (!['approve', 'remove'].includes(action)) {
      return reply.status(400).send({ success: false, error: 'Invalid action', code: 'VALIDATION_ERROR' });
    }

    const review = await app.prisma.review.update({
      where: { id },
      data: action === 'remove' ? { removed: true, reported: false } : { reported: false },
    });

    if (action === 'remove') {
      // Recalculate worker rating
      const stats = await app.prisma.review.aggregate({
        where: { toWorkerId: review.toWorkerId, removed: false },
        _avg: { rating: true },
        _count: { id: true },
      });
      await app.prisma.workerProfile.update({
        where: { id: review.toWorkerId },
        data: { rating: stats._avg.rating ?? 0, reviewCount: stats._count.id },
      });
    }

    return { success: true, data: null };
  });

  // GET /api/admin/customers
  app.get('/customers', { preHandler: [app.adminOnly] }, async (request: FastifyRequest) => {
    const { search, page = '1' } = request.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * 20;

    const where: any = { role: 'customer' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      app.prisma.user.findMany({
        where,
        skip,
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, phone: true, avatarUrl: true, createdAt: true },
      }),
      app.prisma.user.count({ where }),
    ]);

    return { success: true, data: customers, meta: { total, page: parseInt(page), limit: 20 } };
  });
}
