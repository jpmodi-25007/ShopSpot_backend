import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  Prisma,
  ReportStatus,
  ShopStatus,
  UserRole,
  SubscriptionTier,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VerifyShopDto,
  VerifyInfluencerDto,
  SuspendUserDto,
  PaginationDto,
  ResolveReportDto,
  CreateShopDto,
  CreateProductDto,
  CreateUserDto,
  CreateInfluencerDto,
  UpdateUserDto,
  UpdateShopDto,
  UpdateProductDto,
  BulkReportAction,
} from './dto/admin.dto';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

/** Upper bound for list endpoints. */
const MAX_PAGE_SIZE = 100;

/** Parses ?page/?limit defensively: junk falls back to defaults, limit is capped. */
function parsePagination(query: { page?: string; limit?: string }) {
  const rawPage = parseInt(query?.page ?? '', 10);
  const rawLimit = parseInt(query?.limit ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, MAX_PAGE_SIZE)
      : 20;
  return { page, limit };
}

/** Case-insensitive "contains" filter for a text column. */
const like = (value: string): Prisma.StringFilter => ({
  contains: value,
  mode: 'insensitive',
});

/** Trimmed search text, or undefined when blank. */
function cleanSearch(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Parses an ISO date filter; junk is rejected rather than silently ignored. */
function parseCreatedFrom(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException('createdFrom must be a valid ISO date');
  return d;
}

function parseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase() as T;
  if (!allowed.includes(upper))
    throw new BadRequestException(
      `Invalid ${label}. Allowed: ${allowed.join(', ')}`,
    );
  return upper;
}

/** '' clears an optional text column; undefined leaves it untouched. */
function nullable(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  return v === '' ? null : v;
}

function pageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort audit trail; never blocks the admin action itself. */
  private async audit(
    actorId: string | undefined,
    action: string,
    entityType: string,
    entityId: string,
    oldValue?: Prisma.InputJsonValue,
    newValue?: Prisma.InputJsonValue,
  ) {
    if (!actorId) return;
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorRole: 'ADMIN',
          action,
          entityType,
          entityId,
          oldValue,
          newValue,
        },
      });
    } catch {
      // audit failures must not fail the action
    }
  }

  /** Latest admin note for a user (stored in the audit log, no schema change). */
  private async latestNote(userId: string): Promise<string> {
    const row = await this.prisma.auditLog.findFirst({
      where: { action: 'ADMIN_NOTE', entityType: 'USER', entityId: userId },
      orderBy: { createdAt: 'desc' },
    });
    const note = (row?.newValue as { note?: string } | null)?.note;
    return note ?? '';
  }

  async setUserNote(userId: string, note: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorRole: 'ADMIN',
        action: 'ADMIN_NOTE',
        entityType: 'USER',
        entityId: userId,
        newValue: { note },
      },
    });
    return { note };
  }

  /** Counts that drive the sidebar badges and bell. */
  async getSummary(actorId: string) {
    const [
      pendingReports,
      unreadNotifications,
      pendingShops,
      pendingInfluencers,
    ] = await Promise.all([
      this.prisma.contentReport.count({ where: { status: 'PENDING' } }),
      this.prisma.notification.count({
        where: { userId: actorId, isRead: false },
      }),
      this.prisma.shop.count({
        where: { isKycVerified: false, status: 'ACTIVE' },
      }),
      this.prisma.user.count({
        where: {
          role: 'INFLUENCER',
          isActive: true,
          OR: [
            { influencerProfile: { is: null } },
            { influencerProfile: { verificationStatus: 'PENDING' } },
          ],
        },
      }),
    ]);
    return {
      pendingReports,
      unreadNotifications,
      pendingShops,
      pendingInfluencers,
    };
  }

  /**
   * Admin-created accounts get a random, never-disclosed argon2 password (the
   * same algorithm login verifies against). The owner sets their own password
   * through the "forgot password" flow, so no shared default credential exists.
   */
  private generateUnusablePasswordHash(): Promise<string> {
    return argon2.hash(randomBytes(32).toString('hex'));
  }

  async getUsers(query: PaginationDto) {
    const { page, limit } = parsePagination(query);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    const search = cleanSearch(query.search);
    if (search) {
      where.OR = [
        { name: like(search) },
        { email: like(search) },
        { mobile: like(search) },
      ];
    }
    const role = parseEnum(query.role, Object.values(UserRole), 'role');
    if (role) where.role = role;
    const status = parseEnum(
      query.status,
      ['ACTIVE', 'SUSPENDED'] as const,
      'status',
    );
    if (status) where.isActive = status === 'ACTIVE';
    const from = parseCreatedFrom(query.createdFrom);
    if (from) where.createdAt = { gte: from };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: users, meta: pageMeta(total, page, limit) };
  }

  async getShops(query: PaginationDto) {
    const { page, limit } = parsePagination(query);
    const skip = (page - 1) * limit;

    const where: Prisma.ShopWhereInput = {};
    const search = cleanSearch(query.search);
    if (search) {
      where.OR = [
        { name: like(search) },
        { city: like(search) },
        { owner: { name: like(search) } },
        { owner: { email: like(search) } },
        { category: { name: like(search) } },
      ];
    }
    const status = parseEnum(
      query.status,
      ['VERIFIED', 'PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const,
      'status',
    );
    if (status === 'VERIFIED') {
      where.isKycVerified = true;
      where.status = ShopStatus.ACTIVE;
    } else if (status === 'PENDING') {
      where.isKycVerified = false;
      where.status = ShopStatus.ACTIVE;
    } else if (status) {
      where.status = status;
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    const from = parseCreatedFrom(query.createdFrom);
    if (from) where.createdAt = { gte: from };

    const [shops, total] = await Promise.all([
      this.prisma.shop.findMany({
        where,
        skip,
        take: limit,
        include: {
          owner: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shop.count({ where }),
    ]);

    return { data: shops, meta: pageMeta(total, page, limit) };
  }

  async createShop(dto: CreateShopDto) {
    // Same normalisation as self-registration, otherwise "A@x.com" and
    // "a@x.com" would become two different accounts.
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    if (!ownerEmail.includes('@'))
      throw new BadRequestException('Please provide a valid owner email');
    if (!dto.name?.trim())
      throw new BadRequestException('Shop name is required');
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('Category not found');
    }

    let owner = await this.prisma.user.findUnique({
      where: { email: ownerEmail },
    });

    if (!owner) {
      const defaultPassword = await this.generateUnusablePasswordHash();
      owner = await this.prisma.user.create({
        data: {
          email: ownerEmail,
          name: dto.ownerName || 'Shop Owner',
          password: defaultPassword,
          role: 'SHOPKEEPER',
        },
      });
    } else {
      if (owner.role !== 'SHOPKEEPER')
        throw new ConflictException(
          `${ownerEmail} is registered as ${owner.role}, not a shop owner.`,
        );
      const existingShop = await this.prisma.shop.findUnique({
        where: { ownerId: owner.id },
      });
      if (existingShop) {
        throw new ConflictException(`User ${ownerEmail} already owns a shop.`);
      }
    }

    const baseSlug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    let slugCounter = 1;
    while (await this.prisma.shop.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${slugCounter}`;
      slugCounter++;
    }

    const shop = await this.prisma.shop.create({
      data: {
        name: dto.name,
        slug,
        ownerId: owner.id,
        categoryId: dto.categoryId,
        city: dto.city,
        address: dto.address || dto.city || 'Address Pending',
        state: dto.state,
        pincode: dto.pincode,
        phone: dto.phone,
        whatsapp: dto.whatsapp,
        gstNumber: dto.gstNumber,
        latitude: 0,
        longitude: 0,
        logoUrl: dto.logoUrl,
      },
    });

    return shop;
  }

  async createProduct(shopId: string, dto: CreateProductDto) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    let categoryId = null;
    if (dto.categoryName) {
      const category = await this.prisma.category.findUnique({
        where: { slug: dto.categoryName.toLowerCase().replace(/\s+/g, '-') },
      });
      if (category) {
        categoryId = category.id;
      }
    }

    const baseSlug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    let slugCounter = 1;
    while (await this.prisma.product.findFirst({ where: { slug } })) {
      slug = `${baseSlug}-${slugCounter}`;
      slugCounter++;
    }

    const product = await this.prisma.product.create({
      data: {
        shopId,
        name: dto.name,
        slug,
        categoryId,
        sellingPrice: dto.sellingPrice,
        mrp: dto.sellingPrice,
      },
    });

    return product;
  }

  async createUser(dto: CreateUserDto) {
    const defaultPassword = await this.generateUnusablePasswordHash();
    const user = await this.prisma.user.create({
      data: {
        // Same normalisation as self-registration so the user can log in later.
        email: dto.email.trim().toLowerCase(),
        name: dto.name,
        // An empty string would collide on the unique mobile column.
        mobile: dto.mobile?.trim() || undefined,
        password: defaultPassword,
        role: dto.role,
        avatarUrl: dto.avatarUrl,
      },
    });

    if (user.role === 'SHOPKEEPER') {
      await this.prisma.shop.create({
        data: {
          ownerId: user.id,
          name: `${user.name || 'Retailer'}'s Shop`,
          slug: `shop-${user.id.substring(0, 8)}-${Date.now()}`,
          address: 'Please update your shop address',
          latitude: 0,
          longitude: 0,
          status: 'ACTIVE',
        },
      });
    } else if (user.role === 'INFLUENCER') {
      await this.prisma.influencerProfile.create({
        data: {
          userId: user.id,
          displayName: user.name || 'New Influencer',
          username: `user_${user.id.substring(0, 8)}_${Date.now()}`,
          verificationStatus: 'PENDING',
        },
      });
    }

    return user;
  }

  async createInfluencer(dto: CreateInfluencerDto) {
    const email = dto.email.trim().toLowerCase();
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      if (user.role !== 'INFLUENCER')
        throw new ConflictException(
          `${email} is registered as ${user.role}, not an influencer.`,
        );
      const existing = await this.prisma.influencerProfile.findUnique({
        where: { userId: user.id },
      });
      if (existing)
        throw new ConflictException(
          `${email} already has an influencer profile.`,
        );
    } else {
      const defaultPassword = await this.generateUnusablePasswordHash();
      user = await this.prisma.user.create({
        data: {
          email,
          name: dto.name,
          password: defaultPassword,
          role: 'INFLUENCER',
        },
      });
    }

    const baseSlug =
      String(dto.name || 'influencer')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'influencer';
    let username = baseSlug;
    let counter = 1;
    while (
      await this.prisma.influencerProfile.findUnique({ where: { username } })
    ) {
      username = `${baseSlug}-${counter++}`;
    }

    return this.prisma.influencerProfile.create({
      data: {
        userId: user.id,
        displayName: dto.name,
        username,
        bio: dto.bio,
        city: dto.city,
        categories: dto.categoryId ? [dto.categoryId] : [],
        instagramUrl: dto.instagramUrl,
        youtubeUrl: dto.youtubeUrl,
        facebookUrl: dto.facebookUrl,
        verificationStatus: 'PENDING',
        followers: 0,
        avgViews: 0,
        engagementRate: 0,
        creatorScore: 0,
        completedCampaigns: 0,
      },
    });
  }

  async getInfluencers(query: PaginationDto) {
    const { page, limit } = parsePagination(query);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = { role: 'INFLUENCER' };
    const and: Prisma.UserWhereInput[] = [];
    const search = cleanSearch(query.search);
    if (search) {
      and.push({
        OR: [
          { name: like(search) },
          { email: like(search) },
          { influencerProfile: { displayName: like(search) } },
          { influencerProfile: { username: like(search) } },
        ],
      });
    }
    const status = parseEnum(
      query.status,
      ['VERIFIED', 'PENDING', 'REJECTED', 'SUSPENDED'] as const,
      'status',
    );
    if (status === 'SUSPENDED') {
      where.isActive = false;
    } else if (status === 'PENDING') {
      // Users without a profile yet are effectively pending.
      and.push({
        OR: [
          { influencerProfile: { is: null } },
          { influencerProfile: { verificationStatus: 'PENDING' } },
        ],
      });
    } else if (status) {
      and.push({ influencerProfile: { verificationStatus: status } });
    }
    const from = parseCreatedFrom(query.createdFrom);
    if (from) where.createdAt = { gte: from };
    if (and.length) where.AND = and;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        where,
        include: { influencerProfile: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    const influencers = users.map((u) =>
      u.influencerProfile
        ? { ...u.influencerProfile, user: u }
        : this.placeholderInfluencer(u),
    );

    return { data: influencers, meta: pageMeta(total, page, limit) };
  }

  /** Shape used for INFLUENCER users that have not created a profile yet. */
  private placeholderInfluencer(u: {
    id: string;
    name: string | null;
    createdAt: Date;
  }) {
    return {
      id: `temp_${u.id}`,
      userId: u.id,
      displayName: u.name || 'New Influencer',
      username: `user_${u.id.substring(0, 8)}`,
      verificationStatus: 'PENDING',
      followers: 0,
      socialPlatform: null,
      createdAt: u.createdAt,
      user: u,
    };
  }

  async suspendUser(userId: string, dto: SuspendUserDto, actorId?: string) {
    // An admin deactivating their own account would lock them out of the panel.
    if (actorId && actorId === userId && !dto.isActive)
      throw new BadRequestException('You cannot suspend your own account');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: dto.isActive },
    });
    if (!dto.isActive) {
      // Cut off sessions immediately rather than waiting for token expiry.
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
    await this.audit(
      actorId,
      dto.isActive ? 'USER_ACTIVATE' : 'USER_SUSPEND',
      'USER',
      userId,
      { isActive: user.isActive },
      { isActive: dto.isActive },
    );
    return updated;
  }

  async updateUser(userId: string, dto: UpdateUserDto, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name cannot be empty');
      data.name = name;
    }
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.mobile !== undefined) data.mobile = nullable(dto.mobile);
    if (dto.avatarUrl !== undefined) data.avatarUrl = nullable(dto.avatarUrl);
    if (Object.keys(data).length === 0)
      throw new BadRequestException('Nothing to update');

    // Duplicate email/mobile surfaces as 409 via PrismaExceptionFilter.
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    await this.audit(
      actorId,
      'USER_UPDATE',
      'USER',
      userId,
      { name: user.name, email: user.email, mobile: user.mobile },
      { name: updated.name, email: updated.email, mobile: updated.mobile },
    );
    return updated;
  }

  /**
   * Hard-deletes a user only when nothing business-relevant depends on them.
   * Everything runs in one transaction, so a blocked delete leaves no
   * half-deleted data behind.
   */
  async deleteUser(userId: string, actorId: string) {
    if (userId === actorId)
      throw new BadRequestException('You cannot delete your own account');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN')
      throw new BadRequestException('Admin accounts cannot be deleted here');

    try {
      await this.prisma.$transaction(async (tx) => {
        const shop = await tx.shop.findUnique({ where: { ownerId: userId } });
        if (shop) await this.deleteShopInTx(tx, shop.id);
        await tx.influencerProfile.deleteMany({ where: { userId } });
        await tx.analyticsEvent.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      });
    } catch (e) {
      this.rethrowIfBlocked(
        e,
        'This user has orders, reservations, reviews, messages or other history and cannot be deleted. Suspend the account instead.',
      );
    }
    await this.audit(actorId, 'USER_DELETE', 'USER', userId, {
      email: user.email,
      name: user.name,
      role: user.role,
    });
    return { success: true };
  }

  private rethrowIfBlocked(e: unknown, message: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003')
      throw new ConflictException(message);
    throw e;
  }

  /** Removes a shop plus its trivially-owned rows; FK restricts block the rest. */
  private async deleteShopInTx(tx: Prisma.TransactionClient, shopId: string) {
    const productIds = (
      await tx.product.findMany({ where: { shopId }, select: { id: true } })
    ).map((p) => p.id);
    // View logs and media are not business records; orders, reservations,
    // negotiations, reviews, subscriptions and campaigns are and will block.
    await tx.analyticsEvent.deleteMany({
      where: { OR: [{ shopId }, { productId: { in: productIds } }] },
    });
    await tx.mediaAsset.deleteMany({
      where: { entityId: { in: productIds } },
    });
    await tx.shop.delete({ where: { id: shopId } });
  }

  async verifyShop(shopId: string, dto: VerifyShopDto) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.shop.update({
      where: { id: shopId },
      data: {
        isGstVerified: dto.isGstVerified,
        isKycVerified: dto.isKycVerified,
      },
    });
  }

  async updateShop(shopId: string, dto: UpdateShopDto, actorId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('Category not found');
    }

    const data: Prisma.ShopUncheckedUpdateInput = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim())
        throw new BadRequestException('Name cannot be empty');
      data.name = dto.name.trim();
    }
    if (dto.address !== undefined) {
      if (!dto.address.trim())
        throw new BadRequestException('Address cannot be empty');
      data.address = dto.address.trim();
    }
    if (dto.categoryId) data.categoryId = dto.categoryId;
    for (const key of [
      'description',
      'city',
      'state',
      'pincode',
      'phone',
      'whatsapp',
      'gstNumber',
    ] as const) {
      if (dto[key] !== undefined) data[key] = nullable(dto[key]);
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isKycVerified !== undefined) data.isKycVerified = dto.isKycVerified;
    if (dto.isGstVerified !== undefined) data.isGstVerified = dto.isGstVerified;
    if (Object.keys(data).length === 0)
      throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.shop.update({
      where: { id: shopId },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    await this.audit(
      actorId,
      'SHOP_UPDATE',
      'SHOP',
      shopId,
      {
        status: shop.status,
        isKycVerified: shop.isKycVerified,
        isGstVerified: shop.isGstVerified,
      },
      {
        status: updated.status,
        isKycVerified: updated.isKycVerified,
        isGstVerified: updated.isGstVerified,
      },
    );
    return updated;
  }

  async deleteShop(shopId: string, actorId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');
    try {
      await this.prisma.$transaction((tx) => this.deleteShopInTx(tx, shopId));
    } catch (e) {
      this.rethrowIfBlocked(
        e,
        'This shop has orders, reservations, negotiations, reviews or other history and cannot be deleted. Set it to Inactive or Suspended instead.',
      );
    }
    await this.audit(actorId, 'SHOP_DELETE', 'SHOP', shopId, {
      name: shop.name,
      ownerId: shop.ownerId,
    });
    return { success: true };
  }

  async updateProduct(
    productId: string,
    dto: UpdateProductDto,
    actorId: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim())
        throw new BadRequestException('Name cannot be empty');
      data.name = dto.name.trim();
    }
    const selling = dto.sellingPrice ?? Number(product.sellingPrice);
    const mrp = dto.mrp ?? Number(product.mrp);
    if (selling > mrp)
      throw new BadRequestException('Selling price cannot exceed MRP');
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.mrp !== undefined) data.mrp = dto.mrp;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (Object.keys(data).length === 0)
      throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data,
    });
    await this.audit(actorId, 'PRODUCT_UPDATE', 'PRODUCT', productId);
    return updated;
  }

  /** Same semantics as the shopkeeper delete: the listing is deactivated. */
  async deleteProduct(productId: string, actorId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
    await this.audit(actorId, 'PRODUCT_DELETE', 'PRODUCT', productId, {
      name: product.name,
    });
    return { success: true };
  }

  async verifyInfluencer(influencerId: string, dto: VerifyInfluencerDto) {
    let userId: string;
    let result: any;

    if (influencerId.startsWith('temp_')) {
      userId = influencerId.replace('temp_', '');
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      result = await this.prisma.influencerProfile.create({
        data: {
          userId: user.id,
          displayName: user.name || 'New Influencer',
          username: `user_${user.id.substring(0, 8)}_${Date.now()}`,
          verificationStatus: dto.status as any,
        },
      });
    } else {
      const profile = await this.prisma.influencerProfile.findUnique({
        where: { id: influencerId },
      });
      if (!profile) throw new NotFoundException('Influencer profile not found');
      userId = profile.userId;

      result = await this.prisma.influencerProfile.update({
        where: { id: influencerId },
        data: {
          verificationStatus: dto.status as any,
        },
      });
    }

    // Notify influencer of verification status or requested information
    try {
      const title =
        dto.status === 'VERIFIED'
          ? 'Profile Verified!'
          : dto.status === 'REJECTED'
            ? 'Verification Rejected'
            : 'Verification: Additional Info Requested';
      const body =
        dto.note ||
        (dto.status === 'VERIFIED'
          ? 'Your influencer profile has been verified successfully.'
          : dto.status === 'REJECTED'
            ? 'Your verification request was rejected. Please review profile details.'
            : 'Admin has requested additional verification documents.');

      await this.prisma.notification.create({
        data: {
          userId,
          type: 'SYSTEM',
          title,
          body,
          data: { status: dto.status, note: dto.note },
        },
      });
    } catch {
      // Non-blocking notification failure
    }

    return result;
  }

  async getReports(query: PaginationDto) {
    const { page, limit } = parsePagination(query);
    const skip = (page - 1) * limit;

    const where: Prisma.ContentReportWhereInput = {};
    const search = cleanSearch(query.search);
    if (search) {
      where.OR = [
        { title: like(search) },
        { reason: like(search) },
        { shop: { name: like(search) } },
      ];
    }
    const status = parseEnum(
      query.status,
      Object.values(ReportStatus),
      'status',
    );
    if (status) where.status = status;
    if (query.reason) where.reason = query.reason;

    const [reports, total] = await Promise.all([
      this.prisma.contentReport.findMany({
        where,
        skip,
        take: limit,
        include: { product: true, shop: true, reporter: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contentReport.count({ where }),
    ]);

    return { data: reports, meta: pageMeta(total, page, limit) };
  }

  async resolveReport(reportId: string, dto: ResolveReportDto) {
    const report = await this.prisma.contentReport.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    return this.prisma.contentReport.update({
      where: { id: reportId },
      data: { status: dto.status },
    });
  }

  /**
   * Takes the reported content down (product deactivated, or the shop
   * suspended when the report targets a shop) and resolves the report.
   */
  async removeReportedContent(reportId: string, actorId: string) {
    const report = await this.prisma.contentReport.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    if (report.productId) {
      await this.prisma.product.update({
        where: { id: report.productId },
        data: { isActive: false },
      });
    } else if (report.shopId) {
      await this.prisma.shop.update({
        where: { id: report.shopId },
        data: { status: 'SUSPENDED' },
      });
    } else {
      throw new BadRequestException('This report has no content to remove');
    }

    const updated = await this.prisma.contentReport.update({
      where: { id: reportId },
      data: { status: 'RESOLVED' },
    });
    await this.audit(
      actorId,
      'REPORT_REMOVE_CONTENT',
      'REPORT',
      reportId,
      undefined,
      {
        productId: report.productId,
        shopId: report.shopId,
      },
    );
    return updated;
  }

  async bulkReports(ids: string[], action: BulkReportAction, actorId: string) {
    const unique = [...new Set(ids)];
    if (action === BulkReportAction.RESOLVE) {
      const res = await this.prisma.contentReport.updateMany({
        where: { id: { in: unique } },
        data: { status: 'RESOLVED' },
      });
      return { processed: res.count, failed: unique.length - res.count };
    }
    let processed = 0;
    let failed = 0;
    for (const id of unique) {
      try {
        await this.removeReportedContent(id, actorId);
        processed++;
      } catch {
        failed++;
      }
    }
    return { processed, failed };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerOrders: { take: 10, orderBy: { createdAt: 'desc' } },
        sentMessages: { take: 5, orderBy: { createdAt: 'desc' } },
        reviews: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return { ...user, adminNote: await this.latestNote(userId) };
  }

  async getShopDetail(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        owner: true,
        category: { select: { id: true, name: true } },
        products: { take: 10, orderBy: { createdAt: 'desc' } },
        orders: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { customer: true },
        },
      },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    // Fetch active subscription separately (not on Shop model directly)
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: { shopId, isActive: true },
      orderBy: { startedAt: 'desc' },
      include: { plan: { select: { name: true, productLimit: true, eventLimit: true, price: true } } },
    });

    // Product usage count
    const productCount = await this.prisma.product.count({
      where: { shopId, isActive: true },
    });

    return {
      ...shop,
      subscription: activeSubscription
        ? {
            id: activeSubscription.id,
            tier: activeSubscription.planTier,
            planName: activeSubscription.planName,
            price: activeSubscription.price,
            productLimit: activeSubscription.productLimit ?? activeSubscription.plan?.productLimit ?? 50,
            eventLimit: activeSubscription.plan?.eventLimit ?? 0,
            startedAt: activeSubscription.startedAt,
            expiresAt: activeSubscription.expiresAt,
            isActive: activeSubscription.isActive,
            billingCycle: activeSubscription.billingCycle,
          }
        : {
            tier: shop.subscriptionTier ?? 'FREE',
            planName: 'Free',
            price: 0,
            productLimit: 50,
            eventLimit: 0,
            startedAt: null,
            expiresAt: shop.subscriptionExpiresAt ?? null,
            isActive: true,
            billingCycle: null,
          },
      usage: {
        productsActive: productCount,
        productLimit: activeSubscription?.productLimit ?? 50,
        eventsUsedThisMonth: shop.eventsUsedThisMonth ?? 0,
        eventLimit: activeSubscription?.plan?.eventLimit ?? 0,
      },
    };
  }

  async getInfluencerDetail(influencerId: string) {
    if (influencerId.startsWith('temp_')) {
      const userId = influencerId.replace('temp_', '');
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.role !== 'INFLUENCER')
        throw new NotFoundException('Influencer profile not found');
      return {
        ...this.placeholderInfluencer(user),
        assignments: [],
        adminNote: await this.latestNote(userId),
      };
    }
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id: influencerId },
      include: {
        user: true,
        assignments: {
          include: { campaign: { include: { product: true } } },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!influencer)
      throw new NotFoundException('Influencer profile not found');
    return {
      ...influencer,
      adminNote: await this.latestNote(influencer.userId),
    };
  }

  async getReportStats() {
    const [totalFlagged, underReview, resolved] = await Promise.all([
      this.prisma.contentReport.count(),
      this.prisma.contentReport.count({ where: { status: 'UNDER_REVIEW' } }),
      this.prisma.contentReport.count({ where: { status: 'RESOLVED' } }),
    ]);

    return {
      totalFlagged,
      underReview,
      resolved,
    };
  }

  async getDashboardStats() {
    const [
      totalShops,
      totalUsers,
      totalRevenueData,
      activeNegotiations,
      verificationQueue,
      verifiedShops,
      dealsClosed,
      analyticsEvents,
    ] = await Promise.all([
      this.prisma.shop.count(),
      // "Monthly active" = signed in during the last 30 days.
      this.prisma.user.count({
        where: {
          lastLoginAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.order.aggregate({
        where: { status: 'DELIVERED' },
        _sum: { total: true },
      }),
      this.prisma.negotiation.count({
        where: { status: { in: ['PENDING', 'COUNTERED'] } },
      }),
      this.prisma.shop.findMany({
        where: {
          status: 'ACTIVE',
          OR: [{ isKycVerified: false }, { isGstVerified: false }],
        },
        include: { owner: true },
        take: 5,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.shop.count({
        where: { isKycVerified: true, isGstVerified: true },
      }),
      this.prisma.negotiation.count({
        where: { status: 'ACCEPTED' },
      }),
      this.prisma.analyticsEvent.findMany({
        where: {
          eventType: { in: ['shop_view', 'product_view'] },
          createdAt: {
            gte: new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000),
          }, // Last 8 weeks
        },
        select: { eventType: true, createdAt: true },
      }),
    ]);

    // Group actual analytics events by week
    const weekMap = new Map<string, { views: number; inquiries: number }>();
    const now = Date.now();
    for (let i = 7; i >= 0; i--) {
      const weekLabel = `W${8 - i}`;
      weekMap.set(weekLabel, { views: 0, inquiries: 0 });
    }

    analyticsEvents.forEach((event) => {
      const ageMs = now - event.createdAt.getTime();
      const weekNum = Math.floor(ageMs / (7 * 24 * 60 * 60 * 1000));
      if (weekNum >= 0 && weekNum < 8) {
        const label = `W${8 - weekNum}`;
        const entry = weekMap.get(label);
        if (entry) {
          if (event.eventType === 'shop_view') entry.views += 1;
          else if (event.eventType === 'product_view') entry.inquiries += 1;
        }
      }
    });

    const chartData = Array.from(weekMap.entries()).map(([name, data]) => ({
      name,
      ...data,
    }));

    // Calculate real avg discount from accepted negotiations
    const discountData = await this.prisma.negotiation.findMany({
      where: { status: 'ACCEPTED', finalPrice: { not: null } },
      select: { initialPrice: true, finalPrice: true },
      take: 500,
    });
    let avgDiscount = 0;
    if (discountData.length > 0) {
      const totalDiscount = discountData.reduce((sum, n) => {
        const initial = Number(n.initialPrice);
        const final = Number(n.finalPrice);
        if (initial > 0) return sum + ((initial - final) / initial) * 100;
        return sum;
      }, 0);
      avgDiscount = Math.round((totalDiscount / discountData.length) * 10) / 10;
    }

    return {
      totalShops,
      monthlyActiveUsers: totalUsers,
      platformRevenue: totalRevenueData._sum.total || 0,
      activeNegotiations,
      chartData,
      verificationQueue: verificationQueue.map((shop) => ({
        id: shop.id,
        name: shop.name,
        location: shop.city || 'India',
        type: 'Retail',
      })),
      verifiedShops,
      dealsClosed,
      avgDiscount,
    };
  }

  /** The signed-in admin's own inbox (broadcasts and system alerts). */
  async getAdminNotifications(
    actorId: string,
    query: { page?: string; limit?: string; filter?: 'all' | 'unread' } = {},
  ) {
    const { page, limit } = parsePagination(query);
    const where: Prisma.NotificationWhereInput = {
      userId: actorId,
      ...(query.filter === 'unread' ? { isRead: false } : {}),
    };
    const [data, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId: actorId, isRead: false },
      }),
    ]);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        unreadCount,
      },
    };
  }

  async markNotificationsRead(actorId: string) {
    await this.prisma.notification.updateMany({
      where: { userId: actorId, isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }

  async markNotificationRead(actorId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId: actorId },
      data: { isRead: true },
    });
    return { success: true, updated: result.count };
  }

  async getSettings() {
    // Use a fixed, absolute path — no inline require, no path traversal risk
    const fs = await import('fs');
    const path = await import('path');
    const settingsPath = path.resolve(process.cwd(), 'data', 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to read settings', e);
    }
    // Default settings
    return {
      subscriptionFee: 0,
      transactionFee: 5.0,
      require2FA: true,
      sessionTimeout: 120,
      paymentGateway: 'stripe_live',
      payoutSchedule: 'weekly',
    };
  }

  async updateSettings(dto: any) {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Settings must be a JSON object');
    }
    const fs = await import('fs');
    const path = await import('path');
    // Use a fixed, absolute resolved path to prevent any path-traversal
    const dataDir = path.resolve(process.cwd(), 'data');
    const settingsPath = path.resolve(dataDir, 'settings.json');
    // Ensure resolved path is still within the data directory
    if (!settingsPath.startsWith(dataDir)) {
      throw new Error('Invalid settings path');
    }
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(dto, null, 2), 'utf8');
      return { success: true, settings: dto };
    } catch (e) {
      console.error('Failed to save settings', e);
      throw new Error('Failed to save settings');
    }
  }

  // ─── SUBSCRIPTION MANAGEMENT ─────────────────────────────────────────────

  async seedDefaultPlans() {
    const defaultPlans = [
      {
        tier: SubscriptionTier.FREE,
        name: 'Free',
        tagline: 'Get your shop online in minutes — zero cost, zero risk',
        price: 0,
        yearlyPrice: null,
        productLimit: 50,
        eventLimit: 0,
        features: [
          'Up to 50 products',
          'Basic shop profile',
          'WhatsApp & call inquiries',
          'Order & reservation management',
          'Basic analytics',
          'Standard search listing',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 0,
      },
      {
        tier: SubscriptionTier.PRO,
        name: 'Pro',
        tagline: 'Grow your reach — promote events, attract more customers',
        price: 499,
        yearlyPrice: 4788,
        productLimit: 200,
        eventLimit: 1,
        features: [
          'Up to 200 products',
          '1 promoted event/month on home screen',
          'Advanced analytics',
          '🔵 Pro badge on shop listing',
          '20% higher search ranking',
          'Customer chat enabled',
          'Promotional banner in nearby feed',
          'Auto GST invoice',
        ],
        isActive: true,
        isHighlighted: true,
        sortOrder: 1,
      },
      {
        tier: SubscriptionTier.PREMIUM,
        name: 'Premium',
        tagline: 'Dominate your locality — maximum visibility, maximum sales',
        price: 1199,
        yearlyPrice: 11508,
        productLimit: 500,
        eventLimit: 3,
        features: [
          'Up to 500 products',
          'Up to 3 events/promotions on home carousel',
          'Full analytics suite',
          '👑 Premium gold badge',
          '50% search boost + category top-3',
          'Influencer campaigns (2/month)',
          'Full-width home screen banner',
          'Price negotiation feature',
          'Bulk CSV inventory upload',
          'Stock alerts',
          'Auto GST invoice',
          'Early access to new features',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 2,
      },
    ];

    for (const plan of defaultPlans) {
      await this.prisma.subscriptionPlan.upsert({
        where: { tier: plan.tier },
        update: plan as any,
        create: plan as any,
      });
    }

    return {
      success: true,
      message: 'Default subscription plans initialized successfully',
    };
  }

  async getSubscriptionPlans() {
    let plans = await this.prisma.subscriptionPlan.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    if (plans.length === 0) {
      await this.seedDefaultPlans();
      plans = await this.prisma.subscriptionPlan.findMany({
        orderBy: { sortOrder: 'asc' },
      });
    }
    return plans;
  }

  async updateSubscriptionPlan(
    planId: string,
    data: {
      name?: string;
      tagline?: string;
      price?: number;
      yearlyPrice?: number | null;
      productLimit?: number;
      eventLimit?: number;
      features?: string[];
      isHighlighted?: boolean;
      isActive?: boolean;
    },
  ) {
    if (data.isHighlighted) {
      await this.prisma.subscriptionPlan.updateMany({
        where: { isHighlighted: true },
        data: { isHighlighted: false },
      });
    }
    return this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data,
    });
  }

  async getAllSubscriptions(tier?: string) {
    const where: Prisma.SubscriptionWhereInput = {};
    if (tier && tier !== 'ALL') {
      where.planTier = tier as SubscriptionTier;
    }
    return this.prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            _count: { select: { products: true } },
          },
        },
        plan: { select: { name: true } },
      },
    });
  }

  async getPaymentStats() {
    const [
      proCount,
      premiumCount,
      freeCount,
      totalRevenue,
      recentPayments,
      allPlans,
    ] = await Promise.all([
      this.prisma.shop.count({ where: { subscriptionTier: 'PRO' } }),
      this.prisma.shop.count({ where: { subscriptionTier: 'PREMIUM' } }),
      this.prisma.shop.count({ where: { subscriptionTier: 'FREE' } }),
      this.prisma.razorpayOrder.aggregate({
        where: { status: 'paid' },
        _sum: { amount: true },
      }),
      this.prisma.razorpayOrder.findMany({
        where: { status: 'paid' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { shop: { select: { name: true } } },
      }),
      this.prisma.subscriptionPlan.findMany(),
    ]);

    const proPlans = allPlans.find((p) => p.tier === 'PRO');
    const premiumPlans = allPlans.find((p) => p.tier === 'PREMIUM');
    const planMap = new Map(allPlans.map((pl) => [pl.id, pl.name]));

    const mrr =
      proCount * Number(proPlans?.price || 499) +
      premiumCount * Number(premiumPlans?.price || 1199);

    return {
      mrr,
      totalRevenue: Number(totalRevenue._sum.amount || 0),
      activePaid: proCount + premiumCount,
      freeCount,
      tierCounts: { FREE: freeCount, PRO: proCount, PREMIUM: premiumCount },
      recentPayments: recentPayments.map((p) => ({
        shop: p.shop,
        planId: p.planId,
        planName: planMap.get(p.planId) || 'Subscription',
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt,
      })),
    };
  }

  async overrideShopPlan(
    shopId: string,
    dto: { tier: string; durationMonths?: number; note?: string },
    actorId?: string,
  ) {
    const planTier = dto.tier.toUpperCase() as SubscriptionTier;
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { tier: planTier },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    // durationMonths = 0 means lifetime / never-expires grant
    const months =
      typeof dto.durationMonths === 'number' && dto.durationMonths >= 0
        ? dto.durationMonths
        : 1;

    let expiresAt: Date | null = null;
    if (months > 0) {
      expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + months);
    }

    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    await this.prisma.shop.update({
      where: { id: shopId },
      data: {
        subscriptionTier: planTier,
        subscriptionExpiresAt: expiresAt,
        eventsUsedThisMonth: 0,
      },
    });

    await this.prisma.subscription.updateMany({
      where: { shopId, isActive: true },
      data: { isActive: false },
    });

    const subscription = await this.prisma.subscription.create({
      data: {
        shopId,
        planId: plan.id,
        planName: plan.name,
        planTier: planTier,
        price: plan.price,
        billingCycle: 'monthly',
        features: (plan.features as Prisma.InputJsonValue) ?? [],
        productLimit: plan.productLimit,
        startedAt: new Date(),
        expiresAt,
        isActive: true,
      },
    });

    // Best-effort notification to the shopkeeper
    try {
      const durationLabel =
        months === 0
          ? 'lifetime'
          : months === 1
            ? '1 month'
            : `${months} months`;
      await this.prisma.notification.create({
        data: {
          userId: shop.ownerId,
          type: 'SYSTEM',
          title: `Your plan has been updated to ${plan.name}!`,
          body:
            dto.note ||
            `Admin has granted you the ${plan.name} plan for ${durationLabel}. Your new limits are live immediately.`,
          data: {
            planTier,
            planName: plan.name,
            durationMonths: months,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
        },
      });
    } catch {
      // Non-blocking
    }

    await this.audit(
      actorId,
      'PLAN_OVERRIDE',
      'SHOP',
      shopId,
      { tier: shop.subscriptionTier, expiresAt: shop.subscriptionExpiresAt },
      {
        tier: planTier,
        durationMonths: months,
        expiresAt: expiresAt?.toISOString() ?? null,
        note: dto.note,
      },
    );

    return {
      success: true,
      subscription,
      tier: planTier,
      expiresAt,
      durationMonths: months,
      message:
        months === 0
          ? `${plan.name} plan granted with no expiry.`
          : `${plan.name} plan granted for ${months} month(s).`,
    };
  }
}
