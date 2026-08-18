import {
  PrismaClient,
  Role,
  MetalType,
  PricingMode,
  FulfilmentType,
  MakingChargeType,
  MakingChargeScope,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Default staff password for the seeded accounts (development only).
const DEFAULT_PASSWORD = 'Maya@12345';

async function reset() {
  // Delete in FK-safe order so the seed is idempotent in development.
  await prisma.inventoryLedger.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.productDiamond.deleteMany();
  await prisma.productStone.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productCollection.deleteMany();
  await prisma.product.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.makingChargeRule.deleteMany();
  await prisma.metalRate.deleteMany();
  await prisma.diamondRate.deleteMany();
  await prisma.purity.deleteMany();
  await prisma.metal.deleteMany();
  await prisma.category.deleteMany();
  await prisma.navItem.deleteMany();
  await prisma.user.deleteMany();
  await prisma.storeSetting.deleteMany();
}

async function seedStoreSettings() {
  await prisma.storeSetting.create({
    data: {
      id: 'default',
      brandName: 'Maya Jewellers',
      tagline: 'Fine jewellery, crafted in Delhi',
      phone: '+91 98100 00000',
      whatsappNumber: '+919810000000',
      email: 'hello@mayajewellers.example',
      supportEmail: 'care@mayajewellers.example',
      addressLine: '24 Karol Bagh Jewellers Lane',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110005',
      country: 'India',
      gstin: '07ABCDE1234F1Z5',
      currency: 'INR',
      locale: 'en-IN',
      gstPercentDefault: '3',
      freeShippingAbove: '25000',
      flatShippingFee: '150',
      codMaxOrderValue: '50000',
      codTokenAmount: '1000',
      verificationCallAbove: '100000',
      panThreshold: '200000',
      rateLockMinutes: 15,
      socialLinks: {
        instagram: 'https://instagram.com/mayajewellers',
        facebook: 'https://facebook.com/mayajewellers',
        youtube: 'https://youtube.com/@mayajewellers',
      },
      footerNote: 'Prices are indicative and calculated on live metal rates.',
      returnPolicy: '15-day easy returns on ready-to-ship pieces.',
    },
  });
}

async function seedStaff() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const staff: Array<{ email: string; name: string; role: Role }> = [
    { email: 'superadmin@maya.local', name: 'Maya Owner', role: Role.SUPER_ADMIN },
    { email: 'admin@maya.local', name: 'Store Admin', role: Role.ADMIN },
    { email: 'catalog@maya.local', name: 'Catalog Manager', role: Role.CATALOG_MANAGER },
    { email: 'sales@maya.local', name: 'Sales Executive', role: Role.SALES_EXECUTIVE },
    { email: 'dispatch@maya.local', name: 'Dispatch Desk', role: Role.DISPATCH },
  ];
  for (const s of staff) {
    await prisma.user.create({ data: { ...s, passwordHash } });
  }
}

async function seedNav() {
  const items = [
    ['New Arrivals', '/c/new-arrivals'],
    ['Gold', '/c/gold'],
    ['Diamond', '/c/diamond'],
    ['Silver', '/c/silver'],
    ['Rings', '/c/rings'],
    ['Earrings', '/c/earrings'],
    ['Necklaces', '/c/necklaces'],
    ['Bracelets', '/c/bracelets'],
    ['Bangles', '/c/bangles'],
    ['Mangalsutra', '/c/mangalsutra'],
    ['Wedding', '/c/wedding'],
    ['Gifting', '/c/gifting'],
    ['Collections', '/collections'],
  ];
  await prisma.navItem.createMany({
    data: items.map(([label, href], i) => ({ label: label!, href: href!, order: i })),
  });
}

