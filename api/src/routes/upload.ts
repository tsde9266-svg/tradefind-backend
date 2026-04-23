import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createPresignedUploadUrl } from '../lib/r2.js';

const presignSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().regex(/^image\//),
  folder: z.enum(['avatars', 'portfolios', 'reviews']).default('portfolios'),
});

export default async function uploadRoutes(app: FastifyInstance) {
  // POST /api/upload/presign
  app.post('/presign', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = presignSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' });
    }

    const { filename, contentType, folder } = body.data;
    const result = await createPresignedUploadUrl(filename, contentType, folder);

    return { success: true, data: result };
  });
}
