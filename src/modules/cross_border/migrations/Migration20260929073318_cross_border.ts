import { Migration } from '@mikro-orm/migrations';

export class Migration20260929073318_cross_border extends Migration {

  override name = 'Migration20260929073318';

  override up(): void | Promise<void> {
    this.addSql(`create table "cross_border_export_document_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "document_id" uuid not null, "line_number" int not null, "product_id" uuid null, "product_snapshot" jsonb null, "name" text null, "sku" text null, "unit" text null, "quantity" numeric(18,4) null, "cartons" numeric(18,0) null, "gross_weight" numeric(18,4) null, "net_weight" numeric(18,4) null, "volume" numeric(18,0) null, "source_snapshot" jsonb null, "note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "cross_border_export_document_lines_scope_idx" on "cross_border_export_document_lines" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "cross_border_export_document_lines" add constraint "cross_border_export_document_lines_document_line_uniq" unique ("document_id", "line_number");`);

    this.addSql(`create table "cross_border_shipment_contracts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "shipment_id" uuid not null, "contract_id" uuid not null, "contract_number" text null, "contract_direction" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "cross_border_shipment_contracts_contract_idx" on "cross_border_shipment_contracts" ("organization_id", "tenant_id", "contract_id");`);
    this.addSql(`create index "cross_border_shipment_contracts_scope_idx" on "cross_border_shipment_contracts" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "cross_border_shipment_contracts" add constraint "cross_border_shipment_contracts_shipment_contract_uniq" unique ("shipment_id", "contract_id");`);

    this.addSql(`alter table "cross_border_export_document_lines" add constraint "cross_border_export_document_lines_document_id_foreign" foreign key ("document_id") references "cross_border_export_documents" ("id") on delete cascade;`);

    this.addSql(`alter table "cross_border_shipment_contracts" add constraint "cross_border_shipment_contracts_shipment_id_foreign" foreign key ("shipment_id") references "cross_border_shipments" ("id") on delete cascade;`);
  }

}
