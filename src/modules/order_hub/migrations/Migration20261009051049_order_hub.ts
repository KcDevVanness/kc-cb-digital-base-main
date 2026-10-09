import { Migration } from '@mikro-orm/migrations';

export class Migration20261009051049_order_hub extends Migration {

  override name = 'Migration20261009051049';

  override up(): void | Promise<void> {
    this.addSql(`create table "order_hub_company_order_collaborators" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "company_order_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "order_hub_company_order_collaborators_scope_idx" on "order_hub_company_order_collaborators" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "order_hub_company_order_collaborators" add constraint "order_hub_company_order_collaborators_order_org_uniq" unique ("company_order_id", "organization_id");`);

    this.addSql(`alter table "order_hub_company_order_collaborators" add constraint "order_hub_company_order_collaborators_company_order_id_foreign" foreign key ("company_order_id") references "order_hub_company_orders" ("id") on delete cascade;`);
  }

}