async function seedCategories() {
  const cats = [
    ['New Arrivals', 'new-arrivals'],
    ['Gold', 'gold'],
    ['Diamond', 'diamond'],
    ['Silver', 'silver'],
    ['Rings', 'rings'],
    ['Earrings', 'earrings'],
    ['Necklaces', 'necklaces'],
    ['Bracelets', 'bracelets'],
    ['Bangles', 'bangles'],
    ['Mangalsutra', 'mangalsutra'],
    ['Wedding', 'wedding'],
    ['Gifting', 'gifting'],
  ];
  const map = new Map<string, string>();
  for (let i = 0; i < cats.length; i++) {
    const [name, slug] = cats[i]!;
    const c = await prisma.category.create({
      data: {
        name: name!,
        slug: slug!,
        order: i,
        seoTitle: `${name} Jewellery — Maya Jewellers`,
        seoDescription: `Shop ${name} jewellery at Maya Jewellers.`,
      },
    });
    map.set(slug!, c.id);
  }
  return map;
}

async function seedCollections() {
  const cols = [
    ['Bridal Trousseau', 'bridal', 'Wedding-ready gold and diamond sets.'],
    ['Everyday Gold', 'everyday-gold', 'Lightweight gold for daily wear.'],
    ['Diamond Solitaires', 'diamond-solitaires', 'Certified solitaire rings and studs.'],
  ];
  const map = new Map<string, string>();
  for (let i = 0; i < cols.length; i++) {
    const [name, slug, description] = cols[i]!;
    const c = await prisma.collection.create({
      data: { name: name!, slug: slug!, description: description!, order: i },
    });
    map.set(slug!, c.id);
  }
  return map;
}

async function seedMetalsAndRates() {
  const gold = await prisma.metal.create({
    data: { name: 'Gold', type: MetalType.GOLD, symbol: 'Au', order: 0 },
  });
  const silver = await prisma.metal.create({
    data: { name: 'Silver', type: MetalType.SILVER, symbol: 'Ag', order: 1 },
  });

  // Purities
  const g24 = await prisma.purity.create({ data: { metalId: gold.id, name: '24K', fineness: '0.9999', order: 0 } });
  const g22 = await prisma.purity.create({ data: { metalId: gold.id, name: '22K', fineness: '0.9166', order: 1 } });
  const g18 = await prisma.purity.create({ data: { metalId: gold.id, name: '18K', fineness: '0.7500', order: 2 } });
  const s925 = await prisma.purity.create({ data: { metalId: silver.id, name: '925 Silver', fineness: '0.9250', order: 0 } });

  // Current live rates (₹ per gram)
  const rates: Array<[string, string]> = [
    [g24.id, '7150.00'],
    [g22.id, '6560.00'],
    [g18.id, '5370.00'],
    [s925.id, '92.00'],
  ];
  for (const [purityId, ratePerGram] of rates) {
    await prisma.metalRate.create({
      data: { purityId, ratePerGram, isCurrent: true, note: 'Seed opening rate' },
    });
  }

  // Diamond rates (₹ per carat)
  const dVS = await prisma.diamondRate.create({
    data: { label: 'VS-GH-Round', clarity: 'VS', color: 'GH', shape: 'Round', ratePerCarat: '58000.00' },
  });
  const dSI = await prisma.diamondRate.create({
    data: { label: 'SI-GH-Round', clarity: 'SI', color: 'GH', shape: 'Round', ratePerCarat: '42000.00' },
  });

  return { gold, silver, g24, g22, g18, s925, dVS, dSI };
}

async function seedMakingCharges(ids: {
  gold: { id: string };
  silver: { id: string };
  ringsCategoryId: string;
}) {
  const globalRule = await prisma.makingChargeRule.create({
    data: {
      name: 'Global default making',
      scope: MakingChargeScope.GLOBAL,
      type: MakingChargeType.PERCENTAGE,
      value: '12',
      minCharge: '500',
      priority: 0,
    },
  });
  const goldMetalRule = await prisma.makingChargeRule.create({
    data: {
      name: 'Gold making %',
      scope: MakingChargeScope.METAL,
      type: MakingChargeType.PERCENTAGE,
      value: '14',
      minCharge: '900',
      priority: 10,
      metalId: ids.gold.id,
    },
  });
  const silverRule = await prisma.makingChargeRule.create({
    data: {
      name: 'Silver flat making',
      scope: MakingChargeScope.METAL,
      type: MakingChargeType.FLAT,
      value: '350',
      minCharge: '350',
      priority: 10,
      metalId: ids.silver.id,
    },
  });
  const ringsGoldRule = await prisma.makingChargeRule.create({
    data: {
      name: 'Gold rings per-gram making',
      scope: MakingChargeScope.CATEGORY_METAL,
      type: MakingChargeType.PER_GRAM,
      value: '520',
      minCharge: '1200',
      priority: 20,
      metalId: ids.gold.id,
      categoryId: ids.ringsCategoryId,
    },
  });
  return { globalRule, goldMetalRule, silverRule, ringsGoldRule };
}

