import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function notificationRoutes(app: FastifyInstance) {
  // GET /api/notifications
  app.get('/', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const notifications = await app.prisma.notification.findMany({
      where: { userId: request.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { success: true, data: notifications };
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
