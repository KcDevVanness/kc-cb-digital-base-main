import { Migration } from '@mikro-orm/migrations';

export class Migration20260922082559_purchasing extends Migration {

  override name = 'Migration20260922082559';

  override up(): void | Promise<void> {
    this.addSql(`create table "purchasing_purchase_order_documents" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "doc_type" text not null, "document_number" text null, "issued_at" date null, "attachment_id" uuid null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);

    this.addSql(`alter table "purchasing_purchase_orders" add "business_number" text null, add "product_category" text null, add "owner_user_id" uuid null, add "owner_snapshot" jsonb null, add "customer_id" uuid null, add "customer_snapshot" jsonb null;`);

    this.addSql(`alter table "purchasing_purchase_order_documents" add constraint "purchasing_purchase_order_documents_order_id_foreign" foreign key ("order_id") references "purchasing_purchase_orders" ("id") on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "purchasing_purchase_orders" drop column "business_number", drop column "product_category", drop column "owner_user_id", drop column "owner_snapshot", drop column "customer_id", drop column "customer_snapshot";`);
  }

}