type SeedVariant = {
  labelSuffix?: string;
  size?: string;
  metalColor?: string;
  netWeight?: string;
  grossWeight?: string;
  stock: number;
};

type SeedProduct = {
  name: string;
  slug: string;
  sku: string;
  categorySlug: string;
  extraCollections?: string[];
  pricingMode: PricingMode;
  metalKey?: 'gold' | 'silver' | null;
  purityKey?: 'g24' | 'g22' | 'g18' | 's925' | null;
  metalColor?: string;
  netWeight?: string;
  grossWeight?: string;
  wastagePct?: string;
  makingRuleKey?: 'globalRule' | 'goldMetalRule' | 'silverRule' | 'ringsGoldRule' | null;
  fixedPrice?: string;
  fulfilment: FulfilmentType;
  leadTimeDays?: number;
  advancePercent?: string;
  certification?: string;
  hasDiamond?: boolean;
  hasStone?: boolean;
  isFeatured?: boolean;
  isBestSeller?: boolean;
  isNewArrival?: boolean;
  occasion?: string[];
  tags?: string[];
  shortDescription: string;
  variants: SeedVariant[];
  diamonds?: Array<{ label: string; clarity?: string; color?: string; shape?: string; caratWeight: string; pieces: number; rateKey?: 'dVS' | 'dSI' }>;
  stones?: Array<{ name: string; type?: string; pieces: number; weightCarat?: string; ratePerUnit?: string; value?: string }>;
};

