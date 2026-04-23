import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding test accounts…');

  const hash = (pw: string) => bcrypt.hash(pw, 10);

  // ── Admin ────────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@tradefind.com' },
    update: {},
    create: {
      email: 'admin@tradefind.com',
      name: 'Admin User',
      phone: '07700000000',
      passwordHash: await hash('Admin1234'),
      role: 'admin',
    },
  });

  // ── Customer ─────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'customer@tradefind.com' },
    update: {},
    create: {
      email: 'customer@tradefind.com',
      name: 'Jane Customer',
      phone: '07700000001',
      passwordHash: await hash('Test1234'),
      role: 'customer',
    },
  });

  // ── Worker (approved, ready to go live) ──────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'worker@tradefind.com' },
    update: {},
    create: {
      email: 'worker@tradefind.com',
      name: 'Bob Plumber',
      phone: '07700000002',
      passwordHash: await hash('Test1234'),
      role: 'worker',
      workerProfile: {
        create: {
          trades: ['Plumber', 'Gas Engineer'],
          bio: 'Qualified plumber with 10 years experience across Birmingham and surrounding areas.',
          pricingNotes: 'Call-out from £60. No hidden fees. Free quotes.',
          certifications: ['Gas Safe Registered', 'City & Guilds'],
          serviceAreaMiles: 15,
          portfolioPhotos: [],
          isAvailable: false,
          rating: 4.8,
          reviewCount: 12,
          status: 'approved',   // ← skips the admin approval step
        },
      },
    },
  });

  // ── Worker 2 (pending — to test admin approval flow) ─────────────────────
  await prisma.user.upsert({
    where: { email: 'worker2@tradefind.com' },
    update: {},
    create: {
      email: 'worker2@tradefind.com',
      name: 'Alice Electrician',
      phone: '07700000003',
      passwordHash: await hash('Test1234'),
      role: 'worker',
      workerProfile: {
        create: {
          trades: ['Electrician'],
          bio: 'NICEIC-approved electrician.',
          pricingNotes: 'Hourly rate £55.',
          certifications: ['NICEIC'],
          serviceAreaMiles: 10,
          portfolioPhotos: [],
          isAvailable: false,
          status: 'pending',    // ← blocked from going live until admin approves
        },
      },
    },
  });

  console.log('');
  console.log('Test accounts ready:');
  console.log('');
  console.log('  Role      Email                      Password');
  console.log('  ────────  ─────────────────────────  ──────────');
  console.log('  admin     admin@tradefind.com         Admin1234');
  console.log('  customer  customer@tradefind.com      Test1234');
  console.log('  worker    worker@tradefind.com        Test1234   (approved)');
  console.log('  worker    worker2@tradefind.com       Test1234   (pending approval)');
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
