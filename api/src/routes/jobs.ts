import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { sendPushNotification } from '../lib/push.js';

const createJobSchema = z.object({
  workerId: z.string().uuid(),
  type: z.enum(['in_app', 'call']),
  description: z.string().min(10).max(500).optional(),
}).refine(
  (d) => d.type !== 'in_app' || (d.description && d.description.length >= 10),
  { message: 'Description required for in-app requests', path: ['description'] },
);

const respondSchema = z.object({
  action: z.enum(['accept', 'decline', 'confirm_call']),
});

function jobView(job: any) {
  return {
    id: job.id,
    customerId: job.customerId,
    workerId: job.workerId,
    type: job.type,
    description: job.description,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    worker: job.worker
      ? {
          id: job.worker.id,
          name: job.worker.user?.name,
          avatarUrl: job.worker.user?.avatarUrl,
          phone: job.worker.user?.phone,
          trades: job.worker.trades,
          rating: job.worker.rating,
        }
      : undefined,
    customer: job.customer
      ? {
          id: job.customer.id,
          name: job.customer.name,
          avatarUrl: job.customer.avatarUrl,
          phone: job.customer.phone,
        }
      : undefined,
  };
}

export default async function jobRoutes(app: FastifyInstance) {

  // POST /api/jobs — customer creates a job request
  app.post('/', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'customer') {
      return reply.status(403).send({ success: false, error: 'Customers only', code: 'FORBIDDEN' });
    }

    const body = createJobSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: body.error.errors[0]?.message ?? 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { workerId, type, description } = body.data;

    const workerProfile = await app.prisma.workerProfile.findUnique({
      where: { id: workerId },
      include: { user: { select: { name: true, pushToken: true } } },
    });
    if (!workerProfile || workerProfile.status !== 'approved') {
      return reply.status(404).send({ success: false, error: 'Worker not found', code: 'NOT_FOUND' });
    }

    const customer = await app.prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { name: true },
    });

    const initialStatus = type === 'call' ? 'call_pending' : 'pending';

    // Wrap check + create in transaction to prevent race-condition duplicate jobs
    let job;
    try {
      job = await app.prisma.$transaction(async (tx) => {
        const duplicate = await tx.jobRequest.findFirst({
          where: {
            customerId: request.user.userId,
            workerId,
            status: { in: ['pending', 'call_pending', 'accepted', 'started'] },
          },
        });
        if (duplicate) {
          const err: any = new Error('DUPLICATE_JOB');
          err.code = 'DUPLICATE_JOB';
          throw err;
        }
        return tx.jobRequest.create({
          data: { customerId: request.user.userId, workerId, type, description, status: initialStatus },
        });
      });
    } catch (err: any) {
      if (err.code === 'DUPLICATE_JOB') {
        return reply.status(409).send({ success: false, error: 'You already have an active request with this worker', code: 'DUPLICATE_JOB' });
      }
      throw err;
    }

    // Notify worker
    const workerName = workerProfile.user.name;
    const customerName = customer?.name ?? 'A customer';

    const [notifTitle, notifBody] =
      type === 'in_app'
        ? [
            `New job request from ${customerName}`,
            description ? `"${description.slice(0, 80)}"` : 'Tap to view and respond.',
          ]
        : [
            `${customerName} wants to track your journey`,
            'They say you agreed on a call. Confirm you\'re on your way.',
          ];

    await app.prisma.notification.create({
      data: { userId: workerProfile.userId, type: 'job_request', title: notifTitle, body: notifBody },
    });
    sendPushNotification(workerProfile.user.pushToken, notifTitle, notifBody, { jobId: job.id, screen: 'job_request' });

    return reply.status(201).send({ success: true, data: jobView({ ...job, worker: { ...workerProfile, user: { name: workerName } }, customer: { id: request.user.userId, name: customerName } }) });
  });

  // GET /api/jobs/active — role-aware: customer gets their active jobs, worker gets incoming + active
  app.get('/active', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, role } = request.user;

    if (role === 'customer') {
      const jobs = await app.prisma.jobRequest.findMany({
        where: {
          customerId: userId,
          status: { in: ['pending', 'call_pending', 'accepted', 'started'] },
        },
        include: {
          worker: { include: { user: { select: { name: true, avatarUrl: true, phone: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return { success: true, data: jobs.map(jobView) };
    }

    if (role === 'worker') {
      const profile = await app.prisma.workerProfile.findUnique({ where: { userId } });
      if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

      const jobs = await app.prisma.jobRequest.findMany({
        where: {
          workerId: profile.id,
          status: { in: ['pending', 'call_pending', 'accepted', 'started'] },
        },
        include: {
          customer: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return { success: true, data: jobs.map(jobView) };
    }

    return { success: true, data: [] };
  });

  // GET /api/jobs/:id — get a specific job (must be a participant)
  app.get('/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = request.user;

    const job = await app.prisma.jobRequest.findUnique({
      where: { id },
      include: {
        worker: { include: { user: { select: { name: true, avatarUrl: true, phone: true } } } },
        customer: { select: { id: true, name: true, avatarUrl: true, phone: true } },
      },
    });

    if (!job) return reply.status(404).send({ success: false, error: 'Job not found', code: 'NOT_FOUND' });

    // Only the customer or the assigned worker can view
    const isCustomer = job.customerId === userId;
    const isWorker = role === 'worker' && (() => false)(); // resolved below
    const workerProfile = role === 'worker'
      ? await app.prisma.workerProfile.findUnique({ where: { userId } })
      : null;
    const isAssignedWorker = workerProfile?.id === job.workerId;

    if (!isCustomer && !isAssignedWorker) {
      return reply.status(403).send({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    }

    return { success: true, data: jobView(job) };
  });

  // PATCH /api/jobs/:id/respond — worker responds: accept | decline | confirm_call
  app.patch('/:id/respond', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }

    const body = respondSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { id } = request.params as { id: string };
    const { action } = body.data;

    const profile = await app.prisma.workerProfile.findUnique({
      where: { userId: request.user.userId },
      include: { user: { select: { name: true } } },
    });
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

    const job = await app.prisma.jobRequest.findFirst({
      where: { id, workerId: profile.id },
      include: { customer: { select: { name: true, pushToken: true } } },
    });
    if (!job) return reply.status(404).send({ success: false, error: 'Job not found', code: 'NOT_FOUND' });

    const validTransitions: Record<string, string[]> = {
      accept: ['pending'],
      decline: ['pending', 'call_pending'],
      confirm_call: ['call_pending'],
    };
    if (!validTransitions[action]?.includes(job.status)) {
      return reply.status(409).send({ success: false, error: `Cannot ${action} a job with status "${job.status}"`, code: 'INVALID_TRANSITION' });
    }

    const newStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'accepted';

    const updated = await app.prisma.jobRequest.update({ where: { id }, data: { status: newStatus } });

    const workerName = (profile as any).user?.name ?? 'Your worker';

    const [notifTitle, notifBody, notifType] =
      newStatus === 'accepted'
        ? [`${workerName} accepted your request!`, 'He\'ll start his journey shortly.', 'job_accepted' as const]
        : [`${workerName} declined your request`, 'Try requesting another tradesperson.', 'job_declined' as const];

    await app.prisma.notification.create({
      data: { userId: job.customerId, type: notifType, title: notifTitle, body: notifBody },
    });
    sendPushNotification(job.customer.pushToken, notifTitle, notifBody, { jobId: id, screen: 'job_status' });

    return { success: true, data: jobView(updated) };
  });

  // PATCH /api/jobs/:id/start — worker starts the journey (en route)
  app.patch('/:id/start', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };

    const profile = await app.prisma.workerProfile.findUnique({
      where: { userId: request.user.userId },
      include: { user: { select: { name: true } } },
    });
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

    const job = await app.prisma.jobRequest.findFirst({
      where: { id, workerId: profile.id, status: 'accepted' },
      include: { customer: { select: { name: true, pushToken: true } } },
    });
    if (!job) return reply.status(404).send({ success: false, error: 'Job not found or not in accepted state', code: 'NOT_FOUND' });

    const updated = await app.prisma.jobRequest.update({ where: { id }, data: { status: 'started' } });

    const workerName = (profile as any).user?.name ?? 'Your worker';

    await app.prisma.notification.create({
      data: { userId: job.customerId, type: 'job_started', title: `${workerName} is on his way!`, body: 'Open the app to track him live.' },
    });
    sendPushNotification(job.customer.pushToken, `${workerName} is on his way!`, 'Tap to track him live.', { jobId: id, screen: 'tracking', workerId: profile.id });

    return { success: true, data: jobView(updated) };
  });

  // PATCH /api/jobs/:id/complete — worker marks job as done
  app.patch('/:id/complete', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'worker') {
      return reply.status(403).send({ success: false, error: 'Workers only', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };

    const profile = await app.prisma.workerProfile.findUnique({
      where: { userId: request.user.userId },
      include: { user: { select: { name: true } } },
    });
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found', code: 'NOT_FOUND' });

    const job = await app.prisma.jobRequest.findFirst({
      where: { id, workerId: profile.id, status: 'started' },
      include: { customer: { select: { name: true, pushToken: true } } },
    });
    if (!job) return reply.status(404).send({ success: false, error: 'Job not found or not in started state', code: 'NOT_FOUND' });

    const updated = await app.prisma.jobRequest.update({ where: { id }, data: { status: 'completed' } });

    const workerName = (profile as any).user?.name ?? 'Your worker';

    await app.prisma.notification.create({
      data: { userId: job.customerId, type: 'job_completed', title: 'Job completed!', body: `${workerName} has finished the job. How did it go?` },
    });
    sendPushNotification(job.customer.pushToken, 'Job completed!', `${workerName} finished. Leave a review?`, { jobId: id, screen: 'review', workerId: profile.id });

    return { success: true, data: jobView(updated) };
  });

  // DELETE /api/jobs/:id — cancel (customer or worker)
  app.delete('/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = request.user;

    const workerProfile = role === 'worker'
      ? await app.prisma.workerProfile.findUnique({ where: { userId } })
      : null;

    const job = await app.prisma.jobRequest.findFirst({
      where: {
        id,
        ...(role === 'customer' ? { customerId: userId } : { workerId: workerProfile?.id }),
        status: { in: ['pending', 'call_pending', 'accepted'] },
      },
      include: {
        customer: { select: { pushToken: true } },
        worker: { include: { user: { select: { pushToken: true, name: true } } } },
      },
    });
    if (!job) return reply.status(404).send({ success: false, error: 'Job not found or cannot be cancelled', code: 'NOT_FOUND' });

    await app.prisma.jobRequest.update({ where: { id }, data: { status: 'cancelled' } });

    // Notify the other party
    if (role === 'customer') {
      sendPushNotification(job.worker.user.pushToken, 'Job request cancelled', 'The customer cancelled their request.');
    } else {
      sendPushNotification(job.customer.pushToken, 'Job cancelled', `${job.worker.user.name} cancelled the job.`);
    }

    return { success: true, data: null };
  });
}
