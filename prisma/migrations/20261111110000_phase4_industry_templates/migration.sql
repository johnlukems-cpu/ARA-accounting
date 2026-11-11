-- CreateEnum
CREATE TYPE "TemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "Administration" ADD COLUMN     "templateVersionId" TEXT;

-- CreateTable
CREATE TABLE "IndustryTemplate" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "descriptionEn" TEXT,
    "basedOnId" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryTemplateVersion" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "changelog" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndustryTemplate_ownerOrganizationId_code_key" ON "IndustryTemplate"("ownerOrganizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryTemplateVersion_templateId_version_key" ON "IndustryTemplateVersion"("templateId", "version");

-- AddForeignKey
ALTER TABLE "IndustryTemplateVersion" ADD CONSTRAINT "IndustryTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "IndustryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
