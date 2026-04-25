import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function notificationRoutes(app: FastifyInstance) {
  // GET /api/notifications — supports cursor-based pagination for large notification lists
  app.get('/', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const { cursor, limit = '50' } = request.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(limit) || 50, 1), 100);

    const notifications = await app.prisma.notification.findMany({
      where: {
        userId: request.user.userId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const nextCursor = notifications.length === take
      ? notifications[notifications.length - 1]?.createdAt?.toISOString()
      : null;

    return { success: true, data: notifications, meta: { nextCursor } };
  });

  // PATCH /api/notifications/read-all
  app.patch('/read-all', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    await app.prisma.notification.updateMany({
      where: { userId: request.user.userId, read: false },
      data: { read: true },
    });
    return { success: true, data: null };
  });

  // PATCH /api/notifications/:id/read
  app.patch('/:id/read', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const n = await app.prisma.notification.findFirst({
      where: { id, userId: request.user.userId },
    });
    if (!n) return reply.status(404).send({ success: false, error: 'Not found', code: 'NOT_FOUND' });

    await app.prisma.notification.update({ where: { id }, data: { read: true } });
    return { success: true, data: null };
  });
}