const PRODUCTS: SeedProduct[] = [
  // ── WEIGHT_BASED gold ──────────────────────────────────────────────
  {
    name: '22K Gold Floral Ring', slug: '22k-gold-floral-ring', sku: 'RG-G22-0001',
    categorySlug: 'rings', extraCollections: ['everyday-gold'], pricingMode: PricingMode.WEIGHT_BASED,
    metalKey: 'gold', purityKey: 'g22', metalColor: 'Yellow', netWeight: '3.200', grossWeight: '3.350',
    wastagePct: '8', makingRuleKey: 'ringsGoldRule', fulfilment: FulfilmentType.READY_TO_SHIP,
    certification: 'BIS Hallmark 916', isNewArrival: true, isBestSeller: true,
    occasion: ['Everyday', 'Gifting'], tags: ['gold', 'ring', '22k'],
    shortDescription: 'Delicate floral band in hallmarked 22K gold.',
    variants: [
      { size: '12', labelSuffix: 'Size 12', netWeight: '3.100', stock: 5 },
      { size: '14', labelSuffix: 'Size 14', netWeight: '3.200', stock: 4 },
      { size: '16', labelSuffix: 'Size 16', netWeight: '3.350', stock: 3 },
    ],
  },
  {
    name: '22K Gold Jhumka Earrings', slug: '22k-gold-jhumka-earrings', sku: 'ER-G22-0002',
    categorySlug: 'earrings', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'gold', purityKey: 'g22',
    metalColor: 'Yellow', netWeight: '6.400', grossWeight: '6.700', wastagePct: '10',
    makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.READY_TO_SHIP, certification: 'BIS Hallmark 916',
    isFeatured: true, occasion: ['Wedding', 'Festive'], tags: ['gold', 'earrings', 'jhumka'],
    shortDescription: 'Traditional jhumkas with intricate granulation.',
    variants: [{ labelSuffix: 'Pair', netWeight: '6.400', stock: 6 }],
  },
  {
    name: '22K Gold Chain Necklace', slug: '22k-gold-chain-necklace', sku: 'NK-G22-0003',
    categorySlug: 'necklaces', extraCollections: ['everyday-gold'], pricingMode: PricingMode.WEIGHT_BASED,
    metalKey: 'gold', purityKey: 'g22', metalColor: 'Yellow', netWeight: '12.500', grossWeight: '12.800',
    wastagePct: '7', makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.READY_TO_SHIP,
    certification: 'BIS Hallmark 916', isBestSeller: true, occasion: ['Everyday'], tags: ['gold', 'chain'],
    shortDescription: 'Classic rope chain in 22K gold.',
    variants: [
      { labelSuffix: '18 inch', size: '18in', netWeight: '12.500', stock: 4 },
      { labelSuffix: '20 inch', size: '20in', netWeight: '13.900', stock: 2 },
    ],
  },
  {
    name: '18K Gold Cuff Bracelet', slug: '18k-gold-cuff-bracelet', sku: 'BR-G18-0004',
    categorySlug: 'bracelets', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'gold', purityKey: 'g18',
    metalColor: 'Rose', netWeight: '9.200', grossWeight: '9.400', wastagePct: '9',
    makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.MADE_TO_ORDER, leadTimeDays: 14, advancePercent: '30',
    certification: 'BIS Hallmark 750', isNewArrival: true, occasion: ['Gifting'], tags: ['gold', 'bracelet', 'rose'],
    shortDescription: 'Sleek rose-gold cuff, made to order.',
    variants: [{ labelSuffix: 'Standard', netWeight: '9.200', stock: 0 }],
  },
  {
    name: '22K Gold Kada Bangle', slug: '22k-gold-kada-bangle', sku: 'BN-G22-0005',
    categorySlug: 'bangles', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'gold', purityKey: 'g22',
    metalColor: 'Yellow', netWeight: '18.700', grossWeight: '19.100', wastagePct: '11',
    makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.MADE_TO_ORDER, leadTimeDays: 21, advancePercent: '35',
    certification: 'BIS Hallmark 916', occasion: ['Wedding'], tags: ['gold', 'bangle', 'kada'],
    shortDescription: 'Handcrafted temple-work kada.',
    variants: [
      { labelSuffix: '2.4', size: '2.4', netWeight: '18.700', stock: 0 },
      { labelSuffix: '2.6', size: '2.6', netWeight: '20.100', stock: 0 },
    ],
  },
  {
    name: '22K Gold Mangalsutra', slug: '22k-gold-mangalsutra', sku: 'MG-G22-0006',
    categorySlug: 'mangalsutra', extraCollections: ['bridal'], pricingMode: PricingMode.WEIGHT_BASED,
    metalKey: 'gold', purityKey: 'g22', metalColor: 'Yellow', netWeight: '8.900', grossWeight: '9.300',
    wastagePct: '9', makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.READY_TO_SHIP,
    certification: 'BIS Hallmark 916', isFeatured: true, occasion: ['Wedding'], tags: ['gold', 'mangalsutra'],
    shortDescription: 'Black-bead mangalsutra with gold vati.',
    variants: [{ labelSuffix: '16 inch', size: '16in', netWeight: '8.900', stock: 5 }],
  },
  {
    name: '18K Gold Pendant', slug: '18k-gold-pendant', sku: 'PN-G18-0007',
    categorySlug: 'gifting', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'gold', purityKey: 'g18',
    metalColor: 'White', netWeight: '2.100', grossWeight: '2.200', wastagePct: '8',
    makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.READY_TO_SHIP, certification: 'BIS Hallmark 750',
    isNewArrival: true, occasion: ['Gifting'], tags: ['gold', 'pendant'],
    shortDescription: 'Minimal white-gold pendant.',
    variants: [{ labelSuffix: 'One size', netWeight: '2.100', stock: 8 }],
  },
  // ── WEIGHT_BASED silver ────────────────────────────────────────────
  {
    name: '925 Silver Oxidised Anklet', slug: '925-silver-oxidised-anklet', sku: 'AK-S925-0008',
    categorySlug: 'silver', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'silver', purityKey: 's925',
    metalColor: 'Oxidised', netWeight: '22.000', grossWeight: '22.500', wastagePct: '6',
    makingRuleKey: 'silverRule', fulfilment: FulfilmentType.READY_TO_SHIP, isBestSeller: true,
    occasion: ['Everyday'], tags: ['silver', 'anklet'],
    shortDescription: 'Oxidised silver anklet with ghungroo.',
    variants: [{ labelSuffix: 'Pair', netWeight: '22.000', stock: 12 }],
  },
  {
    name: '925 Silver Chain', slug: '925-silver-chain', sku: 'NK-S925-0009',
    categorySlug: 'silver', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'silver', purityKey: 's925',
    metalColor: 'White', netWeight: '15.500', grossWeight: '15.800', wastagePct: '5',
    makingRuleKey: 'silverRule', fulfilment: FulfilmentType.READY_TO_SHIP, occasion: ['Everyday', 'Gifting'],
    tags: ['silver', 'chain'], shortDescription: 'Everyday sterling silver chain.',
    variants: [
      { labelSuffix: '18 inch', size: '18in', netWeight: '15.500', stock: 10 },
      { labelSuffix: '22 inch', size: '22in', netWeight: '18.200', stock: 7 },
    ],
  },
  {
    name: '925 Silver Toe Rings', slug: '925-silver-toe-rings', sku: 'RG-S925-0010',
    categorySlug: 'silver', pricingMode: PricingMode.WEIGHT_BASED, metalKey: 'silver', purityKey: 's925',
    metalColor: 'White', netWeight: '4.300', grossWeight: '4.400', wastagePct: '6',
    makingRuleKey: 'silverRule', fulfilment: FulfilmentType.READY_TO_SHIP, occasion: ['Wedding'],
    tags: ['silver', 'toe-ring'], shortDescription: 'Adjustable sterling silver toe rings.',
    variants: [{ labelSuffix: 'Pair', netWeight: '4.300', stock: 20 }],
  },
  // ── COMPONENT_BASED diamond ────────────────────────────────────────
  {
    name: 'Diamond Solitaire Ring', slug: 'diamond-solitaire-ring', sku: 'RG-DIA-0011',
    categorySlug: 'diamond', extraCollections: ['diamond-solitaires', 'bridal'], pricingMode: PricingMode.COMPONENT_BASED,
    metalKey: 'gold', purityKey: 'g18', metalColor: 'White', netWeight: '3.800', grossWeight: '4.000',
    wastagePct: '6', makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.MADE_TO_ORDER, leadTimeDays: 12, advancePercent: '40',
    certification: 'IGI Certified', hasDiamond: true, isFeatured: true, isBestSeller: true,
    occasion: ['Wedding', 'Engagement'], tags: ['diamond', 'solitaire', 'ring'],
    shortDescription: 'Classic six-prong solitaire in 18K white gold.',
    variants: [
      { size: '12', labelSuffix: 'Size 12', netWeight: '3.800', stock: 2 },
      { size: '14', labelSuffix: 'Size 14', netWeight: '3.900', stock: 2 },
    ],
    diamonds: [{ label: 'Center solitaire', clarity: 'VS', color: 'GH', shape: 'Round', caratWeight: '0.500', pieces: 1, rateKey: 'dVS' }],
  },
  {
    name: 'Diamond Stud Earrings', slug: 'diamond-stud-earrings', sku: 'ER-DIA-0012',
    categorySlug: 'diamond', extraCollections: ['diamond-solitaires'], pricingMode: PricingMode.COMPONENT_BASED,
    metalKey: 'gold', purityKey: 'g18', metalColor: 'White', netWeight: '2.600', grossWeight: '2.750',
    wastagePct: '6', makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.READY_TO_SHIP,
    certification: 'IGI Certified', hasDiamond: true, isNewArrival: true, occasion: ['Gifting'],
    tags: ['diamond', 'studs', 'earrings'], shortDescription: 'Brilliant-cut diamond studs.',
    variants: [{ labelSuffix: 'Pair', netWeight: '2.600', stock: 3 }],
    diamonds: [{ label: 'Studs', clarity: 'SI', color: 'GH', shape: 'Round', caratWeight: '0.300', pieces: 2, rateKey: 'dSI' }],
  },
  {
    name: 'Diamond Tennis Bracelet', slug: 'diamond-tennis-bracelet', sku: 'BR-DIA-0013',
    categorySlug: 'diamond', pricingMode: PricingMode.COMPONENT_BASED, metalKey: 'gold', purityKey: 'g18',
    metalColor: 'White', netWeight: '7.100', grossWeight: '7.400', wastagePct: '7',
    makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.MADE_TO_ORDER, leadTimeDays: 18, advancePercent: '40',
    certification: 'IGI Certified', hasDiamond: true, isFeatured: true, occasion: ['Wedding'],
    tags: ['diamond', 'bracelet', 'tennis'], shortDescription: 'A line of matched round diamonds.',
    variants: [{ labelSuffix: '7 inch', size: '7in', netWeight: '7.100', stock: 1 }],
    diamonds: [{ label: 'Line diamonds', clarity: 'VS', color: 'GH', shape: 'Round', caratWeight: '1.500', pieces: 30, rateKey: 'dVS' }],
  },
  {
    name: 'Diamond Bridal Necklace Set', slug: 'diamond-bridal-necklace-set', sku: 'NK-DIA-0014',
    categorySlug: 'wedding', extraCollections: ['bridal'], pricingMode: PricingMode.COMPONENT_BASED,
    metalKey: 'gold', purityKey: 'g18', metalColor: 'Yellow', netWeight: '34.000', grossWeight: '35.500',
    wastagePct: '10', makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.MADE_TO_ORDER, leadTimeDays: 30, advancePercent: '50',
    certification: 'IGI Certified', hasDiamond: true, hasStone: true, isFeatured: true, occasion: ['Wedding'],
    tags: ['diamond', 'bridal', 'necklace', 'set'], shortDescription: 'Statement bridal set with diamonds and emeralds.',
    variants: [{ labelSuffix: 'Set', netWeight: '34.000', stock: 0 }],
    diamonds: [{ label: 'Necklace diamonds', clarity: 'SI', color: 'GH', shape: 'Round', caratWeight: '3.200', pieces: 120, rateKey: 'dSI' }],
    stones: [{ name: 'Emerald', type: 'Gemstone', pieces: 8, weightCarat: '4.000', ratePerUnit: '3500' }],
  },
  {
    name: 'Diamond Gold Pendant', slug: 'diamond-gold-pendant', sku: 'PN-DIA-0015',
    categorySlug: 'diamond', pricingMode: PricingMode.COMPONENT_BASED, metalKey: 'gold', purityKey: 'g18',
    metalColor: 'Rose', netWeight: '2.900', grossWeight: '3.050', wastagePct: '6',
    makingRuleKey: 'goldMetalRule', fulfilment: FulfilmentType.READY_TO_SHIP, certification: 'IGI Certified',
    hasDiamond: true, isNewArrival: true, occasion: ['Gifting'], tags: ['diamond', 'pendant', 'rose'],
    shortDescription: 'Rose-gold heart pendant with pavé diamonds.',
    variants: [{ labelSuffix: 'One size', netWeight: '2.900', stock: 4 }],
    diamonds: [{ label: 'Pavé', clarity: 'SI', color: 'GH', shape: 'Round', caratWeight: '0.250', pieces: 18, rateKey: 'dSI' }],
  },
  {
    name: 'Gold Ring with Ruby', slug: 'gold-ring-with-ruby', sku: 'RG-STN-0016',
    categorySlug: 'rings', pricingMode: PricingMode.COMPONENT_BASED, metalKey: 'gold', purityKey: 'g22',
    metalColor: 'Yellow', netWeight: '4.500', grossWeight: '4.700', wastagePct: '8',
    makingRuleKey: 'ringsGoldRule', fulfilment: FulfilmentType.READY_TO_SHIP, certification: 'BIS Hallmark 916',
    hasStone: true, occasion: ['Festive', 'Gifting'], tags: ['gold', 'ruby', 'ring'],
    shortDescription: 'Statement ring with a natural ruby.',
    variants: [
      { size: '12', labelSuffix: 'Size 12', netWeight: '4.500', stock: 3 },
      { size: '14', labelSuffix: 'Size 14', netWeight: '4.650', stock: 2 },
    ],
    stones: [{ name: 'Ruby', type: 'Gemstone', pieces: 1, weightCarat: '1.200', value: '9000' }],
  },
  // ── FIXED (gold-plated / imitation) ───────────────────────────────
  {
    name: 'Gold-Plated Kundan Choker', slug: 'gold-plated-kundan-choker', sku: 'NK-FIX-0017',
    categorySlug: 'necklaces', extraCollections: ['bridal'], pricingMode: PricingMode.FIXED,
    metalColor: 'Gold-plated', fixedPrice: '3499', fulfilment: FulfilmentType.READY_TO_SHIP,
    isBestSeller: true, occasion: ['Wedding', 'Festive'], tags: ['imitation', 'kundan', 'choker'],
    shortDescription: 'Bridal kundan choker in gold-plated brass.',
    variants: [{ labelSuffix: 'One size', stock: 25 }],
    stones: [{ name: 'Kundan', type: 'Imitation', pieces: 40, value: '0' }],
  },
  {
    name: 'Gold-Plated Temple Earrings', slug: 'gold-plated-temple-earrings', sku: 'ER-FIX-0018',
    categorySlug: 'earrings', pricingMode: PricingMode.FIXED, metalColor: 'Gold-plated', fixedPrice: '1299',
    fulfilment: FulfilmentType.READY_TO_SHIP, isNewArrival: true, occasion: ['Festive'],
    tags: ['imitation', 'temple', 'earrings'], shortDescription: 'South-Indian temple studs, gold-plated.',
    variants: [{ labelSuffix: 'Pair', stock: 40 }],
  },
  {
    name: 'Gold-Plated Bridal Bangle Set', slug: 'gold-plated-bridal-bangle-set', sku: 'BN-FIX-0019',
    categorySlug: 'bangles', extraCollections: ['bridal'], pricingMode: PricingMode.FIXED,
    metalColor: 'Gold-plated', fixedPrice: '2799', fulfilment: FulfilmentType.READY_TO_SHIP,
    occasion: ['Wedding'], tags: ['imitation', 'bangle', 'set'], shortDescription: 'Set of 4 gold-plated bridal bangles.',
    variants: [
      { size: '2.4', labelSuffix: '2.4', stock: 15 },
      { size: '2.6', labelSuffix: '2.6', stock: 12 },
    ],
  },
  {
    name: 'Gold-Plated Gift Pendant Set', slug: 'gold-plated-gift-pendant-set', sku: 'PN-FIX-0020',
    categorySlug: 'gifting', pricingMode: PricingMode.FIXED, metalColor: 'Gold-plated', fixedPrice: '899',
    fulfilment: FulfilmentType.READY_TO_SHIP, isNewArrival: true, occasion: ['Gifting'],
    tags: ['imitation', 'pendant', 'gift'], shortDescription: 'Everyday gift-ready pendant with chain.',
    variants: [{ labelSuffix: 'One size', stock: 50 }],
  },
];

