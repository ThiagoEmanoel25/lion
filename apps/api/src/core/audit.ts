import type { PrismaClient, Prisma } from '@prisma/client';
export async function audit(prisma:PrismaClient|Prisma.TransactionClient,input:{workspaceId:string;actorId?:string;action:string;targetType:string;targetId?:string;ip?:string;userAgent?:string;changes?:Prisma.InputJsonValue}){await prisma.auditLog.create({data:input})}
