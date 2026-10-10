import { Migration } from '@mikro-orm/migrations';

export class Migration20261009073318_order_hub extends Migration {

  override name = 'Migration20261009073318';

  override up(): void | Promise<void> {
    this.addSql(`create table "order_hub_company_order_documents" ("id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "company_order_id" uuid not null, "slot" text not null, "attachment_id" uuid not null, "file_name" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "order_hub_company_order_documents_order_slot_idx" on "order_hub_company_order_documents" ("company_order_id", "slot");`);
    this.addSql(`alter table "order_hub_company_order_documents" add constraint "order_hub_company_order_documents_slot_file_uniq" unique ("company_order_id", "slot", "attachment_id");`);

    this.addSql(`alter table "order_hub_company_order_documents" add constraint "order_hub_company_order_documents_company_order_id_foreign" foreign key ("company_order_id") references "order_hub_company_orders" ("id") on delete cascade;`);
  }

}
