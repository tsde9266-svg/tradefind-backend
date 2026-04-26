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
  // Limit job creation — prevents spamming workers with requests
  app.post('/', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
    if (!workerProfile) {
      return reply.status(404).send({ success: false, error: 'Worker not found', code: 'NOT_FOUND' });
    }
    if (workerProfile.status !== 'approved') {
      return reply.status(403).send({ success: false, error: 'This worker\'s account is not yet active', code: 'NOT_APPROVED' });
    }
    // Prevent self-booking (user with dual customer+worker profiles)
    if (request.user.userId === workerProfile.userId) {
      return reply.status(403).send({ success: false, error: 'You cannot book yourself', code: 'FORBIDDEN' });
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

    // confirm_call → started directly (customer already confirmed verbally, skip 'accepted' step)
    // accept → accepted (worker confirmed in-app, customer still waiting for worker to start)
    // decline → declined
    const newStatus = action === 'decline' ? 'declined' : action === 'confirm_call' ? 'started' : 'accepted';

    // Atomic conditional update — prevents two workers from transitioning the same job simultaneously.
    // updateMany returns count=0 if the WHERE condition (status check) doesn't match,
    // meaning another request already changed the status.
    const result = await app.prisma.jobRequest.updateMany({
      where: { id, status: { in: validTransitions[action] as any } },
      data: { status: newStatus },
    });

    if (result.count === 0) {
      return reply.status(409).send({ success: false, error: 'Job status changed by another request', code: 'CONFLICT' });
    }

    const updated = await app.prisma.jobRequest.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        worker:   { include: { user: { select: { name: true, avatarUrl: true, phone: true } } } },
      },
    });

    const workerName = (profile as any).user?.name ?? 'Your worker';

    type NotifEntry = [string, string, 'job_accepted' | 'job_declined' | 'job_started', Record<string, string>];
    const [notifTitle, notifBody, notifType, pushData]: NotifEntry =
      newStatus === 'accepted'
        ? [`${workerName} accepted!`, "He'll start his journey shortly.", 'job_accepted', { jobId: id, screen: 'job_status' }]
        : newStatus === 'started'
          // confirm_call → started: customer needs to know worker is en route NOW
          ? [`${workerName} is on his way!`, 'Your call agreement is confirmed. Track his live location.', 'job_started', { jobId: id, screen: 'tracking', workerId: profile.id }]
          : [`${workerName} declined`, 'Try requesting another tradesperson.', 'job_declined', { jobId: id, screen: 'job_status' }];

    await app.prisma.notification.create({
      data: { userId: job.customerId, type: notifType, title: notifTitle, body: notifBody },
    });
    sendPushNotification(job.customer.pushToken, notifTitle, notifBody, pushData);

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

    const startResult = await app.prisma.jobRequest.updateMany({
      where: { id, workerId: profile.id, status: 'accepted' },
      data: { status: 'started' },
    });
    if (startResult.count === 0) {
      return reply.status(409).send({ success: false, error: 'Job already started or changed', code: 'CONFLICT' });
    }
    const updated = await app.prisma.jobRequest.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        worker:   { include: { user: { select: { name: true, avatarUrl: true, phone: true } } } },
      },
    });

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

    const completeResult = await app.prisma.jobRequest.updateMany({
      where: { id, workerId: profile.id, status: 'started' },
      data: { status: 'completed' },
    });
    if (completeResult.count === 0) {
      return reply.status(409).send({ success: false, error: 'Job already completed or changed', code: 'CONFLICT' });
    }
    const updated = await app.prisma.jobRequest.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, avatarUrl: true, phone: true } },
        worker:   { include: { user: { select: { name: true, avatarUrl: true, phone: true } } } },
      },
    });

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
        // Allow cancel of started jobs too — workers/customers can abort if needed
        status: { in: ['pending', 'call_pending', 'accepted', 'started'] },
      },
      include: {
        customer: { select: { pushToken: true } },
        // Use include only — 'select' overrides ALL fields including userId.
        // WorkerProfile.userId is always available when using include.
        worker: {
          include: { user: { select: { pushToken: true, name: true } } },
        },
      },
    });
    if (!job) return reply.status(404).send({ success: false, error: 'Job not found or cannot be cancelled', code: 'NOT_FOUND' });

    await app.prisma.jobRequest.update({ where: { id }, data: { status: 'cancelled' } });

    const workerUserId = (job.worker as any)?.userId as string | undefined;
    const workerPushToken = (job.worker as any)?.user?.pushToken as string | undefined;
    const workerName     = (job.worker as any)?.user?.name as string | undefined;

    if (role === 'customer') {
      const wasActive = ['accepted', 'started'].includes(job.status);
      const msg = wasActive
        ? 'The customer cancelled after you accepted. Sorry for the inconvenience.'
        : 'The customer cancelled their request.';
      if (workerUserId) {
        await app.prisma.notification.create({
          data: { userId: workerUserId, type: 'job_declined', title: 'Job cancelled', body: msg },
        }).catch(() => {});
      }
      sendPushNotification(workerPushToken, 'Job cancelled', msg);
    } else {
      const msg = `${workerName ?? 'The worker'} cancelled the job.`;
      await app.prisma.notification.create({
        data: { userId: job.customerId, type: 'job_declined', title: 'Job cancelled', body: msg },
      }).catch(() => {});
      sendPushNotification(job.customer.pushToken, 'Job cancelled', msg);
    }

    return { success: true, data: null };
  });
}