async function seedProducts(
  categoryMap: Map<string, string>,
  collectionMap: Map<string, string>,
  refs: Awaited<ReturnType<typeof seedMetalsAndRates>>,
  rules: Awaited<ReturnType<typeof seedMakingCharges>>
) {
  const metalIds = { gold: refs.gold.id, silver: refs.silver.id };
  const purityIds = { g24: refs.g24.id, g22: refs.g22.id, g18: refs.g18.id, s925: refs.s925.id };
  const diamondRateIds = { dVS: refs.dVS.id, dSI: refs.dSI.id };
  const ruleIds = {
    globalRule: rules.globalRule.id,
    goldMetalRule: rules.goldMetalRule.id,
    silverRule: rules.silverRule.id,
    ringsGoldRule: rules.ringsGoldRule.id,
  };

  for (const p of PRODUCTS) {
    const categoryId = categoryMap.get(p.categorySlug);
    if (!categoryId) throw new Error(`Missing category ${p.categorySlug}`);

    const product = await prisma.product.create({
      data: {
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        shortDescription: p.shortDescription,
        description: `${p.shortDescription} Crafted by Maya Jewellers.`,
        categoryId,
        pricingMode: p.pricingMode,
        metalId: p.metalKey ? metalIds[p.metalKey] : null,
        purityId: p.purityKey ? purityIds[p.purityKey] : null,
        metalColor: p.metalColor ?? null,
        netWeight: p.netWeight ?? null,
        grossWeight: p.grossWeight ?? null,
        wastagePct: p.wastagePct ?? '0',
        makingChargeRuleId: p.makingRuleKey ? ruleIds[p.makingRuleKey] : null,
        fixedPrice: p.fixedPrice ?? null,
        gstPercent: '3',
        gstInclusive: false,
        fulfilmentType: p.fulfilment,
        leadTimeDays: p.leadTimeDays ?? null,
        advancePercent: p.advancePercent ?? null,
        certification: p.certification ?? null,
        hasDiamond: p.hasDiamond ?? false,
        hasStone: p.hasStone ?? false,
        isFeatured: p.isFeatured ?? false,
        isBestSeller: p.isBestSeller ?? false,
        isNewArrival: p.isNewArrival ?? false,
        occasion: p.occasion ?? [],
        tags: p.tags ?? [],
        publishedAt: new Date(),
        seoTitle: `${p.name} — Maya Jewellers`,
        seoDescription: p.shortDescription,
        images: {
          create: [
            { url: `/products/${p.slug}-1.jpg`, alt: p.name, order: 0, isPrimary: true },
            { url: `/products/${p.slug}-2.jpg`, alt: `${p.name} alternate`, order: 1 },
          ],
        },
      },
    });

    // Collections (own category slug if it maps to a collection is skipped; use extraCollections)
    const collectionSlugs = new Set(p.extraCollections ?? []);
    for (const slug of collectionSlugs) {
      const collectionId = collectionMap.get(slug);
      if (collectionId) {
        await prisma.productCollection.create({ data: { productId: product.id, collectionId } });
      }
    }

    // Variants + inventory
    let idx = 1;
    for (const v of p.variants) {
      const variantSku = `${p.sku}-V${idx++}`;
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: variantSku,
          label: v.labelSuffix ?? null,
          size: v.size ?? null,
          metalColor: v.metalColor ?? p.metalColor ?? null,
          netWeight: v.netWeight ?? null,
          grossWeight: v.grossWeight ?? null,
          inventory: {
            create: {
              stockQty: v.stock,
              reservedQty: 0,
              lowStockThreshold: 2,
            },
          },
        },
      });

      // Diamonds / stones attach at product level (shared across variants) — create once.
      if (idx === 2) {
        for (const d of p.diamonds ?? []) {
          await prisma.productDiamond.create({
            data: {
              productId: product.id,
              label: d.label,
              clarity: d.clarity ?? null,
              color: d.color ?? null,
              shape: d.shape ?? null,
              caratWeight: d.caratWeight,
              pieces: d.pieces,
              diamondRateId: d.rateKey ? diamondRateIds[d.rateKey] : null,
            },
          });
        }
        for (const s of p.stones ?? []) {
          await prisma.productStone.create({
            data: {
              productId: product.id,
              name: s.name,
              type: s.type ?? null,
              pieces: s.pieces,
              weightCarat: s.weightCarat ?? null,
              ratePerUnit: s.ratePerUnit ?? null,
              value: s.value ?? null,
            },
          });
        }
      }
      void variant;
    }
  }
}

async function main() {
  console.log('🌱 Seeding Maya Jewellers…');
  await reset();
  await seedStoreSettings();
  await seedStaff();
  await seedNav();
  const categoryMap = await seedCategories();
  const collectionMap = await seedCollections();
  const refs = await seedMetalsAndRates();
  const rules = await seedMakingCharges({
    gold: refs.gold,
    silver: refs.silver,
    ringsCategoryId: categoryMap.get('rings')!,
  });
  await seedProducts(categoryMap, collectionMap, refs, rules);

  const [products, variants, users] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.user.count(),
  ]);
  console.log(`✅ Seed complete — ${products} products, ${variants} variants, ${users} staff.`);
  console.log(`   Staff login: superadmin@maya.local / ${DEFAULT_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
