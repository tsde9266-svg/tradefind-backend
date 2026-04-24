import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const hash = (pw: string) => bcrypt.hash(pw, 10);

// Test location anchor: Birmingham city centre (52.4862, -1.8904)
// All workers are within ~5 miles of this point.

const WORKERS = [
  {
    email: 'marcus.thompson@tradefind.com',
    name: 'Marcus Thompson',
    phone: '07711100001',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/men/32.jpg',
    profile: {
      trades: ['Plumber', 'Gas Engineer'],
      bio: 'Fully qualified plumber and Gas Safe registered engineer with 14 years of hands-on experience in Birmingham. Specialising in boiler installations, central heating, and emergency call-outs.',
      pricingNotes: 'Call-out from £60. Boiler service £85. No VAT for domestic work. Free written quotes.',
      certifications: ['Gas Safe Registered', 'City & Guilds Level 3', 'CIPHE Member'],
      serviceAreaMiles: 15,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1607400201515-c2c41c07d307?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
      ],
      isAvailable: true,
      latitude: 52.4950,
      longitude: -1.8800,
      rating: 4.8,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'sarah.mitchell@tradefind.com',
    name: 'Sarah Mitchell',
    phone: '07711100002',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/women/44.jpg',
    profile: {
      trades: ['Electrician'],
      bio: 'NICEIC-approved electrician covering Birmingham and the West Midlands. From consumer unit upgrades and EV charger installations to full rewires and fault finding.',
      pricingNotes: 'First hour £65, then £45/hr. EV charger install from £350. Free estimates.',
      certifications: ['NICEIC Approved Contractor', '18th Edition Wiring Regulations', 'EV Charging Installation'],
      serviceAreaMiles: 12,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800',
        'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=800',
      ],
      isAvailable: true,
      latitude: 52.4780,
      longitude: -1.9100,
      rating: 4.9,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'james.obrien@tradefind.com',
    name: 'James O\'Brien',
    phone: '07711100003',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/men/67.jpg',
    profile: {
      trades: ['Builder', 'Carpenter', 'Handyman'],
      bio: 'General builder and carpenter with 20 years in the trade. Extensions, loft conversions, kitchen fitting, doors and flooring. All work comes with a 5-year guarantee.',
      pricingNotes: 'Day rate £250. Project quotes on request. 10% discount for pensioners.',
      certifications: ['CSCS Gold Card', 'City & Guilds Carpentry', 'NVQ Level 3 Construction'],
      serviceAreaMiles: 20,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800',
        'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
      ],
      isAvailable: true,
      latitude: 52.4920,
      longitude: -1.8650,
      rating: 4.7,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'priya.patel@tradefind.com',
    name: 'Priya Patel',
    phone: '07711100004',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/women/29.jpg',
    profile: {
      trades: ['Painter', 'Decorator'],
      bio: 'Professional painter and decorator based in Solihull. Interior and exterior work, feature walls, wallpapering, and commercial painting. Neat, efficient, and fully insured.',
      pricingNotes: 'Room from £180 inc materials. Full house quotes welcome. Wallpaper extra.',
      certifications: ['City & Guilds Painting & Decorating', 'Dulux Select Decorator'],
      serviceAreaMiles: 10,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=800',
        'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=800',
      ],
      isAvailable: true,
      latitude: 52.4800,
      longitude: -1.8750,
      rating: 4.6,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'david.williams@tradefind.com',
    name: 'David Williams',
    phone: '07711100005',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/men/11.jpg',
    profile: {
      trades: ['Roofer'],
      bio: 'Specialist roofer with 18 years experience. Flat roofs, pitched roofs, guttering, fascias, and chimneys. Emergency repairs available 7 days a week.',
      pricingNotes: 'Free roof survey. Repairs from £75. Full re-roof quotes on inspection.',
      certifications: ['NFRC Member', 'CITB Health & Safety'],
      serviceAreaMiles: 25,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800',
        'https://images.unsplash.com/photo-1516156008625-3a9d6067fab5?w=800',
      ],
      isAvailable: false,
      latitude: 52.4700,
      longitude: -1.9200,
      rating: 4.5,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'emma.clarke@tradefind.com',
    name: 'Emma Clarke',
    phone: '07711100006',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/women/56.jpg',
    profile: {
      trades: ['Tiler', 'Bathroom Fitter'],
      bio: 'Experienced bathroom fitter and tiler. Full bathroom refurbs, wet rooms, tiling floors and walls. Precise, clean, and always on schedule.',
      pricingNotes: 'Tiling from £35/m². Bathroom fit from £800 (ex. materials). Free design consultation.',
      certifications: ['City & Guilds Tiling', 'WRAS Approved Plumbing'],
      serviceAreaMiles: 10,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=800',
        'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800',
      ],
      isAvailable: true,
      latitude: 52.5000,
      longitude: -1.8850,
      rating: 4.9,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'kevin.brown@tradefind.com',
    name: 'Kevin Brown',
    phone: '07711100007',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/men/85.jpg',
    profile: {
      trades: ['Landscaper', 'Gardener'],
      bio: 'Landscaper and gardener serving the West Midlands for 12 years. Garden design, patios, decking, fencing, lawn care, and tree surgery. Fully insured.',
      pricingNotes: 'Regular gardening from £30/visit. Landscaping projects quoted individually.',
      certifications: ['PA1 & PA6 Spraying Certificate', 'Lantra Fencing Award'],
      serviceAreaMiles: 15,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800',
        'https://images.unsplash.com/photo-1558904541-efa843a96f01?w=800',
      ],
      isAvailable: true,
      latitude: 52.4650,
      longitude: -1.8600,
      rating: 4.4,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
  {
    email: 'aisha.johnson@tradefind.com',
    name: 'Aisha Johnson',
    phone: '07711100008',
    password: 'Test1234',
    avatarUrl: 'https://randomuser.me/api/portraits/women/18.jpg',
    profile: {
      trades: ['Cleaner', 'End of Tenancy Cleaning'],
      bio: 'Professional domestic and commercial cleaner in Birmingham. Deep cleans, end-of-tenancy, one-off cleans, and regular bookings. DBS checked and fully insured.',
      pricingNotes: 'Hourly rate £18. End-of-tenancy from £120. Supplies included.',
      certifications: ['DBS Checked', 'BICSc Member'],
      serviceAreaMiles: 8,
      portfolioPhotos: [
        'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
      ],
      isAvailable: true,
      latitude: 52.4950,
      longitude: -1.9050,
      rating: 4.7,
      reviewCount: 0,
      status: 'approved' as const,
    },
  },
];

const REVIEW_TEXTS: { rating: number; text: string }[] = [
  { rating: 5, text: 'Absolutely brilliant — arrived on time, did a clean job, and explained everything clearly. Will 100% use again.' },
  { rating: 5, text: 'Best tradesperson I\'ve used in years. Fixed the problem quickly and the price was exactly as quoted. Highly recommend.' },
  { rating: 5, text: 'Turned up when they said they would, which alone puts them ahead of most. The work was excellent quality.' },
  { rating: 5, text: 'Incredibly professional from start to finish. Tidied up after themselves too — rare these days!' },
  { rating: 5, text: 'Impressed with the attention to detail. You can tell they take real pride in their work.' },
  { rating: 4, text: 'Really good work overall. Took a little longer than estimated but the quality makes up for it. Would recommend.' },
  { rating: 4, text: 'Solid job, competitive price, and great communication throughout. Minor delay but kept me updated.' },
  { rating: 4, text: 'Very happy with the result. Friendly and knowledgeable — just wish they\'d arrived a bit earlier.' },
  { rating: 4, text: 'Good quality work and fair pricing. Slight mess left behind but nothing major. Overall very positive.' },
  { rating: 4, text: 'Highly competent and honest about what needed doing and what didn\'t. Refreshing approach.' },
  { rating: 3, text: 'Work was fine in the end but communication was a bit slow. Wouldn\'t be put off using them again though.' },
  { rating: 3, text: 'Decent job done but ran over schedule by half a day. Final result was good, just needed more updates.' },
  { rating: 5, text: 'Fantastic — I had a leak that three plumbers couldn\'t find. Found and fixed it in an hour. Brilliant.' },
  { rating: 5, text: 'Emma did a stunning job on our bathroom. It looks like something from a showroom. Worth every penny.' },
  { rating: 4, text: 'Marcus replaced our boiler quickly and everything has been working perfectly since. No complaints.' },
  { rating: 5, text: 'Sarah rewired our whole house — professional, minimal disruption, and all signed off without a hitch.' },
  { rating: 5, text: 'Kevin transformed our garden completely. We couldn\'t be happier — the patio looks incredible.' },
  { rating: 4, text: 'David sorted our leaking roof quickly. Not the cheapest but you get what you pay for with roofing.' },
  { rating: 5, text: 'Priya\'s attention to detail is second to none. Our lounge has never looked so good.' },
  { rating: 5, text: 'Aisha did an end-of-tenancy clean and the landlord was amazed — got our full deposit back. Legend.' },
  { rating: 4, text: 'James built our extension exactly to spec and within budget. Reliable and easy to work with.' },
  { rating: 5, text: 'Couldn\'t fault them at all. Communication, quality, and price were all spot on.' },
  { rating: 3, text: 'Good tradesperson but hard to get hold of initially. Once started the work was fine.' },
  { rating: 5, text: 'Honest, reliable, and incredibly skilled. Found and fixed the issue my previous tradesperson missed.' },
  { rating: 4, text: 'Really pleased with the outcome. Would definitely use again and recommend to friends.' },
];

async function main() {
  console.log('Seeding demo data…\n');

  // ── Extra reviewer customers ─────────────────────────────────────────────
  const reviewerEmails = [
    { email: 'jane.customer@tradefind.com', name: 'Jane Hargreaves', phone: '07800100001' },
    { email: 'tom.customer@tradefind.com',  name: 'Tom Okafor',      phone: '07800100002' },
    { email: 'lisa.customer@tradefind.com', name: 'Lisa Brennan',    phone: '07800100003' },
    { email: 'raj.customer@tradefind.com',  name: 'Raj Sharma',      phone: '07800100004' },
  ];
  const reviewerIds: string[] = [];
  for (const r of reviewerEmails) {
    const u = await prisma.user.upsert({
      where: { email: r.email },
      update: {},
      create: { ...r, passwordHash: await hash('Test1234'), role: 'customer' },
    });
    reviewerIds.push(u.id);
  }

  // ── Demo customer (shareable) ────────────────────────────────────────────
  const demoCustomer = await prisma.user.upsert({
    where: { email: 'customer@tradefind.com' },
    update: {},
    create: {
      email: 'customer@tradefind.com',
      name: 'Demo Customer',
      phone: '07700000001',
      passwordHash: await hash('Demo1234'),
      role: 'customer',
    },
  });
  reviewerIds.push(demoCustomer.id);

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

  // ── Create workers ───────────────────────────────────────────────────────
  const workerProfileIds: string[] = [];

  for (const w of WORKERS) {
    const user = await prisma.user.upsert({
      where: { email: w.email },
      update: { avatarUrl: w.avatarUrl },
      create: {
        email: w.email,
        name: w.name,
        phone: w.phone,
        passwordHash: await hash(w.password),
        role: 'worker',
        avatarUrl: w.avatarUrl,
      },
    });

    let profile = await prisma.workerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await prisma.workerProfile.create({
        data: { userId: user.id, ...w.profile },
      });
    } else {
      profile = await prisma.workerProfile.update({
        where: { id: profile.id },
        data: {
          latitude: w.profile.latitude,
          longitude: w.profile.longitude,
          rating: w.profile.rating,
          status: w.profile.status,
          isAvailable: w.profile.isAvailable,
        },
      });
    }
    workerProfileIds.push(profile.id);
  }

  // ── Demo worker (keep existing + add geo) ────────────────────────────────
  const demoWorker = await prisma.user.upsert({
    where: { email: 'worker@tradefind.com' },
    update: { avatarUrl: 'https://randomuser.me/api/portraits/men/52.jpg' },
    create: {
      email: 'worker@tradefind.com',
      name: 'Bob Plumber',
      phone: '07700000002',
      passwordHash: await hash('Demo1234'),
      role: 'worker',
      avatarUrl: 'https://randomuser.me/api/portraits/men/52.jpg',
    },
  });
  {
    let p = await prisma.workerProfile.findUnique({ where: { userId: demoWorker.id } });
    if (!p) {
      p = await prisma.workerProfile.create({
        data: {
          userId: demoWorker.id,
          trades: ['Plumber', 'Gas Engineer'],
          bio: 'Qualified plumber with 10 years experience across Birmingham and surrounding areas.',
          pricingNotes: 'Call-out from £60. No hidden fees. Free quotes.',
          certifications: ['Gas Safe Registered', 'City & Guilds'],
          serviceAreaMiles: 15,
          portfolioPhotos: [],
          isAvailable: true,
          latitude: 52.4862,
          longitude: -1.8904,
          rating: 4.8,
          reviewCount: 0,
          status: 'approved',
        },
      });
    } else {
      p = await prisma.workerProfile.update({
        where: { id: p.id },
        data: { latitude: 52.4862, longitude: -1.8904, status: 'approved', isAvailable: true },
      });
    }
    workerProfileIds.push(p.id);
  }

  // ── Seed reviews (skip if already exist for this worker) ─────────────────
  // ~2-3 reviews per worker, distributed across reviewers
  const reviewAssignments = [
    // [workerProfileIndex, reviewTextIndex, reviewerIndex]
    [0, 0, 0], [0, 14, 1], [0, 12, 2],
    [1, 1, 0], [1, 15, 2], [1, 6, 3],
    [2, 2, 1], [2, 20, 3], [2, 3, 4],
    [3, 3, 0], [3, 18, 1], [3, 9, 2],
    [4, 4, 2], [4, 17, 3], [4, 11, 4],
    [5, 5, 0], [5, 13, 1], [5, 7, 3],
    [6, 6, 1], [6, 16, 2], [6, 23, 4],
    [7, 7, 0], [7, 19, 2], [7, 24, 3],
    [8, 8, 1], [8, 21, 3], [8, 22, 4],  // demo worker (Bob)
  ];

  let reviewsCreated = 0;
  for (const [wi, ri, ci] of reviewAssignments) {
    const workerId = workerProfileIds[wi];
    const fromUserId = reviewerIds[ci % reviewerIds.length];
    if (!workerId || !fromUserId) continue;

    const existing = await prisma.review.findFirst({ where: { toWorkerId: workerId, fromUserId } });
    if (existing) continue;

    const { rating, text } = REVIEW_TEXTS[ri % REVIEW_TEXTS.length];
    await prisma.review.create({
      data: { fromUserId, toWorkerId: workerId, rating, text, photos: [] },
    });
    reviewsCreated++;
  }

  // ── Recalculate ratings from actual reviews ──────────────────────────────
  for (const profileId of workerProfileIds) {
    const reviews = await prisma.review.findMany({ where: { toWorkerId: profileId, removed: false } });
    if (!reviews.length) continue;
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    await prisma.workerProfile.update({
      where: { id: profileId },
      data: { rating: Math.round(avg * 10) / 10, reviewCount: reviews.length },
    });
  }

  console.log(`Workers created/updated : ${workerProfileIds.length}`);
  console.log(`Reviews seeded          : ${reviewsCreated}`);
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   DEMO CREDENTIALS                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Role      Email                        Password             ║');
  console.log('║  ───────── ───────────────────────────  ──────────           ║');
  console.log('║  customer  customer@tradefind.com        Demo1234            ║');
  console.log('║  worker    worker@tradefind.com          Demo1234  (approved)║');
  console.log('║  admin     admin@tradefind.com           Admin1234           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Test anchor location: Birmingham (52.4862, -1.8904)         ║');
  console.log('║  All 9 workers visible within 25 miles of that point         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
